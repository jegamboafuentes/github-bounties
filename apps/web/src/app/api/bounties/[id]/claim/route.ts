import { getCurrentPublicUser } from "@/auth/protect";
import { claimPoolPayout, claimPayout, isClaimError } from "@/claims";
import { getRuntimeDb } from "@/db/runtime";
import { escrowErrorJson, httpStatusForEscrowError, isEscrowError, jsonForUnknown } from "@/escrow";
import { redactDatabaseText } from "@/http/redact-error";
import { isUuid, platformNotFoundResponse } from "@/ids";
import { ProviderNotSupportedError } from "@/providers/types";

export const dynamic = "force-dynamic";

/**
 * Winner or pool-member claim. Winner body: { payoutAddress, persistWallet?, claimId? }.
 * Pool body: { kind: "pool", payoutAddress, participantId?, persistWallet? }.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return platformNotFoundResponse();
  const user = await getCurrentPublicUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: {
    payoutAddress?: string;
    persistWallet?: boolean;
    claimId?: string;
    kind?: "winner" | "pool";
    participantId?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const result =
      body.kind === "pool" || body.participantId
        ? await claimPoolPayout(
            id,
            user.id,
            {
              payoutAddress: body.payoutAddress ?? "",
              persistWallet: body.persistWallet,
              participantId: body.participantId,
            },
            { db: getRuntimeDb() },
          )
        : await claimPayout(
            id,
            user.id,
            {
              payoutAddress: body.payoutAddress ?? "",
              persistWallet: body.persistWallet,
              claimId: body.claimId,
            },
            { db: getRuntimeDb() },
          );
    return Response.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (isClaimError(err)) {
      const status =
        err.code === "unauthorized"
          ? 401
          : err.code === "not_hunter" ||
              err.code === "not_pool_member" ||
              err.code === "not_eligible" ||
              err.code === "hunter_not_linked" ||
              err.code === "pool_not_ready"
            ? 403
            : err.code === "bounty_not_found" || err.code === "claim_not_found"
              ? 404
              : 400;
      return Response.json(
        { ok: false, error: err.code, message: redactDatabaseText(err.message) },
        { status },
      );
    }
    if (isEscrowError(err)) {
      return Response.json(escrowErrorJson(err), { status: httpStatusForEscrowError(err) });
    }
    if (err instanceof ProviderNotSupportedError) {
      return Response.json(
        { ok: false, error: err.code, message: redactDatabaseText(err.message) },
        { status: 501 },
      );
    }
    return Response.json(jsonForUnknown(err instanceof Error ? err.message : "claim failed"), {
      status: 500,
    });
  }
}
