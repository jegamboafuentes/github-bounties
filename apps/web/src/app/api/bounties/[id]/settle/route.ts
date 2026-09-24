import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import {
  escrowErrorJson,
  httpStatusForEscrowCode,
  isEscrowError,
  jsonForUnknown,
  settleEscrow,
  takeRequestId,
} from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * Settle API. Poster or the winning hunter from the GitHub merge claim.
 * The body cannot choose hunterUserId, hunterPayoutAddress, or claimId.
 * Payee is claims.payout_address or that hunter's saved wallet.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentPublicUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const result = await settleEscrow(
      id,
      { actorUserId: user.id },
      { db: getRuntimeDb(), requestId: takeRequestId(_req.headers.get("x-request-id")) },
    );
    return Response.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (isEscrowError(err)) {
      return Response.json(escrowErrorJson(err), { status: httpStatusForEscrowCode(err.code) });
    }
    return Response.json(jsonForUnknown(err instanceof Error ? err.message : "settle failed"), {
      status: 500,
    });
  }
}
