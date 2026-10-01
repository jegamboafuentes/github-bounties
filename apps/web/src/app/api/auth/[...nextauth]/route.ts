import type { NextRequest } from "next/server";
import { handleAuthRequest } from "@/auth";
import { providerSignInGetResponse } from "@/auth/provider-signin-get";
import { mappedHostHeader } from "@/lib/site-env";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const early = providerSignInGetResponse(new URL(request.url), {
    host: mappedHostHeader(request.headers),
  });
  if (early) return early;
  return handleAuthRequest(request);
}

export function POST(request: NextRequest) {
  return handleAuthRequest(request);
}
