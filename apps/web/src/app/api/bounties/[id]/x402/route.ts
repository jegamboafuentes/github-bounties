import { getRuntimeDb } from "@/db/runtime";
import { handleX402Fund, jsonForUnknown } from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * x402 `exact` seller: payTo = gb-escrow, price = bounty face F.
 * Unpaid → 402. Settled → inbound recorded; poster Lock needs no hash paste.
 * Hosted checkout stays disabled (ADR 0001 / 0002).
 */
async function handle(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await handleX402Fund(req, id, { db: getRuntimeDb() });
    return Response.json(result.body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (err) {
    return Response.json(
      jsonForUnknown(err instanceof Error ? err.message : "x402 fund failed"),
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, ctx);
}
