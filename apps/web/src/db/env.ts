import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
];

for (const path of candidates) {
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

/**
 * Load DATABASE_URL. Never log the value (it may contain a password).
 * Staging: Secret Manager key `DATABASE_URL` (Ops sets the version OOB).
 */
export function loadDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env for local Postgres, or export the Secret Manager key DATABASE_URL (Ops provides the value out-of-band).",
    );
  }
  return url;
}
