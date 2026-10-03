/**
 * Best-effort marketing contact writes from sign-up and GitHub link.
 * Callers use the safe wrappers. Those catch and log. They never throw.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { marketingContacts, users } from "../db/schema";
import { mergeContactSource, normalizeContactEmail, splitDisplayName } from "./normalize";
import { pushContactBestEffort, type ContactSyncRow } from "./resend";
import type { UtmTouch } from "./utm";

type SignupUser = {
  id: string;
  email: string;
  displayName: string;
};

function logContactFailure(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      error: error instanceof Error ? error.message.slice(0, 300) : "contact_failed",
    }),
  );
}

function syncRow(row: typeof marketingContacts.$inferSelect): ContactSyncRow {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    githubUsername: row.githubUsername,
    source: row.source,
    subscribed: row.subscribed,
    unsubscribedAt: row.unsubscribedAt,
    resendContactId: row.resendContactId,
    resendSyncedAt: row.resendSyncedAt,
    updatedAt: row.updatedAt,
  };
}

function contactUtm(touch: UtmTouch): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
} {
  return {
    utmSource: touch.source,
    utmMedium: touch.medium,
    utmCampaign: touch.campaign,
    utmContent: touch.content,
    utmTerm: touch.term,
  };
}

function contactHasUtm(row: {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}): boolean {
  return Boolean(row.utmSource || row.utmMedium || row.utmCampaign || row.utmContent || row.utmTerm);
}

/** Write first-touch fields only while `attributed_at` is still null. */
async function copyUserAttribution(db: Database, userId: string, touch: UtmTouch, now: Date): Promise<void> {
  await db
    .update(users)
    .set({
      utmSource: touch.source,
      utmMedium: touch.medium,
      utmCampaign: touch.campaign,
      utmContent: touch.content,
      utmTerm: touch.term,
      signupLandingPath: touch.path,
      attributedAt: now,
      updatedAt: now,
    })
    .where(and(eq(users.id, userId), isNull(users.attributedAt)));
}

/**
 * Upsert the mailbox for a newly created GHB user.
 * `subscribed` is true only on insert. An existing unsubscribe stays false.
 * An existing `lb1` row becomes `both`.
 * Attribution is copied onto the user and, when the contact has no utm yet, onto the contact.
 */
export async function recordSignupContact(
  db: Database,
  user: SignupUser,
  now: Date = new Date(),
  attribution: UtmTouch | null = null,
): Promise<void> {
  if (attribution) await copyUserAttribution(db, user.id, attribution, now);
  const email = normalizeContactEmail(user.email);
  if (!email) return;
  const names = splitDisplayName(user.displayName);
  const [existing] = await db
    .select()
    .from(marketingContacts)
    .where(eq(marketingContacts.email, email))
    .limit(1);
  if (!existing) {
    const [inserted] = await db
      .insert(marketingContacts)
      .values({
        email,
        firstName: names.firstName,
        lastName: names.lastName,
        source: "ghb",
        userId: user.id,
        subscribed: true,
        ...(attribution ? contactUtm(attribution) : {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (inserted) await pushContactBestEffort(db, syncRow(inserted));
    return;
  }
  const source = mergeContactSource(existing.source, "ghb");
  const userId = existing.userId && existing.userId !== user.id ? existing.userId : user.id;
  const firstName = existing.firstName ?? names.firstName;
  const lastName = existing.lastName ?? names.lastName;
  const utm = attribution && !contactHasUtm(existing) ? contactUtm(attribution) : null;
  if (
    source === existing.source &&
    userId === existing.userId &&
    firstName === existing.firstName &&
    lastName === existing.lastName &&
    !utm
  ) {
    return;
  }
  const [updated] = await db
    .update(marketingContacts)
    .set({
      source,
      userId,
      firstName,
      lastName,
      ...(utm ?? {}),
      updatedAt: now,
    })
    .where(eq(marketingContacts.id, existing.id))
    .returning();
  if (updated) await pushContactBestEffort(db, syncRow(updated));
}

export async function recordSignupContactSafe(
  db: Database,
  user: SignupUser,
  now: Date = new Date(),
  attribution: UtmTouch | null = null,
): Promise<void> {
  try {
    await recordSignupContact(db, user, now, attribution);
  } catch (err) {
    logContactFailure("marketing_contact_signup_failed", err);
  }
}

/** Fill `github_username` on the contact linked to this user. Does not change `subscribed`. */
export async function recordGithubUsernameOnContact(
  db: Database,
  input: { userId: string; githubUsername: string },
  now: Date = new Date(),
): Promise<void> {
  const login = input.githubUsername.trim().replace(/^@/, "");
  if (!login) return;
  const [byUser] = await db
    .select()
    .from(marketingContacts)
    .where(eq(marketingContacts.userId, input.userId))
    .limit(1);
  let row = byUser ?? null;
  if (!row) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const email = normalizeContactEmail(user?.email);
    if (!email) return;
    const [byEmail] = await db
      .select()
      .from(marketingContacts)
      .where(eq(marketingContacts.email, email))
      .limit(1);
    if (!byEmail || (byEmail.userId && byEmail.userId !== input.userId)) return;
    row = byEmail;
  }
  if (row.githubUsername === login && row.userId === input.userId) return;
  await db
    .update(marketingContacts)
    .set({
      githubUsername: login,
      userId: row.userId ?? input.userId,
      updatedAt: now,
    })
    .where(eq(marketingContacts.id, row.id));
}

export async function recordGithubUsernameSafe(
  db: Database,
  input: { userId: string; githubUsername: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    await recordGithubUsernameOnContact(db, input, now);
  } catch (err) {
    logContactFailure("marketing_contact_github_failed", err);
  }
}
