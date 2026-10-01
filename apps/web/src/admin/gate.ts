import { notFound } from "next/navigation";
import { getOptionalSession } from "../auth";
import type { EnvMap } from "../auth/env";
import { getCurrentPublicUser } from "../auth/protect";
import type { PublicUser } from "../auth/public-user";
import { authenticateBearer } from "../api/access/handlers";
import { runtimeAccessDeps } from "../api/access/http";
import { clientIpFromRequest } from "../api/public/client-ip";
import { isAdminIdentity } from "./identity";

export function adminNotFoundResponse(): Response {
  return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function requireAdminPageUser(): Promise<PublicUser> {
  const session = await getOptionalSession();
  const user = await getCurrentPublicUser();
  if (
    !user ||
    !isAdminIdentity(
      {
        email: user.email,
        googleSub: user.google_sub,
        sessionGoogleSub: session?.user?.googleSub,
      },
      process.env,
    )
  ) {
    notFound();
  }
  return user;
}

export async function requireAdminApiActor(
  request: Request,
  env: EnvMap = process.env,
): Promise<{ email: string } | Response> {
  const authorization = request.headers.get("authorization");
  if (authorization?.trim()) {
    const deps = runtimeAccessDeps();
    try {
      const principal = await authenticateBearer(authorization, clientIpFromRequest(request), deps);
      if (!principal || !principal.scopes.has("admin")) return adminNotFoundResponse();
      const actor = await deps.loadAdminActor?.(principal.userId);
      if (
        !actor ||
        !isAdminIdentity(
          { email: actor.email, googleSub: actor.googleSub, sessionGoogleSub: actor.googleSub },
          env,
        )
      ) {
        return adminNotFoundResponse();
      }
      return { email: actor.email.trim().toLowerCase() };
    } catch {
      return adminNotFoundResponse();
    }
  }

  const session = await getOptionalSession();
  const user = await getCurrentPublicUser();
  if (
    !user ||
    !isAdminIdentity(
      { email: user.email, googleSub: user.google_sub, sessionGoogleSub: session?.user?.googleSub },
      env,
    )
  ) {
    return adminNotFoundResponse();
  }
  return { email: user.email.trim().toLowerCase() };
}
