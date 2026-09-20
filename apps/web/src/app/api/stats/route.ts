import { getRuntimeDb } from "@/db/runtime";
import { getPlatformStats } from "@/stats";

export const dynamic = "force-dynamic";

/** Public aggregates. No session. Fast SQL over existing tables. */
export async function GET() {
  const stats = await getPlatformStats(getRuntimeDb());
  return Response.json(stats, { headers: { "cache-control": "no-store" } });
}
