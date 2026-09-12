import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import {
  escrowErrorJson,
  httpStatusForEscrowCode,
  isEscrowError,
  jsonForUnknown,
  refundEscrow,
} from "@/escrow";

export const dynamic = "force-dynamic";

/** Poster cancel → full-face refund (or void if never funded). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentPublicUser();
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let funderAddress: string | undefined;
  try {
    const body = (await req.json()) as { funderAddress?: string };
    funderAddress = body.funderAddress;
  } catch {
    funderAddress = undefined;
  }

  try {
    const result = await refundEscrow(
      id,
      { actorUserId: user.id, reason: "cancel", funderAddress },
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
    return Response.json(jsonForUnknown(err instanceof Error ? err.message : "refund failed"), {
      status: 500,
    });
  }
}
