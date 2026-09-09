import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { webhookDeliveries } from "../db/schema";
import type { EligibilityDecision } from "./types";

export type StoredDelivery = {
  deliveryId: string;
  event: string;
  action?: string | null;
  eligible?: boolean | null;
  receivedAt?: Date;
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

export async function getDelivery(
  deliveryId: string,
  db: Database,
): Promise<StoredDelivery | undefined> {
  const [row] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, deliveryId))
    .limit(1);
  return row;
}

/**
 * Insert if absent. Returns true when this call won the insert.
 * Unique on `delivery_id` makes concurrent replays safe.
 */
export async function recordDeliveryIfNew(
  entry: {
    deliveryId: string;
    event: string;
    action?: string;
    decision?: EligibilityDecision;
  },
  db: Database,
): Promise<boolean> {
  const existing = await getDelivery(entry.deliveryId, db);
  if (existing) return false;
  try {
    await db.insert(webhookDeliveries).values({
      deliveryId: entry.deliveryId,
      event: entry.event,
      action: entry.action,
      eligible: entry.decision?.eligible ?? null,
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export type DeliveryRecorder = {
  get(deliveryId: string): Promise<StoredDelivery | undefined>;
  recordIfNew(entry: {
    deliveryId: string;
    event: string;
    action?: string;
    decision?: EligibilityDecision;
  }): Promise<boolean>;
};

export function postgresDeliveryRecorder(db: Database): DeliveryRecorder {
  return {
    get: (deliveryId) => getDelivery(deliveryId, db),
    recordIfNew: (entry) => recordDeliveryIfNew(entry, db),
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
        eligible: entry.decision?.eligible,
      });
      return true;
    },
  };
}
