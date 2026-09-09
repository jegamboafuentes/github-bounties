/**
 * Load DATABASE_URL. Never log the value (it may contain a password).
 * Staging: Secret Manager key `DATABASE_URL` (Ops sets the version OOB).
 *
 * Next.js loads `apps/web/.env` itself. Do not scan the filesystem here —
 * that traces the whole project into the Cloud Run standalone bundle.
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
