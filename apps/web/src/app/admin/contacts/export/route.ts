import { insertAdminAudit } from "@/admin/audit";
import { requireAdminPageUser } from "@/admin/gate";
import { exportMarketingContactsCsv, parseContactListQuery } from "@/contacts/query";
import { PublicApiError } from "@/api/public/errors";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdminPageUser();
  const url = new URL(request.url);
  let query;
  try {
    query = parseContactListQuery({
      search: url.searchParams.get("search") ?? url.searchParams.get("q"),
      source: url.searchParams.get("source"),
      subscribed: url.searchParams.get("subscribed"),
      utmCampaign: url.searchParams.get("utm_campaign") ?? url.searchParams.get("utmCampaign"),
      limit: 1,
      offset: 0,
    });
  } catch (err) {
    if (err instanceof PublicApiError) {
      return Response.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status, headers: { "cache-control": "no-store" } },
      );
    }
    throw err;
  }
  const db = getRuntimeDb();
  const exported = await exportMarketingContactsCsv(db, query);
  await insertAdminAudit(db, {
    actorEmail: admin.email,
    action: "contacts_export",
    target: "marketing_contacts",
    after: {
      count: exported.count,
      search: query.search || null,
      source: query.source,
      subscribed: query.subscribed,
      utmCampaign: query.utmCampaign,
    },
    result: "ok",
  });
  return new Response(exported.csv, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"contacts.csv\"",
    },
  });
}
