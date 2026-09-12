import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import {
  escrowErrorJson,
  httpStatusForEscrowCode,
  isEscrowError,
  jsonForUnknown,
  settleEscrow,
} from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * Minimal settle API (V1-5). V1-6 owns payout UI polish.
 * Poster or winning hunter. Body: { hunterPayoutAddress?, hunterUserId?, claimId? }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentPublicUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: {
    hunterPayoutAddress?: string;
    hunterUserId?: string;
    claimId?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const result = await settleEscrow(
      id,
      {
        actorUserId: user.id,
        hunterPayoutAddress: body.hunterPayoutAddress,
        hunterUserId: body.hunterUserId,
        claimId: body.claimId,
      },
      { db: getRuntimeDb() },
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
