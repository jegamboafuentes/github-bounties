import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import { users } from "../db/schema";

export type GoogleIdentity = {
  googleSub: string;
  email: string;
  displayName: string;
  /** https Google profile picture, or null when absent / not https. */
  avatarUrl: string | null;
};

export type UpsertUserResult = {
  user: UserRow;
  /** True only when this call inserted the google_sub row. */
  created: boolean;
};

export type UpsertUserOptions = {
  now?: Date;
};

export type UserRow = typeof users.$inferSelect;

/**
 * https profile pictures only. http, data, and javascript URLs are dropped.
 */
export function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Create or update the product User keyed by google_sub.
 * Repeat login updates email, display name, https avatar (when present),
 * and last_seen_at. created_at and the primary key stay put. The unique
 * google_sub index is what prevents a second row.
 */
export async function upsertUserByGoogleSub(
  identity: GoogleIdentity,
  db: Database = getRuntimeDb(),
  options: UpsertUserOptions = {},
): Promise<UpsertUserResult> {
  const googleSub = identity.googleSub.trim();
  const email = identity.email.trim();
  const displayName = identity.displayName.trim() || email.split("@")[0] || "Google user";
  const avatarUrl = normalizeAvatarUrl(identity.avatarUrl);
  const now = options.now ?? new Date();

  if (!googleSub) {
    throw new Error("google_sub is required to persist a user");
  }
  if (!email) {
    throw new Error("email is required to persist a user");
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(users)
      .values({
        googleSub,
        email,
        displayName,
        avatarUrl,
        lastSeenAt: now,
      })
      .onConflictDoNothing({ target: users.googleSub })
      .returning();

    if (inserted) {
      return { user: inserted, created: true };
    }

    const [updated] = await tx
      .update(users)
      .set({
        email,
        displayName,
        ...(avatarUrl ? { avatarUrl } : {}),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(users.googleSub, googleSub))
      .returning();

    if (!updated) {
      throw new Error("upsert users.google_sub returned no row");
    }
    return { user: updated, created: false };
  });
}

export async function findUserById(
  id: string,
  db: Database = getRuntimeDb(),
): Promise<UserRow | null> {
  if (!id) return null;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** Persist a BYO Base payout address on the signed-in user. */
export async function setUserWalletAddress(
  userId: string,
  walletAddress: string,
  db: Database = getRuntimeDb(),
): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({ walletAddress, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) {
    throw new Error("user not found");
  }
  return row;
}

export function identityFromGoogleProfile(profile: {
  sub?: string | null;
  email?: string | null;
  name?: string | null;
  email_verified?: boolean | null;
  picture?: string | null;
  image?: string | null;
}): GoogleIdentity | null {
  const googleSub = profile.sub?.trim() ?? "";
  const email = profile.email?.trim() ?? "";
  if (!googleSub || !email) return null;
  if (profile.email_verified === false) return null;
  const displayName = profile.name?.trim() || email.split("@")[0] || "Google user";
  const avatarUrl = normalizeAvatarUrl(profile.picture ?? profile.image);
  return { googleSub, email, displayName, avatarUrl };
}
