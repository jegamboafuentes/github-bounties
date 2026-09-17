import { getBoardBounty, getPoolRoster } from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";
import { getEscrowSnapshot } from "@/escrow";

export const dynamic = "force-dynamic";

/** Public bounty + escrow snapshot + pool roster (V2-4). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = getRuntimeDb();
  const [bounty, escrow, roster] = await Promise.all([
    getBoardBounty(id, db).catch(() => null),
    getEscrowSnapshot(id, db).catch(() => null),
    getPoolRoster(id, db).catch(() => null),
  ]);
  if (!bounty) {
    return Response.json({ ok: false, error: "bounty_not_found" }, { status: 404 });
  }
  return Response.json(
    { ok: true, bounty, escrow, roster },
    { headers: { "cache-control": "no-store" } },
  );
}
