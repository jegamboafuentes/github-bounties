import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { marketingContacts, type MarketingContactSource } from "../db/schema";
import { csvRecords } from "./csv";
import { blankToNull, mergeContactSource, normalizeImportedEmail, parseContactSource } from "./normalize";

const MASTER_COLUMNS = [
  "email",
  "first_name",
  "last_name",
  "github_username",
  "source",
  "lb1_status",
  "contact_type",
] as const;

export type ImportCounts = {
  inserted: number;
  updated: number;
  unsubscribed: number;
};

export type PlannedContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  githubUsername: string | null;
  source: MarketingContactSource;
  lb1Status: string | null;
  contactType: string | null;
  subscribed: boolean;
};

function requireColumns(records: Record<string, string>[], extra: string[], label: string): void {
  const sample = records[0];
  if (!sample) return;
  for (const column of [...MASTER_COLUMNS, ...extra]) {
    if (!(column in sample)) {
      throw new Error(`${label} is missing the ${column} column`);
    }
  }
}

function plannedRow(record: Record<string, string>, subscribed: boolean, rowNumber: number): PlannedContact {
  const email = normalizeImportedEmail(record.email);
  if (!email) throw new Error(`invalid email on ${subscribed ? "master" : "suppressed"} row ${rowNumber}`);
  const source = parseContactSource(record.source);
  if (!source) throw new Error(`invalid source on row ${rowNumber}`);
  return {
    email,
    firstName: blankToNull(record.first_name),
    lastName: blankToNull(record.last_name),
    githubUsername: blankToNull(record.github_username),
    source,
    lb1Status: blankToNull(record.lb1_status),
    contactType: blankToNull(record.contact_type),
    subscribed,
  };
}

/**
 * Master rows subscribe. Suppressed rows unsubscribe. The same email in both files
 * keeps the suppressed row. Counts are applied later so an existing unsubscribe wins.
 */
export function planContactImport(masterCsv: string, suppressedCsv: string): PlannedContact[] {
  const master = csvRecords(masterCsv);
  const suppressed = csvRecords(suppressedCsv);
  requireColumns(master, [], "master_list.csv");
  requireColumns(suppressed, ["suppression_reason"], "suppressed.csv");
  const byEmail = new Map<string, PlannedContact>();
  master.forEach((record, index) => {
    const row = plannedRow(record, true, index + 2);
    byEmail.set(row.email, row);
  });
  suppressed.forEach((record, index) => {
    const row = plannedRow(record, false, index + 2);
    byEmail.set(row.email, row);
  });
  return [...byEmail.values()];
}

function sameText(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

/**
 * Upsert by lowercase email. An existing unsubscribed row stays unsubscribed.
 * `inserted` counts new rows. `unsubscribed` counts rows this run set or inserted
 * as unsubscribed. `updated` counts other field changes.
 */
export async function importMarketingContacts(
  db: Database,
  rows: PlannedContact[],
  now: Date = new Date(),
): Promise<ImportCounts> {
  const counts: ImportCounts = { inserted: 0, updated: 0, unsubscribed: 0 };
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const [existing] = await tx
        .select()
        .from(marketingContacts)
        .where(eq(marketingContacts.email, row.email))
        .limit(1);
      const subscribed = existing && !existing.subscribed ? false : row.subscribed;
      const source = mergeContactSource(existing?.source ?? null, row.source);
      if (!existing) {
        await tx.insert(marketingContacts).values({
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          githubUsername: row.githubUsername,
          source,
          lb1Status: row.lb1Status,
          contactType: row.contactType,
          subscribed,
          unsubscribedAt: subscribed ? null : now,
          createdAt: now,
          updatedAt: now,
        });
        counts.inserted += 1;
        if (!subscribed) counts.unsubscribed += 1;
        continue;
      }
      const becameUnsubscribed = existing.subscribed && !subscribed;
      const fieldsChanged =
        !sameText(existing.firstName, row.firstName) ||
        !sameText(existing.lastName, row.lastName) ||
        !sameText(existing.githubUsername, row.githubUsername) ||
        existing.source !== source ||
        !sameText(existing.lb1Status, row.lb1Status) ||
        !sameText(existing.contactType, row.contactType) ||
        becameUnsubscribed;
      if (!fieldsChanged) continue;
      await tx
        .update(marketingContacts)
        .set({
          firstName: row.firstName,
          lastName: row.lastName,
          githubUsername: row.githubUsername,
          source,
          lb1Status: row.lb1Status,
          contactType: row.contactType,
          subscribed,
          unsubscribedAt: subscribed ? existing.unsubscribedAt : (existing.unsubscribedAt ?? now),
          updatedAt: now,
        })
        .where(eq(marketingContacts.id, existing.id));
      if (becameUnsubscribed) counts.unsubscribed += 1;
      else counts.updated += 1;
    }
  });
  return counts;
}

export async function importMarketingContactsFromCsv(
  db: Database,
  input: { master: string; suppressed: string; now?: Date },
): Promise<ImportCounts> {
  return importMarketingContacts(db, planContactImport(input.master, input.suppressed), input.now);
}
