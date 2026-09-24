import type { BoardKeyset, BoardListSort } from "../../bounties/list";
import { PublicApiError, zodErrorDetails } from "./errors";
import { listBountiesInputSchema, type ListBountiesInput, bountyIdSchema } from "./schemas";

const CURSOR_PREFIX = "gb1.";

export type BoardCursor =
  | { v: 1; sort: "newest"; createdAt: string; id: string }
  | { v: 1; sort: "amount"; amount: string; id: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeBoardCursor(cursor: BoardCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function decodeBoardCursor(raw: string): BoardCursor | null {
  if (!raw.startsWith(CURSOR_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (row.v !== 1 || typeof row.id !== "string" || !UUID_RE.test(row.id)) return null;
    if (row.sort === "newest" && typeof row.createdAt === "string") {
      const createdAt = new Date(row.createdAt);
      if (Number.isNaN(createdAt.getTime())) return null;
      return { v: 1, sort: "newest", createdAt: createdAt.toISOString(), id: row.id };
    }
    if (row.sort === "amount" && typeof row.amount === "string" && /^\d+(\.\d+)?$/.test(row.amount)) {
      return { v: 1, sort: "amount", amount: row.amount, id: row.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function keysetFromCursor(cursor: BoardCursor): BoardKeyset {
  if (cursor.sort === "amount") {
    return { sort: "amount", amountUsdc: cursor.amount, id: cursor.id };
  }
  return { sort: "newest", createdAt: new Date(cursor.createdAt), id: cursor.id };
}

export function cursorFromPageItem(
  item: { id: string; createdAt: string; amountUsdc: string },
  sort: BoardListSort,
): string {
  if (sort === "amount") {
    return encodeBoardCursor({ v: 1, sort: "amount", amount: item.amountUsdc, id: item.id });
  }
  return encodeBoardCursor({ v: 1, sort: "newest", createdAt: item.createdAt, id: item.id });
}

/** Query-string values into the shared list schema (numbers and booleans). */
export function coerceListSearchParams(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const take = (key: string) => {
    const value = params.get(key);
    if (value == null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out[key] = trimmed;
  };
  take("repo");
  take("status");
  take("complexity");
  take("language");
  take("sort");
  take("cursor");
  const limit = params.get("limit");
  if (limit != null && limit.trim() !== "") out.limit = Number(limit.trim());
  const hasIntel = params.get("has_intel");
  if (hasIntel != null && hasIntel.trim() !== "") {
    const raw = hasIntel.trim().toLowerCase();
    if (raw === "true" || raw === "1") out.has_intel = true;
    else if (raw === "false" || raw === "0") out.has_intel = false;
    else out.has_intel = hasIntel.trim();
  }
  if (typeof out.status === "string" && out.status.toLowerCase() === "all") delete out.status;
  if (typeof out.complexity === "string") {
    const upper = out.complexity.toUpperCase();
    if (upper === "ALL") delete out.complexity;
    else out.complexity = upper;
  }
  return out;
}

export function acceptListInput(input: unknown): ListBountiesInput & { cursorValue: BoardCursor | null } {
  const parsed = listBountiesInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PublicApiError(
      "validation_failed",
      "Invalid bounty list query.",
      zodErrorDetails(parsed.error),
    );
  }
  const cursorValue = parsed.data.cursor ? decodeBoardCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursorValue) {
    throw new PublicApiError("validation_failed", "Invalid bounty list query.", [
      { path: "cursor", message: "Cursor is invalid." },
    ]);
  }
  if (cursorValue && cursorValue.sort !== parsed.data.sort) {
    throw new PublicApiError("validation_failed", "Invalid bounty list query.", [
      { path: "cursor", message: "Cursor was issued for a different sort." },
    ]);
  }
  return { ...parsed.data, cursorValue };
}

export function acceptBountyId(raw: string): string {
  const parsed = bountyIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PublicApiError("validation_failed", "Invalid bounty id.", zodErrorDetails(parsed.error));
  }
  return parsed.data;
}
