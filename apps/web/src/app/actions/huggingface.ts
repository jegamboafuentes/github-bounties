"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import { hfOAuthConfigured } from "@/huggingface/env";
import { DISCONNECT_HF_NOTICE, unlinkHuggingFaceForUser } from "@/huggingface/unlink";

/**
 * Settings → Disconnect Hugging Face. Session user only. Google login stays intact.
 * Refuses without deleting when OAuth env is missing.
 */
export async function disconnectHuggingFaceAction(): Promise<void> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }
  if (!hfOAuthConfigured()) {
    redirect("/settings");
  }

  await unlinkHuggingFaceForUser(user.id, getRuntimeDb());
  revalidatePath("/settings");
  redirect(`/settings?notice=${encodeURIComponent(DISCONNECT_HF_NOTICE)}`);
}
