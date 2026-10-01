import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { platformSettings } from "../db/schema";
import { FEE_BPS, POOL_BPS_OF_POST_FEE } from "../lib/constants";
import { insertAdminAudit } from "./audit";
import { AdminError, isAdminError } from "./errors";
import { bpsToPercent, resolveFeeBps, resolvePoolBps } from "./percent";

export {
  assertFeeBps,
  assertFeePercent,
  assertPoolBps,
  assertPoolPercent,
  bpsToPercent,
  FEE_BPS_MAX,
  FEE_BPS_MIN,
  FEE_PERCENT_RANGE,
  POOL_BPS_MAX,
  POOL_BPS_MIN,
  POOL_PERCENT_RANGE,
  resolveFeeBps,
  resolvePoolBps,
} from "./percent";

export type PlatformRates = {
  feeBps: number;
  poolBps: number;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export function platformRatesJson(settings: PlatformRates, opts?: { includeAudit?: boolean }) {
  const body = {
    feeBps: settings.feeBps,
    feePercent: bpsToPercent(settings.feeBps),
    poolBps: settings.poolBps,
    poolPercent: bpsToPercent(settings.poolBps),
  };
  if (!opts?.includeAudit) return body;
  return {
    ...body,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    updatedBy: settings.updatedBy,
  };
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
    if (next.feeBps === before.feeBps && next.poolBps === before.poolBps) return before;
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

async function rejectRate(
  db: Database,
  actorEmail: string,
  action: string,
  err: unknown,
): Promise<never> {
  if (isAdminError(err)) {
    await insertAdminAudit(db, {
      actorEmail,
      action,
      target: "platform_settings",
      after: { reason: err.code },
      result: "refused",
    });
  }
  throw err;
}

export async function setPlatformFee(
  db: Database,
  actorEmail: string,
  input: { feeBps?: unknown; feePercent?: unknown },
): Promise<PlatformRates> {
  let feeBps: number;
  try {
    feeBps = resolveFeeBps(input);
  } catch (err) {
    return rejectRate(db, actorEmail, "set_fee_bps", err);
  }
  return writeRates(db, actorEmail, { feeBps }, "set_fee_bps");
}

export async function setPlatformPool(
  db: Database,
  actorEmail: string,
  input: { poolBps?: unknown; poolPercent?: unknown },
): Promise<PlatformRates> {
  let poolBps: number;
  try {
    poolBps = resolvePoolBps(input);
  } catch (err) {
    return rejectRate(db, actorEmail, "set_pool_bps", err);
  }
  return writeRates(db, actorEmail, { poolBps }, "set_pool_bps");
}

export async function setPlatformFeeBps(
  db: Database,
  actorEmail: string,
  feeBps: unknown,
): Promise<PlatformRates> {
  return setPlatformFee(db, actorEmail, { feeBps });
}

export async function setPlatformPoolBps(
  db: Database,
  actorEmail: string,
  poolBps: unknown,
): Promise<PlatformRates> {
  return setPlatformPool(db, actorEmail, { poolBps });
}
