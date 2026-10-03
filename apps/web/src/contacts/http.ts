import type { AccessDeps } from "../api/access/deps";
import type { ApiPrincipal, ApiResult } from "../api/access/handlers";
import { requireScope } from "../api/access/policy";
import { PublicApiError } from "../api/public/errors";
import { isAdminIdentity } from "../admin/identity";
import { getRuntimeDb } from "../db/runtime";
import { countMarketingContacts, listMarketingContacts, parseContactListQuery } from "./query";

export async function requireAdminContactPrincipal(
  principal: ApiPrincipal,
  deps: AccessDeps,
): Promise<{ email: string }> {
  requireScope(principal.scopes, "admin");
  const actor = await deps.loadAdminActor?.(principal.userId);
  if (
    !actor ||
    !isAdminIdentity(
      { email: actor.email, googleSub: actor.googleSub, sessionGoogleSub: actor.googleSub },
      deps.env,
    )
  ) {
    throw new PublicApiError("forbidden_scope", "This API key is missing the admin scope.", { required: "admin" });
  }
  return { email: actor.email.trim().toLowerCase() };
}

export async function handleListContacts(
  principal: ApiPrincipal,
  url: URL,
  deps: AccessDeps,
): Promise<ApiResult> {
  await requireAdminContactPrincipal(principal, deps);
  const query = parseContactListQuery({
    search: url.searchParams.get("search") ?? url.searchParams.get("q"),
    source: url.searchParams.get("source"),
    subscribed: url.searchParams.get("subscribed"),
    utmCampaign: url.searchParams.get("utm_campaign") ?? url.searchParams.get("utmCampaign"),
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const page = await listMarketingContacts(getRuntimeDb(), query);
  return { status: 200, body: page };
}

export async function handleCountContacts(principal: ApiPrincipal, deps: AccessDeps): Promise<ApiResult> {
  await requireAdminContactPrincipal(principal, deps);
  const counts = await countMarketingContacts(getRuntimeDb());
  return { status: 200, body: counts };
}

export async function handleListContactsArgs(
  principal: ApiPrincipal,
  args: {
    search?: string;
    source?: string;
    subscribed?: boolean;
    utm_campaign?: string;
    limit?: number;
    offset?: number;
  },
  deps: AccessDeps,
): Promise<ApiResult> {
  await requireAdminContactPrincipal(principal, deps);
  const query = parseContactListQuery({
    search: args.search,
    source: args.source,
    subscribed: args.subscribed,
    utmCampaign: args.utm_campaign,
    limit: args.limit,
    offset: args.offset,
  });
  const page = await listMarketingContacts(getRuntimeDb(), query);
  return { status: 200, body: page };
}
