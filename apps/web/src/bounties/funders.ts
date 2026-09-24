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

export type RankedFunderRow = {
  bountyId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  githubAvatarUrl: string | null;
  githubLogin: string | null;
  rn: number;
  funderCount: number;
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
 * One face per funder, most recent first (`rn` ascending).
 * Caps the visible list at {@link BOARD_FUNDER_AVATAR_LIMIT}.
 * `funderCount` is the distinct total, including people past the cap.
 */
export function summarizeRankedFunders(rows: readonly RankedFunderRow[]): BoardFunderSummary {
  const ordered = [...rows].sort((a, b) => a.rn - b.rn || a.userId.localeCompare(b.userId));
  const seen = new Set<string>();
  const funders: BoardFunder[] = [];
  let funderCount = 0;
  for (const row of ordered) {
    funderCount = Math.max(funderCount, row.funderCount);
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    if (funders.length >= BOARD_FUNDER_AVATAR_LIMIT) continue;
    funders.push({
      userId: row.userId,
      displayName: row.displayName.trim() || "someone",
      avatarUrl: resolveFunderAvatarUrl({
        avatarUrl: row.avatarUrl,
        githubAvatarUrl: row.githubAvatarUrl,
        githubLogin: row.githubLogin,
        size: BOARD_FUNDER_AVATAR_SIZE * 2,
      }),
    });
  }
  if (funderCount < seen.size) funderCount = seen.size;
  return { funders, funderCount };
}

export function groupBoardFunderRows(
  rows: readonly RankedFunderRow[],
): Map<string, BoardFunderSummary> {
  const byBounty = new Map<string, RankedFunderRow[]>();
  for (const row of rows) {
    const list = byBounty.get(row.bountyId) ?? [];
    list.push(row);
    byBounty.set(row.bountyId, list);
  }
  const out = new Map<string, BoardFunderSummary>();
  for (const [bountyId, list] of byBounty) {
    out.set(bountyId, summarizeRankedFunders(list));
  }
  return out;
}

/**
 * Distinct funders for board cards.
 *
 * The bounty detail Funders list is one row per contribution, oldest first
 * (`created_at` asc). It is not ordered by amount, so the card does not copy
 * that sequence. Each person appears once, ordered by their latest
 * contribution (most recent funder first). At most 5 faces are returned;
 * `funderCount` is the distinct total.
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
      with per_funder as (
        select
          bc.bounty_id,
          bc.funder_user_id,
          u.display_name,
          u.avatar_url,
          gl.github_login,
          gl.github_avatar_url,
          max(bc.created_at) as latest_at
        from bounty_contributions bc
        inner join users u on u.id = bc.funder_user_id
        left join github_links gl on gl.user_id = u.id
        where bc.bounty_id in (${idList})
        group by
          bc.bounty_id,
          bc.funder_user_id,
          u.display_name,
          u.avatar_url,
          gl.github_login,
          gl.github_avatar_url
      ),
      ranked as (
        select
          per_funder.bounty_id,
          per_funder.funder_user_id,
          per_funder.display_name,
          per_funder.avatar_url,
          per_funder.github_login,
          per_funder.github_avatar_url,
          row_number() over (
            partition by per_funder.bounty_id
            order by per_funder.latest_at desc, per_funder.funder_user_id asc
          ) as rn,
          count(*) over (partition by per_funder.bounty_id) as funder_count
        from per_funder
      )
      select
        bounty_id,
        funder_user_id,
        display_name,
        avatar_url,
        github_login,
        github_avatar_url,
        rn,
        funder_count
      from ranked
      where rn <= ${BOARD_FUNDER_AVATAR_LIMIT}
      order by bounty_id, rn
    `);
    return groupBoardFunderRows(parseRankedFunderRows(result));
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

function parseRankedFunderRows(result: unknown): RankedFunderRow[] {
  const parsed: RankedFunderRow[] = [];
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
      rn: asCount(row.rn),
      funderCount: asCount(row.funder_count),
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

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}
