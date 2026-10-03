import { cronUnauthorized, syncMarketingContacts } from "@/contacts/resend";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

/**
 * Push stale marketing contacts and pull audience unsubscribes.
 * If CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`.
 * If RESEND_AUDIENCE_ID is unset, the sync is a no-op.
 * This repo does not create the schedule. Ops points Cloud Scheduler here.
 */
async function run(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const result = await syncMarketingContacts(getRuntimeDb());
  return Response.json(
    { ok: true, ...result },
    { headers: { "cache-control": "no-store" } },
  );
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
