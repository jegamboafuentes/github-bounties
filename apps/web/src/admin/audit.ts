import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { adminAuditLog } from "../db/schema";

export type AdminAuditInput = {
  actorEmail: string;
  action: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
  network?: string | null;
  txHash?: string | null;
  result: string;
  now?: Date;
};

function auditReason(input: AdminAuditInput): string | null {
  if (!input.after || typeof input.after !== "object") return null;
  const after = input.after as { reason?: unknown; code?: unknown };
  if (typeof after.reason === "string" && after.reason.trim()) return after.reason;
  if (typeof after.code === "string" && after.code.trim()) return after.code;
  return null;
}

/** One Cloud Logging line per audit row. Actor, action, target, and result only. */
export function logAdminAction(input: AdminAuditInput): void {
  const failed = input.result !== "ok" && input.result !== "preview";
  console.log(
    JSON.stringify({
      severity: failed ? "WARNING" : "INFO",
      event: "admin_action",
      actorEmail: input.actorEmail.trim().toLowerCase(),
      action: input.action,
      target: input.target ?? null,
      result: input.result,
      reason: auditReason(input),
    }),
  );
}

export async function insertAdminAudit(db: Database, input: AdminAuditInput): Promise<string> {
  const [row] = await db
    .insert(adminAuditLog)
    .values({
      actorEmail: input.actorEmail.trim().toLowerCase(),
      action: input.action,
      target: input.target ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      network: input.network ?? null,
      txHash: input.txHash ?? null,
      result: input.result,
      createdAt: input.now ?? new Date(),
    })
    .returning({ id: adminAuditLog.id });
  if (!row) throw new Error("admin audit insert returned no row");
  logAdminAction(input);
  return row.id;
}

export async function finishAdminAudit(
  db: Database,
  id: string,
  patch: { result: string; txHash?: string | null; after?: unknown },
): Promise<void> {
  await db
    .update(adminAuditLog)
    .set({
      result: patch.result,
      txHash: patch.txHash ?? null,
      after: patch.after ?? null,
    })
    .where(eq(adminAuditLog.id, id));
}
