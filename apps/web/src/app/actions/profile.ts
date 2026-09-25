"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import { getRuntimeDb } from "@/db/runtime";
import {
  DisplayNameError,
  saveDisplayName,
  saveEmailNotificationPreferences,
  type EmailNotificationPrefs,
} from "@/profile/settings";

function settingsNotice(message: string): never {
  redirect(`/settings?notice=${encodeURIComponent(message)}`);
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function updateDisplayNameAction(formData: FormData): Promise<void> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }
  try {
    const saved = await saveDisplayName(getRuntimeDb(), user.id, String(formData.get("displayName") ?? ""));
    if (!saved) settingsNotice("User not found.");
    revalidatePath("/settings");
    settingsNotice("Display name saved.");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof DisplayNameError) settingsNotice(err.message);
    settingsNotice("Could not save the display name.");
  }
}

function formFlag(formData: FormData, name: string): boolean {
  return formData.get(name) === "true";
}

export async function updateNotificationPreferencesAction(formData: FormData): Promise<void> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }
  const patch: EmailNotificationPrefs = {
    bountyFunded: formFlag(formData, "bountyFunded"),
    prMerged: formFlag(formData, "prMerged"),
    bountySettled: formFlag(formData, "bountySettled"),
    poolClaimable: formFlag(formData, "poolClaimable"),
  };
  try {
    const saved = await saveEmailNotificationPreferences(getRuntimeDb(), user.id, patch);
    if (!saved) settingsNotice("User not found.");
    revalidatePath("/settings");
    settingsNotice("Email notification preferences saved.");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    settingsNotice("Could not save email notification preferences.");
  }
}
