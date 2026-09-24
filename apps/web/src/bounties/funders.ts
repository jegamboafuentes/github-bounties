import { sql } from "drizzle-orm";
import { normalizeAvatarUrl } from "../auth/users";
import type { Database } from "../db/client";
import { githubAvatarUrl } from "../github/avatar";
import { isUndefinedTableError } from "../intelligence/errors";

/** Visible faces on a board card. The rest collapse into a +N chip. */
export const BOARD_FUNDER_AVATAR_LIMIT = 5;

/** CSS pixel size of one face. GitHub fallback URLs request 2×. */
export const BOARD_FUNDER_AVATAR_SIZE = 24;

export type BoardFunder = {
  userId: string;
  displayName: string;
  /** https picture: Google `users.avatar_url`, else GitHub. Null shows initials. */
  avatarUrl: string | null;
};

export type BoardFunderSummary = {
  funders: BoardFunder[];
  funderCount: number;
};

/** One `bounty_contributions` row plus the funder's profile fields. */
export type ContributionFunderRow = {
  bountyId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  githubAvatarUrl: string | null;
  githubLogin: string | null;
  createdAt: Date;
};

export function emptyBoardFunders(): BoardFunderSummary {
  return { funders: [], funderCount: 0 };
}

/**
 * Product identity picture first (`users.avatar_url`, https only), then the
 * stored GitHub avatar, then the same login URL `GitHubAvatar` builds.
 */
export function resolveFunderAvatarUrl(input: {
  avatarUrl?: string | null;
  githubAvatarUrl?: string | null;
  githubLogin?: string | null;
  size?: number;
}): string | null {
  const google = normalizeAvatarUrl(input.avatarUrl);
  if (google) return google;
  const storedGithub = normalizeAvatarUrl(input.githubAvatarUrl);
  if (storedGithub) return storedGithub;
  return githubAvatarUrl(input.githubLogin, input.size ?? BOARD_FUNDER_AVATAR_SIZE * 2);
}

/**
 * Screen-reader name for the stack.
 * `funders` is the visible slice; `funderCount` is the full distinct total.
 */
export function funderStackAriaLabel(
  funders: readonly { displayName: string }[],
  funderCount: number,
): string {
  const names = funders.map((funder) => funder.displayName.trim() || "someone");
  if (names.length === 0) return "";
  const overflow = Math.max(0, funderCount - names.length);
  const parts =
    overflow > 0
      ? [...names, overflow === 1 ? "1 other" : `${overflow} others`]
      : names;
  return `Funded by ${joinWithAnd(parts)}`;
}

/**
 * One face per `funder_user_id`. A second contribution from the same user
 * does not add a face. Order is that user's latest contribution, most recent
 * first. `funderCount` is the distinct user total, not the contribution count.
 * The visible list is capped at {@link BOARD_FUNDER_AVATAR_LIMIT}.
 */
export function collapseContributionFunders(
  rows: readonly ContributionFunderRow[],
): Map<string, BoardFunderSummary> {
  const byBounty = new Map<string, Map<string, ContributionFunderRow>>();
  for (const row of rows) {
    const users = byBounty.get(row.bountyId) ?? new Map<string, ContributionFunderRow>();
    const prev = users.get(row.userId);
    if (!prev || row.createdAt.getTime() >= prev.createdAt.getTime()) {
      users.set(row.userId, row);
    }
    byBounty.set(row.bountyId, users);
  }

  const out = new Map<string, BoardFunderSummary>();
  for (const [bountyId, users] of byBounty) {
    const ordered = [...users.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.userId.localeCompare(b.userId),
    );
    out.set(bountyId, {
      funderCount: ordered.length,
      funders: ordered.slice(0, BOARD_FUNDER_AVATAR_LIMIT).map(toBoardFunder),
    });
  }
  return out;
}

/**
 * Backstop for the card. Drops a repeated user id even if the payload listed
 * every contribution. `funderCount` stays the distinct total.
 */
export function dedupeShownFunders(
  funders: readonly BoardFunder[],
  funderCount: number,
): { funders: BoardFunder[]; funderCount: number } {
  const seen = new Set<string>();
  const unique: BoardFunder[] = [];
  for (const funder of funders) {
    if (!funder.userId || seen.has(funder.userId)) continue;
    seen.add(funder.userId);
    unique.push(funder);
  }
  const dropped = funders.length - unique.length;
  return {
    funders: unique.slice(0, BOARD_FUNDER_AVATAR_LIMIT),
    funderCount: Math.max(unique.length, funderCount - dropped),
  };
}

function toBoardFunder(row: ContributionFunderRow): BoardFunder {
  return {
    userId: row.userId,
    displayName: row.displayName.trim() || "someone",
    avatarUrl: resolveFunderAvatarUrl({
      avatarUrl: row.avatarUrl,
      githubAvatarUrl: row.githubAvatarUrl,
      githubLogin: row.githubLogin,
      size: BOARD_FUNDER_AVATAR_SIZE * 2,
    }),
  };
}

/**
 * Distinct funders for board cards.
 *
 * Loads one row per contribution, then {@link collapseContributionFunders}
 * keeps a single face per `funder_user_id`. Order is that user's latest
 * contribution (most recent first). The detail Funders list stays one row
 * per contribution, oldest first, and is not used here.
 *
 * A database that has not applied `0007_bounty_contributions` yields an empty
 * map so the board still renders.
 */
export async function listBoardFunders(
  db: Database,
  bountyIds: readonly string[],
): Promise<Map<string, BoardFunderSummary>> {
  const out = new Map<string, BoardFunderSummary>();
  if (bountyIds.length === 0) return out;

  const idList = sql.join(
    bountyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  try {
    const result = await db.execute(sql`
      select
        bc.bounty_id,
        bc.funder_user_id,
        u.display_name,
        u.avatar_url,
        gl.github_login,
        gl.github_avatar_url,
        bc.created_at
      from bounty_contributions bc
      inner join users u on u.id = bc.funder_user_id
      left join github_links gl on gl.user_id = u.id
      where bc.bounty_id in (${idList})
    `);
    return collapseContributionFunders(parseContributionFunderRows(result));
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    console.error(
      JSON.stringify({ event: "board_funders_query_failed", error: "missing_table" }),
    );
    return out;
  }
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function parseContributionFunderRows(result: unknown): ContributionFunderRow[] {
  const parsed: ContributionFunderRow[] = [];
  for (const raw of rowsOf(result)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const bountyId = textField(row, "bounty_id");
    const userId = textField(row, "funder_user_id");
    if (!bountyId || !userId) continue;
    parsed.push({
      bountyId,
      userId,
      displayName: textField(row, "display_name") ?? "someone",
      avatarUrl: textField(row, "avatar_url"),
      githubAvatarUrl: textField(row, "github_avatar_url"),
      githubLogin: textField(row, "github_login"),
      createdAt: asDate(row.created_at),
    });
  }
  return parsed;
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function textField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}
