import { and, eq, isNull } from "drizzle-orm";
import { getRuntimeDb } from "../db/runtime";
import { bounties } from "../db/schema";
import { isUuid } from "../ids";

/**
 * Whether `/bounties/{id}` will render. A missing or soft-deleted row is the
 * page's notFound() case. Lookup failures stay false so a 404 does not take
 * a first-touch cookie. Called from the Node proxy only when a cookie would
 * otherwise be set.
 */
export async function publicBountyExists(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  try {
    const rows = await getRuntimeDb()
      .select({ id: bounties.id })
      .from(bounties)
      .where(and(eq(bounties.id, id), isNull(bounties.deletedAt)))
      .limit(1);
    return Boolean(rows[0]);
  } catch {
    console.error(JSON.stringify({ severity: "ERROR", event: "utm_bounty_lookup_failed" }));
    return false;
  }
}
