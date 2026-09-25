import { POOL_ROSTER_NOT_FROZEN_MESSAGE } from "../../claims/errors";
import { PublicApiError } from "../public/errors";
import type { ClaimAuthContext, ClaimKind } from "./deps";

export function githubLoginsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  return a.length > 0 && a === b;
}

/**
 * The key owner is the only caller. Winner claims need their linked GitHub
 * login to match the merged PR author and the claim row. Pool claims need
 * that login to match the caller's own frozen pool row.
 */
export function authorizeClaimCaller(actorUserId: string, kind: ClaimKind, ctx: ClaimAuthContext): void {
  if (!ctx.bounty) {
    throw new PublicApiError("not_found", "Bounty not found.");
  }
  if (!ctx.githubLogin?.trim()) {
    throw new PublicApiError(
      "github_not_linked",
      "Link GitHub before claiming with this key.",
      null,
      403,
    );
  }
  if (!ctx.walletAddress?.trim()) {
    throw new PublicApiError(
      "wallet_not_set",
      "Save a payout wallet before claiming with this key.",
      null,
      403,
    );
  }
  if (kind === "winner") {
    const winner = ctx.winner;
    const loginOk = githubLoginsMatch(ctx.githubLogin, winner?.prAuthorLogin);
    const ownerOk = winner?.hunterUserId === actorUserId;
    if (!winner || !loginOk || !ownerOk) {
      throw new PublicApiError(
        "not_winner",
        "Only the winning GitHub account can claim the winner share. The linked login must match the merged pull request author.",
        null,
        403,
      );
    }
    if (winner.status !== "eligible" && winner.status !== "paid") {
      throw new PublicApiError(
        "not_eligible",
        `This claim is ${winner.status}, not eligible for payout.`,
        null,
        403,
      );
    }
    return;
  }
  if (!ctx.rosterFrozen) {
    throw new PublicApiError("pool_not_ready", POOL_ROSTER_NOT_FROZEN_MESSAGE, null, 409);
  }
  const pool = ctx.pool;
  const loginOk = Boolean(pool) && githubLoginsMatch(ctx.githubLogin, pool?.githubLogin);
  const ownerOk = Boolean(pool) && (pool?.userId === actorUserId || pool?.userId == null);
  if (!pool || !loginOk || !ownerOk) {
    throw new PublicApiError(
      "not_pool_member",
      "Only a frozen pool participant can claim this share, and only their own.",
      null,
      403,
    );
  }
}
