import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import { users } from "../db/schema";

export type GoogleIdentity = {
  googleSub: string;
  email: string;
  displayName: string;
};

export type UserRow = typeof users.$inferSelect;

/**
 * Create or update the product User keyed by google_sub.
 * Email and display_name refresh on each login.
 */
export async function upsertUserByGoogleSub(
  identity: GoogleIdentity,
  db: Database = getRuntimeDb(),
): Promise<UserRow> {
  const googleSub = identity.googleSub.trim();
  const email = identity.email.trim();
  const displayName = identity.displayName.trim() || email.split("@")[0] || "Google user";

  if (!googleSub) {
    throw new Error("google_sub is required to persist a user");
  }
  if (!email) {
    throw new Error("email is required to persist a user");
  }

  const [row] = await db
    .insert(users)
    .values({ googleSub, email, displayName })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email,
        displayName,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error("upsert users.google_sub returned no row");
  }
  return row;
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
}): GoogleIdentity | null {
  const googleSub = profile.sub?.trim() ?? "";
  const email = profile.email?.trim() ?? "";
  if (!googleSub || !email) return null;
  if (profile.email_verified === false) return null;
  const displayName = profile.name?.trim() || email.split("@")[0] || "Google user";
  return { googleSub, email, displayName };
}
