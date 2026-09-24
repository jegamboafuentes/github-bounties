import { pollPublicMerges } from "@/bounties/public-merge-poller";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

/**
 * Cron for funded bounties on public GitHub repos that have no App installation.
 * The job runs on DEV and PROD. PROD uses Cloud Scheduler `gb-prod-poll-public-merges` every 10 minutes.
 * Cloud Scheduler can GET or POST. Same bearer as expire-claim-locks.
 * If CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`.
 *
 * CLI (same function): `cd apps/web && npm run poll-public-merges`
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await pollPublicMerges(getRuntimeDb());
  return Response.json(
    {
      ok: true,
      scanned: result.scanned,
      eligible: result.eligible,
      claims_written: result.claimsWritten,
      duplicates: result.duplicates,
      errors: result.errors,
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
