import { getRuntimeDb } from "@/db/runtime";
import {
  assemblePlatformStats,
  emptyPlatformStatsAggregates,
  getPlatformStats,
  type PlatformStats,
} from "@/stats";

export type HomepageStatsSource = {
  stats: PlatformStats;
  live: boolean;
};

export function emptyHomepageStats(): HomepageStatsSource {
  return {
    stats: assemblePlatformStats(emptyPlatformStatsAggregates()),
    live: false,
  };
}

/** Server-side FE-0 helper. Falls back to zeros if DATABASE_URL / Postgres is missing. */
export async function loadHomepageStats(): Promise<HomepageStatsSource> {
  try {
    return { stats: await getPlatformStats(getRuntimeDb()), live: true };
  } catch {
    return emptyHomepageStats();
  }
}
