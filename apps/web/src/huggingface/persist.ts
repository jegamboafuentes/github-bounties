import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { hfLinks } from "../db/schema";
import type { HfIdentity } from "./oauth";

export type HfLinkRow = typeof hfLinks.$inferSelect;

/** Another Google user already owns this Hugging Face account (`hf_sub`). */
export class HfAccountTakenError extends Error {
  readonly code = "hf_account_taken" as const;

  constructor() {
    super("That Hugging Face account is already linked to another user.");
    this.name = "HfAccountTakenError";
  }
}

export async function findHfLinkByUserId(userId: string, db: Database): Promise<HfLinkRow | null> {
  const [row] = await db.select().from(hfLinks).where(eq(hfLinks.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * One HF account per user (`user_id` unique) and one user per HF account (`hf_sub` unique).
 * A repeat connect for the same user updates username, avatar, and linked_at.
 * Does not store an access token.
 */
export async function linkHuggingFaceAccount(
  userId: string,
  identity: HfIdentity,
  db: Database,
): Promise<HfLinkRow> {
  if (!userId) {
    throw new Error("userId is required to link Hugging Face.");
  }
  const hfSub = identity.hfSub.trim();
  const hfUsername = identity.hfUsername.trim();
  if (!hfSub || !hfUsername) {
    throw new Error("Hugging Face sub and username are required.");
  }
  const avatar = identity.hfAvatarUrl?.trim() || null;

  const [owner] = await db
    .select({ userId: hfLinks.userId })
    .from(hfLinks)
    .where(eq(hfLinks.hfSub, hfSub))
    .limit(1);
  if (owner && owner.userId !== userId) {
    throw new HfAccountTakenError();
  }

  const now = new Date();
  try {
    const [row] = await db
      .insert(hfLinks)
      .values({
        userId,
        hfSub,
        hfUsername,
        hfAvatarUrl: avatar,
        linkedAt: now,
      })
      .onConflictDoUpdate({
        target: hfLinks.userId,
        set: {
          hfSub,
          hfUsername,
          hfAvatarUrl: avatar,
          linkedAt: now,
          unlinkedAt: null,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) {
      throw new Error("upsert hf_links returned no row");
    }
    return row;
  } catch (err) {
    if (err instanceof HfAccountTakenError) throw err;
    if (isUniqueViolation(err)) throw new HfAccountTakenError();
    throw err;
  }
}

/**
 * Unlink Hugging Face for one Google user.
 * Deletes that user's `hf_links` row only. Does not delete `users`, bounties, or claims.
 */
export async function deleteHfLinkByUserId(userId: string, db: Database): Promise<HfLinkRow | null> {
  const [row] = await db.delete(hfLinks).where(eq(hfLinks.userId, userId)).returning();
  return row ?? null;
}
