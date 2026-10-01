import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { platformSettings } from "../db/schema";
import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../lib/constants";
import { insertAdminAudit } from "./audit";
import { AdminError } from "./errors";

export const FEE_BPS_MIN = 0;
export const FEE_BPS_MAX = 1000;
export const POOL_BPS_MIN = 1000;
export const POOL_BPS_MAX = 2000;

export type PlatformRates = {
  feeBps: number;
  poolBps: number;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export function assertFeeBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < FEE_BPS_MIN || value > FEE_BPS_MAX) {
    throw new AdminError(400, "invalid_fee_bps", "fee_bps must be an integer from 0 to 1000.");
  }
  return value;
}

export function assertPoolBps(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < POOL_BPS_MIN ||
    value > POOL_BPS_MAX
  ) {
    throw new AdminError(400, "invalid_pool_bps", "pool_bps must be an integer from 1000 to 2000.");
  }
  return value;
}

export async function readPlatformSettings(db: Database): Promise<PlatformRates> {
  const [row] = await db.select().from(platformSettings).limit(1);
  if (row) {
    return {
      feeBps: row.feeBps,
      poolBps: row.poolBps,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }
  const [created] = await db
    .insert(platformSettings)
    .values({ id: true, feeBps: FEE_BPS, poolBps: POOL_BPS_OF_POST_FEE })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return {
      feeBps: created.feeBps,
      poolBps: created.poolBps,
      updatedAt: created.updatedAt,
      updatedBy: created.updatedBy,
    };
  }
  const [again] = await db.select().from(platformSettings).limit(1);
  if (!again) throw new AdminError(500, "settings_missing", "Platform settings row is missing.");
  return {
    feeBps: again.feeBps,
    poolBps: again.poolBps,
    updatedAt: again.updatedAt,
    updatedBy: again.updatedBy,
  };
}

async function writeRates(
  db: Database,
  actorEmail: string,
  patch: { feeBps?: number; poolBps?: number },
  action: string,
): Promise<PlatformRates> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    const before = await readPlatformSettings(database);
    const next = {
      feeBps: patch.feeBps ?? before.feeBps,
      poolBps: patch.poolBps ?? before.poolBps,
    };
    await database
      .update(platformSettings)
      .set({
        feeBps: next.feeBps,
        poolBps: next.poolBps,
        updatedAt: now,
        updatedBy: actorEmail,
      })
      .where(eq(platformSettings.id, true));
    await insertAdminAudit(database, {
      actorEmail,
      action,
      target: "platform_settings",
      before: { feeBps: before.feeBps, poolBps: before.poolBps },
      after: next,
      result: "ok",
      now,
    });
    return { ...next, updatedAt: now, updatedBy: actorEmail };
  });
}

export async function setPlatformFeeBps(
  db: Database,
  actorEmail: string,
  feeBps: unknown,
): Promise<PlatformRates> {
  return writeRates(db, actorEmail, { feeBps: assertFeeBps(feeBps) }, "set_fee_bps");
}

export async function setPlatformPoolBps(
  db: Database,
  actorEmail: string,
  poolBps: unknown,
): Promise<PlatformRates> {
  return writeRates(db, actorEmail, { poolBps: assertPoolBps(poolBps) }, "set_pool_bps");
}
