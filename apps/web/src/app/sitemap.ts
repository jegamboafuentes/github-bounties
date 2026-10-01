import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isNull } from "drizzle-orm";
import { isAdminConsoleHost } from "@/admin/hosts";
import { getRuntimeDb } from "@/db/runtime";
import { bounties } from "@/db/schema";
import { configuredPublicOrigin, mappedHostHeader } from "@/lib/site-env";

/** Public bounty URLs. Soft-deleted rows are omitted. Admin hosts publish nothing. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headerStore = await headers();
  const host = mappedHostHeader(headerStore);
  if (isAdminConsoleHost(host)) return [];
  const origin = configuredPublicOrigin() ?? "http://localhost:3000";
  try {
    const rows = await getRuntimeDb()
      .select({ id: bounties.id, updatedAt: bounties.updatedAt })
      .from(bounties)
      .where(isNull(bounties.deletedAt))
      .limit(5000);
    return [
      { url: origin, changeFrequency: "daily", priority: 1 },
      ...rows.map((row) => ({
        url: `${origin}/bounties/${row.id}`,
        lastModified: row.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return [{ url: origin }];
  }
}
