import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isAdminConsoleHost } from "@/admin/hosts";
import { configuredPublicOrigin, mappedHostHeader } from "@/lib/site-env";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headerStore = await headers();
  const host = mappedHostHeader(headerStore);
  if (isAdminConsoleHost(host)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const origin = configuredPublicOrigin();
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  };
}
