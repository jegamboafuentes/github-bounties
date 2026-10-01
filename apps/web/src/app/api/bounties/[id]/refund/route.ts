import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import {
  escrowErrorJson,
  httpStatusForEscrowError,
  isEscrowError,
  jsonForUnknown,
  refundEscrow,
  takeRequestId,
} from "@/escrow";
import { isUuid, platformNotFoundResponse } from "@/ids";

export const dynamic = "force-dynamic";

/** Poster cancel → full-face refund (or void if never funded). */
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

  try {
    const result = await refundEscrow(
      id,
      { actorUserId: user.id, reason: "cancel" },
      { db: getRuntimeDb(), requestId: takeRequestId(req.headers.get("x-request-id")) },
    );
    return Response.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (isEscrowError(err)) {
      return Response.json(escrowErrorJson(err), { status: httpStatusForEscrowError(err) });
    }
    return Response.json(jsonForUnknown(err instanceof Error ? err.message : "refund failed"), {
      status: 500,
    });
  }
}
