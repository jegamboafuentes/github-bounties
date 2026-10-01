"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminConsoleOrigin } from "@/admin/hosts";
import { performAuthAction, type AuthActionCookie } from "@/auth";
import { missingLoginEnv } from "@/auth/env";
import { requestHostHeader } from "@/auth/host-origin";
import { safeRelativeCallbackUrl } from "@/auth/provider-signin-get";

async function finishAuthAction(actionPath: "signin/google" | "signout", callbackUrl: string) {
  const incoming = new Headers(await headers());
  const result = await performAuthAction(actionPath, callbackUrl, incoming);
  const jar = await cookies();
  for (const cookie of result.cookies) {
    jar.set(cookie.name, cookie.value, hostOnlyCookie(cookie));
  }
  redirect(result.redirect);
}

function hostOnlyCookie(cookie: AuthActionCookie) {
  const sameSite = cookie.options.sameSite;
  return {
    httpOnly: cookie.options.httpOnly === true,
    secure: cookie.options.secure === true,
    path: typeof cookie.options.path === "string" ? cookie.options.path : "/",
    sameSite: (sameSite === "lax" || sameSite === "strict" || sameSite === "none" ? sameSite : "lax") as
      | "lax"
      | "strict"
      | "none",
    ...(typeof cookie.options.maxAge === "number" ? { maxAge: cookie.options.maxAge } : {}),
    ...(cookie.options.expires instanceof Date ? { expires: cookie.options.expires } : {}),
  };
}

export async function signInWithGoogle(callbackUrl = "/settings") {
  const missing = missingLoginEnv();
  if (missing.length > 0) {
    throw new Error(`Google Sign-In blocked. Missing env: ${missing.join(", ")}`);
  }
  const host = requestHostHeader(await headers());
  const adminOrigin = adminConsoleOrigin(host);
  const fallback = adminOrigin ? "/admin" : "/settings";
  const safe = safeRelativeCallbackUrl(callbackUrl, process.env, adminOrigin ? [adminOrigin] : []) ?? fallback;
  await finishAuthAction("signin/google", safe);
}

export async function signOutToHome() {
  await finishAuthAction("signout", "/");
}
