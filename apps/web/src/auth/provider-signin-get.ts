/**
 * Auth.js treats `GET /api/auth/signin/<provider>` as unsupported. The provider
 * sign-in action is `POST` with a CSRF token; a GET throws `UnknownAction` and
 * `logger.error` records it. Bots hit that URL. This response never calls
 * Auth.js, so nothing is logged. Callbacks, sign-out, and the POST stay on
 * the Auth.js handlers.
 */
const PROVIDER_SIGNIN_GET = /^\/api\/auth\/signin\/[^/]+\/?$/;

export function isProviderSignInGet(pathname: string): boolean {
  return PROVIDER_SIGNIN_GET.test(pathname);
}

/** 303 to the site sign-in page. Null means the Auth.js GET handler should run. */
export function providerSignInGetResponse(url: URL): Response | null {
  if (!isProviderSignInGet(url.pathname)) return null;
  return Response.redirect(new URL("/signin", url.origin), 303);
}
