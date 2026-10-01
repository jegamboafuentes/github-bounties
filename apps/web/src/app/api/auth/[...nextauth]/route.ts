import type { NextRequest } from "next/server";
import { handleAuthRequest } from "@/auth";
import { providerSignInGetResponse } from "@/auth/provider-signin-get";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const early = providerSignInGetResponse(new URL(request.url), {
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  });
  if (early) return early;
  return handleAuthRequest(request);
}

export function POST(request: NextRequest) {
  return handleAuthRequest(request);
}
