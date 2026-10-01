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
