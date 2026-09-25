import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { githubLinks, userNotificationPreferences, users, type EmailTemplateName } from "../db/schema";

export const DISPLAY_NAME_MAX = 80;

const CONTROL_OR_ANGLE = /[\u0000-\u001F\u007F<>]/;
const ETH_ADDRESS = /0x[a-fA-F0-9]{40}/;

const WALLET_PATCH_KEYS = new Set([
  "wallet",
  "walletaddress",
  "wallet_address",
  "payoutaddress",
  "payout_address",
  "payoutwallet",
  "payout_wallet",
  "address",
  "payto",
  "pay_to",
  "destination",
]);

export class DisplayNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayNameError";
  }
}

export type AccountProfile = {
  id: string;
  displayName: string;
  displayNameCustom: boolean;
  email: string;
};

export type EmailNotificationPrefs = {
  bountyFunded: boolean;
  prMerged: boolean;
  bountySettled: boolean;
  poolClaimable: boolean;
};

export const DEFAULT_EMAIL_NOTIFICATION_PREFS: EmailNotificationPrefs = {
  bountyFunded: true,
  prMerged: true,
  bountySettled: true,
  poolClaimable: true,
};

export type LinkedAccounts = {
  google: { email: string };
  github: { login: string; id: string; linkedAt: string } | null;
  wallet: { address: string | null };
};

/**
 * Trim, collapse internal whitespace, then enforce 1–80 code points.
 * Control characters, angle brackets, and an embedded 0x address are rejected.
 */
export function parseDisplayName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DisplayNameError("Display name must be 1–80 characters.");
  }
  const trimmed = raw.trim();
  if (CONTROL_OR_ANGLE.test(trimmed)) {
    throw new DisplayNameError("Display name cannot include control characters or angle brackets.");
  }
  const displayName = trimmed.replace(/ +/g, " ");
  const length = Array.from(displayName).length;
  if (length < 1 || length > DISPLAY_NAME_MAX) {
    throw new DisplayNameError("Display name must be 1–80 characters.");
  }
  if (ETH_ADDRESS.test(displayName)) {
    throw new DisplayNameError("Display name cannot contain a wallet address.");
  }
  return displayName;
}

/** Field names on a PATCH body that would change a payout wallet. Original key casing is kept. */
export function walletPatchFieldNames(value: unknown): string[] {
  const found: string[] = [];
  collectWalletKeys(value, found);
  return found;
}

function collectWalletKeys(value: unknown, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectWalletKeys(item, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (WALLET_PATCH_KEYS.has(key.toLowerCase())) found.push(key);
    collectWalletKeys(child, found);
  }
}

export async function loadAccountProfile(db: Database, userId: string): Promise<AccountProfile | null> {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      displayNameCustom: users.displayNameCustom,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function saveDisplayName(
  db: Database,
  userId: string,
  raw: unknown,
): Promise<AccountProfile | null> {
  const displayName = parseDisplayName(raw);
  const [row] = await db
    .update(users)
    .set({ displayName, displayNameCustom: true, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      displayName: users.displayName,
      displayNameCustom: users.displayNameCustom,
      email: users.email,
    });
  return row ?? null;
}

export async function loadEmailNotificationPreferences(
  db: Database,
  userId: string,
): Promise<EmailNotificationPrefs> {
  const [row] = await db
    .select({
      bountyFunded: userNotificationPreferences.emailBountyFunded,
      prMerged: userNotificationPreferences.emailPrMerged,
      bountySettled: userNotificationPreferences.emailBountySettled,
      poolClaimable: userNotificationPreferences.emailPoolClaimable,
    })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1);
  return row ?? { ...DEFAULT_EMAIL_NOTIFICATION_PREFS };
}

export async function saveEmailNotificationPreferences(
  db: Database,
  userId: string,
  patch: Partial<EmailNotificationPrefs>,
): Promise<EmailNotificationPrefs | null> {
  const user = await loadAccountProfile(db, userId);
  if (!user) return null;
  const current = await loadEmailNotificationPreferences(db, userId);
  const next: EmailNotificationPrefs = {
    bountyFunded: patch.bountyFunded ?? current.bountyFunded,
    prMerged: patch.prMerged ?? current.prMerged,
    bountySettled: patch.bountySettled ?? current.bountySettled,
    poolClaimable: patch.poolClaimable ?? current.poolClaimable,
  };
  await db
    .insert(userNotificationPreferences)
    .values({
      userId,
      emailBountyFunded: next.bountyFunded,
      emailPrMerged: next.prMerged,
      emailBountySettled: next.bountySettled,
      emailPoolClaimable: next.poolClaimable,
    })
    .onConflictDoUpdate({
      target: userNotificationPreferences.userId,
      set: {
        emailBountyFunded: next.bountyFunded,
        emailPrMerged: next.prMerged,
        emailBountySettled: next.bountySettled,
        emailPoolClaimable: next.poolClaimable,
        updatedAt: new Date(),
      },
    });
  return next;
}

/** Welcome is always sent. Other templates follow the stored flags, defaulting to on. */
export async function isEmailTemplateEnabled(
  db: Database,
  userId: string,
  template: EmailTemplateName,
): Promise<boolean> {
  if (template === "welcome") return true;
  const prefs = await loadEmailNotificationPreferences(db, userId);
  switch (template) {
    case "bounty_funded":
      return prefs.bountyFunded;
    case "pr_merged":
      return prefs.prMerged;
    case "bounty_settled":
      return prefs.bountySettled;
    case "pool_claimable":
      return prefs.poolClaimable;
  }
}

export async function loadLinkedAccounts(db: Database, userId: string): Promise<LinkedAccounts | null> {
  const [user] = await db
    .select({ email: users.email, walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const [link] = await db
    .select({
      githubLogin: githubLinks.githubLogin,
      githubId: githubLinks.githubId,
      linkedAt: githubLinks.linkedAt,
    })
    .from(githubLinks)
    .where(eq(githubLinks.userId, userId))
    .limit(1);
  return {
    google: { email: user.email },
    github: link
      ? { login: link.githubLogin, id: link.githubId.toString(), linkedAt: link.linkedAt.toISOString() }
      : null,
    wallet: { address: user.walletAddress },
  };
}
