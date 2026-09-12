import { getBoardBounty } from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";
import { getEscrowSnapshot } from "@/escrow";

export const dynamic = "force-dynamic";

/** Public bounty + escrow snapshot (includes last Lock/settle fail_code / fail_reason). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = getRuntimeDb();
  const [bounty, escrow] = await Promise.all([
    getBoardBounty(id, db).catch(() => null),
    getEscrowSnapshot(id, db).catch(() => null),
  ]);
  if (!bounty) {
    return Response.json({ ok: false, error: "bounty_not_found" }, { status: 404 });
  }
  return Response.json(
    { ok: true, bounty, escrow },
    { headers: { "cache-control": "no-store" } },
  );
}
