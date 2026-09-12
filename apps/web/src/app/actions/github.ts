"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import { DISCONNECT_GITHUB_NOTICE, unlinkGithubForUser } from "@/github/unlink";

/**
 * Settings → Disconnect. Session user only. Google login stays intact.
 */
export async function disconnectGitHubAction(): Promise<void> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }

  await unlinkGithubForUser(user.id, getRuntimeDb());
  revalidatePath("/settings");
  redirect(`/settings?notice=${encodeURIComponent(DISCONNECT_GITHUB_NOTICE)}`);
}
