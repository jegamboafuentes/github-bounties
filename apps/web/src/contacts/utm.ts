/**
 * First-party first-touch attribution. The `gb_utm` cookie is set by the
 * Next.js proxy when a request carries any utm_* param. Sign-up copies it
 * onto the user and the marketing contact. There is no third-party analytics.
 */

export const UTM_COOKIE_NAME = "gb_utm";
export const UTM_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const UTM_MAX_LENGTH = 100;

export type UtmTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  path: string | null;
  ts: string;
};

export type UtmCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export type PlannedUtmCookie = {
  name: typeof UTM_COOKIE_NAME;
  value: string;
  options: UtmCookieOptions;
};

/** Keep letters, digits, `_`, `.`, and `-`. Cap at 100 characters. */
export function sanitizeUtmValue(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, UTM_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Landing path uses the same cap and the utm charset plus `/`, so `/` and
 * `/board` stay readable. Query strings and other characters are dropped.
 */
export function sanitizeLandingPath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_./-]/g, "").slice(0, UTM_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

function hasAttribution(touch: Pick<UtmTouch, "source" | "medium" | "campaign" | "content" | "term">): boolean {
  return Boolean(touch.source || touch.medium || touch.campaign || touch.content || touch.term);
}

export function utmTouchFromSearch(params: URLSearchParams, pathname: string, now: Date): UtmTouch | null {
  const present = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].some((key) =>
    params.has(key),
  );
  if (!present) return null;
  const touch: UtmTouch = {
    source: sanitizeUtmValue(params.get("utm_source")),
    medium: sanitizeUtmValue(params.get("utm_medium")),
    campaign: sanitizeUtmValue(params.get("utm_campaign")),
    content: sanitizeUtmValue(params.get("utm_content")),
    term: sanitizeUtmValue(params.get("utm_term")),
    path: sanitizeLandingPath(pathname),
    ts: now.toISOString(),
  };
  return hasAttribution(touch) ? touch : null;
}

export function parseUtmCookie(raw: string | null | undefined): UtmTouch | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const text = (key: string): string | null => (typeof row[key] === "string" ? row[key] : null);
  const tsRaw = text("ts");
  const ts = tsRaw && !Number.isNaN(Date.parse(tsRaw)) ? new Date(tsRaw).toISOString() : new Date(0).toISOString();
  const touch: UtmTouch = {
    source: sanitizeUtmValue(text("source")),
    medium: sanitizeUtmValue(text("medium")),
    campaign: sanitizeUtmValue(text("campaign")),
    content: sanitizeUtmValue(text("content")),
    term: sanitizeUtmValue(text("term")),
    path: sanitizeLandingPath(text("path")),
    ts,
  };
  return hasAttribution(touch) ? touch : null;
}

export function utmCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): UtmCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: nodeEnv === "production",
    path: "/",
    maxAge: UTM_MAX_AGE_SECONDS,
  };
}

/**
 * First touch wins. An existing cookie is left alone. Params that sanitize
 * to nothing do not set a cookie, so a junk visit cannot block a later real one.
 */
export function planUtmCookie(input: {
  existing: string | undefined;
  searchParams: URLSearchParams;
  pathname: string;
  now?: Date;
  nodeEnv?: string;
}): PlannedUtmCookie | null {
  if (input.existing) return null;
  const touch = utmTouchFromSearch(input.searchParams, input.pathname, input.now ?? new Date());
  if (!touch) return null;
  return {
    name: UTM_COOKIE_NAME,
    value: JSON.stringify(touch),
    options: utmCookieOptions(input.nodeEnv),
  };
}
