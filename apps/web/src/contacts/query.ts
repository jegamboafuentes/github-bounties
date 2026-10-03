import { and, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { PublicApiError } from "../api/public/errors";
import { marketingContacts, type MarketingContactSource } from "../db/schema";
import { toCsv } from "./csv";
import { parseContactSource } from "./normalize";
import { sanitizeUtmValue } from "./utm";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const EXPORT_LIMIT = 5000;

export type ContactListQuery = {
  search: string;
  source: MarketingContactSource | null;
  subscribed: boolean | null;
  utmCampaign: string | null;
  limit: number;
  offset: number;
};

export type MarketingContactView = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  githubUsername: string | null;
  userId: string | null;
  source: MarketingContactSource;
  lb1Status: string | null;
  contactType: string | null;
  subscribed: boolean;
  unsubscribedAt: string | null;
  resendContactId: string | null;
  resendSyncedAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactListPage = {
  contacts: MarketingContactView[];
  total: number;
  limit: number;
  offset: number;
};

export type ContactBreakdown = {
  value: string;
  total: number;
};

export type ContactCounts = {
  total: number;
  subscribed: number;
  unsubscribed: number;
  bySource: Record<MarketingContactSource, number>;
  byCampaign: ContactBreakdown[];
  byContent: ContactBreakdown[];
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseBoundedInt(
  value: number | string | null | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new PublicApiError("validation_failed", `${label} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseContactListQuery(input: {
  search?: string | null;
  source?: string | null;
  subscribed?: string | boolean | null;
  utmCampaign?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
}): ContactListQuery {
  const search = input.search?.trim() ?? "";
  if (search.length > 200) {
    throw new PublicApiError("validation_failed", "Search must be 200 characters or fewer.");
  }
  let source: MarketingContactSource | null = null;
  const rawSource = input.source?.trim() ?? "";
  if (rawSource) {
    source = parseContactSource(rawSource);
    if (!source) {
      throw new PublicApiError("validation_failed", "source must be ghb, lb1, or both.");
    }
  }
  let subscribed: boolean | null = null;
  if (typeof input.subscribed === "boolean") {
    subscribed = input.subscribed;
  } else if (input.subscribed != null && input.subscribed !== "") {
    if (input.subscribed === "true") subscribed = true;
    else if (input.subscribed === "false") subscribed = false;
    else throw new PublicApiError("validation_failed", "subscribed must be true or false.");
  }
  let utmCampaign: string | null = null;
  const rawCampaign = input.utmCampaign?.trim() ?? "";
  if (rawCampaign) {
    const cleaned = sanitizeUtmValue(rawCampaign);
    if (!cleaned || cleaned !== rawCampaign) {
      throw new PublicApiError("validation_failed", "utm_campaign must be 1–100 characters from [A-Za-z0-9_.-].");
    }
    utmCampaign = cleaned;
  }
  return {
    search,
    source,
    subscribed,
    utmCampaign,
    limit: parseBoundedInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, "limit"),
    offset: parseBoundedInt(input.offset, 0, 0, 100_000, "offset"),
  };
}

function filters(query: Pick<ContactListQuery, "search" | "source" | "subscribed" | "utmCampaign">): SQL | undefined {
  const parts: SQL[] = [];
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    const match = or(
      ilike(marketingContacts.email, pattern),
      ilike(marketingContacts.firstName, pattern),
      ilike(marketingContacts.lastName, pattern),
      ilike(marketingContacts.githubUsername, pattern),
    );
    if (match) parts.push(match);
  }
  if (query.source) parts.push(eq(marketingContacts.source, query.source));
  if (query.subscribed != null) parts.push(eq(marketingContacts.subscribed, query.subscribed));
  if (query.utmCampaign) parts.push(eq(marketingContacts.utmCampaign, query.utmCampaign));
  if (parts.length === 0) return undefined;
  return and(...parts);
}

function view(row: typeof marketingContacts.$inferSelect): MarketingContactView {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    githubUsername: row.githubUsername,
    userId: row.userId,
    source: row.source,
    lb1Status: row.lb1Status,
    contactType: row.contactType,
    subscribed: row.subscribed,
    unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    resendContactId: row.resendContactId,
    resendSyncedAt: row.resendSyncedAt?.toISOString() ?? null,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmContent: row.utmContent,
    utmTerm: row.utmTerm,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMarketingContacts(db: Database, query: ContactListQuery): Promise<ContactListPage> {
  const where = filters(query);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(marketingContacts)
    .where(where);
  const rows = await db
    .select()
    .from(marketingContacts)
    .where(where)
    .orderBy(desc(marketingContacts.createdAt), desc(marketingContacts.id))
    .limit(query.limit)
    .offset(query.offset);
  return {
    contacts: rows.map(view),
    total: Number(countRow?.total ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function countMarketingContacts(db: Database): Promise<ContactCounts> {
  const rows = await db
    .select({
      source: marketingContacts.source,
      subscribed: marketingContacts.subscribed,
      total: sql<number>`count(*)::int`,
    })
    .from(marketingContacts)
    .groupBy(marketingContacts.source, marketingContacts.subscribed);
  const counts: ContactCounts = {
    total: 0,
    subscribed: 0,
    unsubscribed: 0,
    bySource: { ghb: 0, lb1: 0, both: 0 },
    byCampaign: [],
    byContent: [],
  };
  for (const row of rows) {
    const total = Number(row.total ?? 0);
    counts.total += total;
    if (row.subscribed) counts.subscribed += total;
    else counts.unsubscribed += total;
    counts.bySource[row.source] += total;
  }
  counts.byCampaign = await breakdown(db, "campaign");
  counts.byContent = await breakdown(db, "content");
  return counts;
}

async function breakdown(db: Database, field: "campaign" | "content"): Promise<ContactBreakdown[]> {
  const column = field === "campaign" ? marketingContacts.utmCampaign : marketingContacts.utmContent;
  const rows = await db
    .select({
      value: column,
      total: sql<number>`count(*)::int`,
    })
    .from(marketingContacts)
    .where(isNotNull(column))
    .groupBy(column)
    .orderBy(desc(sql`count(*)`), column);
  return rows.flatMap((row) => (row.value ? [{ value: row.value, total: Number(row.total ?? 0) }] : []));
}

const CSV_HEADER = [
  "email",
  "first_name",
  "last_name",
  "github_username",
  "source",
  "lb1_status",
  "contact_type",
  "subscribed",
  "unsubscribed_at",
  "user_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

export async function exportMarketingContactsCsv(
  db: Database,
  query: Pick<ContactListQuery, "search" | "source" | "subscribed" | "utmCampaign">,
): Promise<{ csv: string; count: number }> {
  const page = await listMarketingContacts(db, { ...query, limit: EXPORT_LIMIT, offset: 0 });
  const csv = toCsv(
    CSV_HEADER,
    page.contacts.map((row) => [
      row.email,
      row.firstName ?? "",
      row.lastName ?? "",
      row.githubUsername ?? "",
      row.source,
      row.lb1Status ?? "",
      row.contactType ?? "",
      row.subscribed ? "true" : "false",
      row.unsubscribedAt ?? "",
      row.userId ?? "",
      row.utmSource ?? "",
      row.utmMedium ?? "",
      row.utmCampaign ?? "",
      row.utmContent ?? "",
      row.utmTerm ?? "",
    ]),
  );
  return { csv, count: page.contacts.length };
}
