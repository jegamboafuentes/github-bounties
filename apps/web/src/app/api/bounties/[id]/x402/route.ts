import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import { handleX402Fund, jsonForUnknown } from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * x402 `exact` seller: payTo = gb-escrow.
 * First fund prices the face. `?topUpUsdc=` on a funded bounty prices the added amount.
 * Unpaid → 402. First settle records inbound; poster Lock needs no hash paste.
 * A settled top-up increases face immediately. Hosted checkout stays disabled.
 */
async function handle(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const topUp = new URL(req.url).searchParams.get("topUpUsdc")?.trim();
  const user = topUp ? await getCurrentPublicUser() : null;
  try {
    const result = await handleX402Fund(req, id, {
      db: getRuntimeDb(),
      actorUserId: user?.id ?? null,
    });
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
