import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EligibilityDecision } from "./types.js";

export type StoredDelivery = {
  deliveryId: string;
  receivedAt: string;
  event: string;
  action?: string;
  decision?: EligibilityDecision;
};

type FileShape = { deliveries: Record<string, StoredDelivery> };

/**
 * Delivery-id store for webhook idempotency.
 *
 * GitHub redeliveries keep the same `X-GitHub-Delivery` GUID. Recording that
 * id before emitting eligibility logs prevents double "would mark claim eligible".
 *
 * In-memory by default; pass a file path for a spike-sized durable store.
 */
export class DeliveryStore {
  private deliveries = new Map<string, StoredDelivery>();

  constructor(private readonly filePath?: string) {
    if (this.filePath) {
      this.load();
    }
  }

  has(deliveryId: string): boolean {
    return this.deliveries.has(deliveryId);
  }

  get(deliveryId: string): StoredDelivery | undefined {
    return this.deliveries.get(deliveryId);
  }

  /**
   * Insert if absent. Returns true when this call won the insert
   * (first time we have seen the delivery).
   */
  recordIfNew(entry: StoredDelivery): boolean {
    if (this.deliveries.has(entry.deliveryId)) {
      return false;
    }
    this.deliveries.set(entry.deliveryId, entry);
    this.save();
    return true;
  }

  size(): number {
    return this.deliveries.size;
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      for (const [id, entry] of Object.entries(parsed.deliveries ?? {})) {
        this.deliveries.set(id, entry);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw err;
      }
    }
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const deliveries: Record<string, StoredDelivery> = {};
    for (const [id, entry] of this.deliveries) {
      deliveries[id] = entry;
    }
    writeFileSync(
      this.filePath,
      `${JSON.stringify({ deliveries }, null, 2)}\n`,
      "utf8",
    );
  }
}
