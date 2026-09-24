import { clientIpFromRequest } from "./client-ip";
import { PUBLIC_API_CORS_HEADERS } from "./cors";
import { PublicApiError, apiErrorResponse, errorResponseFor } from "./errors";
import { publicRateLimiter, rateLimitHeaders } from "./rate-limit";

function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Per-IP limit for public reads. `cors` adds the `/api/v1` GET headers.
 * The count is in-memory on this instance only.
 */
export async function handlePublicRead(
  request: Request,
  run: () => Promise<Response>,
  options?: { cors?: boolean },
): Promise<Response> {
  const decision = publicRateLimiter.check(clientIpFromRequest(request));
  const headers = rateLimitHeaders(decision);
  if (options?.cors) {
    Object.assign(headers, PUBLIC_API_CORS_HEADERS);
  }
  if (!decision.allowed) {
    return withHeaders(
      apiErrorResponse(
        "rate_limited",
        "Too many requests from this IP. The limit is about 60 per minute on each Cloud Run instance.",
        { limitPerMinute: decision.limit, scope: "per_instance" },
        { "Retry-After": String(decision.retryAfterSeconds) },
      ),
      { ...headers, "Retry-After": String(decision.retryAfterSeconds) },
    );
  }
  try {
    return withHeaders(await run(), headers);
  } catch (err) {
    if (err instanceof PublicApiError) {
      return withHeaders(errorResponseFor(err), headers);
    }
    console.error(
      JSON.stringify({
        event: "public_api_internal",
        message: err instanceof Error ? err.message : "unknown",
      }),
    );
    return withHeaders(apiErrorResponse("internal", "Internal error.", null), headers);
  }
}
