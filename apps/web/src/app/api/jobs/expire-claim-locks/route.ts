import { expireClaimLocks } from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";
import { expireUnmergedBounties } from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * Cron-friendly expiry. Cloud Scheduler can GET or POST.
 * If CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`.
 * Never commit that secret.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const db = getRuntimeDb();
  const result = await expireClaimLocks(db);
  const money = await expireUnmergedBounties({ db });
  return Response.json(
    {
      ok: true,
      expired: result.expiredLockIds.length,
      restored_funded: result.restoredBountyIds.length,
      expired_lock_ids: result.expiredLockIds,
      restored_bounty_ids: result.restoredBountyIds,
      refunded_expired_bounties: money.refundedBountyIds.length,
      voided_expired_bounties: money.voidedBountyIds.length,
      refund_errors: money.errors,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
