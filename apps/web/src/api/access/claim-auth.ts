import { POOL_ROSTER_NOT_FROZEN_MESSAGE } from "../../claims/errors";
import { getProvider } from "../../providers/registry";
import type { ProviderIdentity } from "../../providers/types";
import { PublicApiError } from "../public/errors";
import { statusForDomainCode } from "./policy";
import type { ClaimAuthContext, ClaimKind } from "./deps";

export function githubLoginsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  return getProvider("github").identitiesMatch(githubIdentity(left), githubIdentity(right));
}

function githubIdentity(login: string | null | undefined): ProviderIdentity {
  return { provider: "github", providerUserId: null, login: login ?? null };
}

function identitiesMatch(ctx: ClaimAuthContext, otherLogin: string | null | undefined): boolean {
  const provider = getProvider(ctx.bounty?.provider ?? "github");
  return provider.identitiesMatch(githubIdentity(ctx.githubLogin), githubIdentity(otherLogin));
}

/**
 * The key owner is the only caller. Winner claims need their linked GitHub
 * login to match the merged PR author and the claim row. Pool claims need
 * that login to match the caller's own frozen pool row.
 */
function hfNamesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  return a.length > 0 && a === b;
}

function authorizeHuggingFaceClaim(actorUserId: string, kind: ClaimKind, ctx: ClaimAuthContext): void {
  if (kind === "pool") {
    throw new PublicApiError(
      "provider_not_supported",
      "Claiming a Hugging Face pool share is not supported yet.",
      null,
      statusForDomainCode("provider_not_supported"),
    );
  }
  const winner = ctx.winner;
  const payable = Boolean(winner && (winner.status === "eligible" || winner.status === "paid"));
  if (!payable || !winner) {
    throw new PublicApiError(
      "provider_not_supported",
      "Claiming a Hugging Face bounty is not supported yet.",
      null,
      statusForDomainCode("provider_not_supported"),
    );
  }
  if (!ctx.hfUsername?.trim()) {
    throw new PublicApiError(
      "hf_not_linked",
      "Link Hugging Face before claiming with this key.",
      null,
      statusForDomainCode("hf_not_linked"),
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
  const loginOk = hfNamesMatch(ctx.hfUsername, winner.prAuthorLogin);
  const idOk = Boolean(
    ctx.hfSub && winner.prAuthorProviderId && ctx.hfSub === winner.prAuthorProviderId,
  );
  const ownerOk = winner.hunterUserId === actorUserId;
  if ((!loginOk && !idOk) || !ownerOk) {
    throw new PublicApiError(
      "not_winner",
      "Only the winning Hugging Face account can claim the winner share. The linked username must match the merged pull request author.",
      null,
      403,
    );
  }
}

export function authorizeClaimCaller(actorUserId: string, kind: ClaimKind, ctx: ClaimAuthContext): void {
  if (!ctx.bounty) {
    throw new PublicApiError("not_found", "Bounty not found.");
  }
  if (ctx.bounty.provider === "huggingface") {
    authorizeHuggingFaceClaim(actorUserId, kind, ctx);
    return;
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
    const loginOk = identitiesMatch(ctx, winner?.prAuthorLogin);
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
  const loginOk = Boolean(pool) && identitiesMatch(ctx, pool?.githubLogin);
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
