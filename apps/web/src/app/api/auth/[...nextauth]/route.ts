import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { providerSignInGetResponse } from "@/auth/provider-signin-get";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const early = providerSignInGetResponse(new URL(request.url));
  if (early) return early;
  return handlers.GET(request);
}

export const POST = handlers.POST;
