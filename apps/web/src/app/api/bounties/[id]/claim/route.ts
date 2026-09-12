import { getCurrentPublicUser } from "@/auth/protect";
import { claimPayout, isClaimError } from "@/claims";
import { getRuntimeDb } from "@/db/runtime";
import { escrowErrorJson, httpStatusForEscrowCode, isEscrowError, jsonForUnknown } from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * Hunter claim payout (V1-6). Only the eligible merged-PR author.
 * Body: { payoutAddress, persistWallet? }
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
  let body: { payoutAddress?: string; persistWallet?: boolean; claimId?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const result = await claimPayout(
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
              err.code === "not_eligible" ||
              err.code === "hunter_not_linked"
            ? 403
            : err.code === "bounty_not_found" || err.code === "claim_not_found"
              ? 404
              : 400;
      return Response.json({ ok: false, error: err.code, message: err.message }, { status });
    }
    if (isEscrowError(err)) {
      return Response.json(escrowErrorJson(err), { status: httpStatusForEscrowCode(err.code) });
    }
    return Response.json(jsonForUnknown(err instanceof Error ? err.message : "claim failed"), {
      status: 500,
    });
  }
}
