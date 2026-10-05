import { pollHfMerges } from "@/bounties/hf-merge-poller";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

/**
 * Cron for open funded Hugging Face bounties that have a submitted pull request.
 * This repo does not create the schedule. Ops runs a Cloud Scheduler job that
 * calls this route with the cron secret, same bearer as poll-public-merges.
 * GET or POST. If CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`.
 *
 * CLI (same function): `cd apps/web && npm run poll-hf-merges`
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await pollHfMerges(getRuntimeDb());
  return Response.json(
    {
      ok: true,
      skipped: result.skipped ?? null,
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
