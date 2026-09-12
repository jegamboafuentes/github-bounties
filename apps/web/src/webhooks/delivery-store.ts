import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { webhookDeliveries } from "../db/schema";
import type { ClaimWriteResult, EligibilityDecision } from "./types";

export type StoredDelivery = {
  deliveryId: string;
  event: string;
  action?: string | null;
  eligible?: boolean | null;
  winnerLogin?: string | null;
  pullRequestNumber?: number | null;
  repositoryFullName?: string | null;
  claimResults?: ClaimWriteResult[] | null;
  receivedAt?: Date;
};

export type DeliveryRecordInput = {
  deliveryId: string;
  event: string;
  action?: string;
  decision?: EligibilityDecision;
  claims?: ClaimWriteResult[];
};

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code?: string }).code === "23505"
    ) {
      return true;
    }
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "object" &&
            current !== null &&
            "message" in current
          ? String((current as { message?: unknown }).message)
          : "";
    if (/duplicate key|unique constraint|23505/i.test(message)) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function outcomeFields(entry: DeliveryRecordInput): {
  eligible: boolean | null;
  winnerLogin: string | null;
  pullRequestNumber: number | null;
  repositoryFullName: string | null;
  claimResults: ClaimWriteResult[] | null;
} {
  return {
    eligible: entry.decision?.eligible ?? null,
    winnerLogin: entry.decision?.winnerLogin ?? null,
    pullRequestNumber: entry.decision?.pullRequestNumber ?? null,
    repositoryFullName: entry.decision?.repositoryFullName || null,
    claimResults: entry.claims ?? null,
  };
}

function toStoredDelivery(row: typeof webhookDeliveries.$inferSelect): StoredDelivery {
  return {
    deliveryId: row.deliveryId,
    event: row.event,
    action: row.action,
    eligible: row.eligible,
    winnerLogin: row.winnerLogin,
    pullRequestNumber: row.pullRequestNumber,
    repositoryFullName: row.repositoryFullName,
    claimResults: row.claimResults ?? null,
    receivedAt: row.receivedAt,
  };
}

export async function getDelivery(
  deliveryId: string,
  db: Database,
): Promise<StoredDelivery | undefined> {
  const [row] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, deliveryId))
    .limit(1);
  return row ? toStoredDelivery(row) : undefined;
}

/**
 * Insert if absent. Returns true when this call won the insert.
 * Unique on `delivery_id` makes concurrent replays safe.
 */
export async function recordDeliveryIfNew(
  entry: DeliveryRecordInput,
  db: Database,
): Promise<boolean> {
  const existing = await getDelivery(entry.deliveryId, db);
  if (existing) return false;
  try {
    await db.insert(webhookDeliveries).values({
      deliveryId: entry.deliveryId,
      event: entry.event,
      action: entry.action,
      ...outcomeFields(entry),
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export async function updateDeliveryOutcome(
  entry: DeliveryRecordInput,
  db: Database,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set(outcomeFields(entry))
    .where(eq(webhookDeliveries.deliveryId, entry.deliveryId));
}

export type DeliveryRecorder = {
  get(deliveryId: string): Promise<StoredDelivery | undefined>;
  recordIfNew(entry: DeliveryRecordInput): Promise<boolean>;
  updateOutcome(entry: DeliveryRecordInput): Promise<void>;
};

export function postgresDeliveryRecorder(db: Database): DeliveryRecorder {
  return {
    get: (deliveryId) => getDelivery(deliveryId, db),
    recordIfNew: (entry) => recordDeliveryIfNew(entry, db),
    updateOutcome: (entry) => updateDeliveryOutcome(entry, db),
  };
}

/** In-memory recorder for unit tests (same contract as V0 DeliveryStore). */
export function memoryDeliveryRecorder(): DeliveryRecorder {
  const map = new Map<string, StoredDelivery>();
  return {
    async get(deliveryId) {
      return map.get(deliveryId);
    },
    async recordIfNew(entry) {
      if (map.has(entry.deliveryId)) return false;
      map.set(entry.deliveryId, {
        deliveryId: entry.deliveryId,
        event: entry.event,
        action: entry.action,
        ...outcomeFields(entry),
      });
      return true;
    },
    async updateOutcome(entry) {
      const current = map.get(entry.deliveryId);
      if (!current) return;
      map.set(entry.deliveryId, {
        ...current,
        ...outcomeFields(entry),
      });
    },
  };
}
