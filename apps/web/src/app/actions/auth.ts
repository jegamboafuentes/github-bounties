"use server";

import { signIn, signOut } from "@/auth";
import { missingLoginEnv } from "@/auth/env";

export async function signInWithGoogle(callbackUrl = "/settings") {
  const missing = missingLoginEnv();
  if (missing.length > 0) {
    throw new Error(`Google Sign-In blocked. Missing env: ${missing.join(", ")}`);
  }
  await signIn("google", { redirectTo: callbackUrl || "/settings" });
}

export async function signOutToHome() {
  await signOut({ redirectTo: "/" });
}
