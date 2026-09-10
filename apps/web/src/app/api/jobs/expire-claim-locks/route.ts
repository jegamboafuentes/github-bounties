import { expireClaimLocks } from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";

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

  const result = await expireClaimLocks(getRuntimeDb());
  return Response.json(
    {
      ok: true,
      expired: result.expiredLockIds.length,
      restored_funded: result.restoredBountyIds.length,
      expired_lock_ids: result.expiredLockIds,
      restored_bounty_ids: result.restoredBountyIds,
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
