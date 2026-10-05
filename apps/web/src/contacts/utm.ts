/**
 * First-party first-touch attribution. The `gb_utm` cookie is set by the
 * Next.js proxy on a successful public HTML page navigation that carries any
 * utm_* param. API, static, robots, sitemap, and admin routes do not set it.
 * Sign-up copies it onto the user and the marketing contact. There is no
 * third-party analytics.
 */

import { isUuid } from "../ids";

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

const UTM_HTML_PATHS = new Set([
  "/",
  "/about",
  "/roadmap",
  "/board",
  "/signin",
  "/settings",
  "/bounties/new",
  "/github/setup",
  "/github/callback",
]);

function htmlPathname(pathname: string): string {
  if (pathname.length > 1) return pathname.replace(/\/+$/, "");
  return pathname;
}

/** `/bounties/{uuid}` when the id would reach the detail page. Non-uuids 404 in the proxy path check. */
export function bountyDetailId(pathname: string): string | null {
  const bounty = /^\/bounties\/([^/]+)$/.exec(htmlPathname(pathname));
  if (!bounty || !isUuid(bounty[1] ?? "")) return null;
  return bounty[1] ?? null;
}

/**
 * `NextResponse.next()` is status 200 before the bounty page calls notFound().
 * A missing bounty is a 404, so the cookie decision uses 404 and the HTTP
 * response stays the page's. Other paths keep the proxy status.
 */
export function utmProxyStatus(input: {
  pathname: string;
  proxyStatus: number;
  bountyExists: boolean | null;
}): number {
  if (input.bountyExists === false && bountyDetailId(input.pathname)) return 404;
  return input.proxyStatus;
}

/**
 * Public HTML pages only. API, static, robots, sitemap, MCP, webhooks, and
 * admin routes are not navigations that should take a first touch. An admin
 * host never qualifies, including its redirects and rewrites.
 */
export function isUtmHtmlNavigation(input: { method: string; pathname: string; adminHost: boolean }): boolean {
  if (input.adminHost) return false;
  if (input.method !== "GET" && input.method !== "HEAD") return false;
  const pathname = htmlPathname(input.pathname);
  if (UTM_HTML_PATHS.has(pathname)) return true;
  const bounty = /^\/bounties\/([^/]+)$/.exec(pathname);
  return Boolean(bounty && isUuid(bounty[1]));
}

/**
 * First touch wins when the stored cookie still parses. A missing cookie, or
 * one that fails to parse or validate, does not block a later real touch.
 * Params that sanitize to nothing do not set a cookie.
 */
export function planUtmCookie(input: {
  existing: string | undefined;
  searchParams: URLSearchParams;
  pathname: string;
  now?: Date;
  nodeEnv?: string;
}): PlannedUtmCookie | null {
  if (parseUtmCookie(input.existing)) return null;
  const touch = utmTouchFromSearch(input.searchParams, input.pathname, input.now ?? new Date());
  if (!touch) return null;
  return {
    name: UTM_COOKIE_NAME,
    value: JSON.stringify(touch),
    options: utmCookieOptions(input.nodeEnv),
  };
}

/** Gate the proxy stamp: successful public HTML only, then the first-touch rules. */
export function planUtmForNavigation(input: {
  method: string;
  pathname: string;
  adminHost: boolean;
  status: number;
  rewritten: boolean;
  existing: string | undefined;
  searchParams: URLSearchParams;
  now?: Date;
  nodeEnv?: string;
}): PlannedUtmCookie | null {
  if (input.rewritten) return null;
  if (input.status < 200 || input.status >= 300) return null;
  if (!isUtmHtmlNavigation({ method: input.method, pathname: input.pathname, adminHost: input.adminHost })) {
    return null;
  }
  return planUtmCookie({
    existing: input.existing,
    searchParams: input.searchParams,
    pathname: input.pathname,
    now: input.now,
    nodeEnv: input.nodeEnv,
  });
}
