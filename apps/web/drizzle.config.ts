import { defineConfig } from "drizzle-kit";

/**
 * Generate / introspect only. Runtime migrate reads DATABASE_URL from the
 * environment (local .env or Secret Manager key DATABASE_URL).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/github_bounties",
  },
});
