"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import { createApiKey, listApiKeys, revokeApiKey, type PublicApiKey } from "@/api/access/handlers";
import { runtimeAccessDeps } from "@/api/access/http";
import { spendCeilings, apiKeyEnvFor } from "@/api/access/policy";
import { PublicApiError } from "@/api/public/errors";
import { getRuntimeDb } from "@/db/runtime";
import { findGithubLinkByUserId } from "@/github/persist";

export type ApiKeyActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  token?: string;
  prefix?: string;
  keyId?: string;
};

function fail(err: unknown): ApiKeyActionState {
  if (err instanceof PublicApiError) {
    return { ok: false, error: err.code, message: err.message };
  }
  return {
    ok: false,
    error: "unknown",
    message: err instanceof Error ? err.message : "Something went wrong.",
  };
}

export async function createApiKeyAction(formData: FormData): Promise<ApiKeyActionState> {
  const user = await getCurrentPublicUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  const scopes = [
    formData.get("scopeRead") ? "read" : null,
    formData.get("scopeWrite") ? "write" : null,
    formData.get("scopeMoney") ? "money" : null,
  ].filter((scope): scope is "read" | "write" | "money" => scope !== null);
  try {
    const created = await createApiKey(
      {
        userId: user.id,
        name: String(formData.get("name") ?? ""),
        scopes,
        perTxCapUsdc: String(formData.get("perTxCapUsdc") ?? ""),
        dailyCapUsdc: String(formData.get("dailyCapUsdc") ?? ""),
      },
      runtimeAccessDeps(),
    );
    return {
      ok: true,
      token: created.token,
      prefix: created.key.prefix,
      keyId: created.key.id,
      message: "Copy this key now. It is shown once.",
    };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const user = await getCurrentPublicUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  const keyId = String(formData.get("keyId") ?? "");
  try {
    await revokeApiKey(user.id, keyId, runtimeAccessDeps());
    revalidatePath("/settings");
  } catch (err) {
    const message = err instanceof PublicApiError ? err.message : "Could not revoke that key.";
    redirect(`/settings?notice=${encodeURIComponent(message)}`);
  }
}

export async function loadSettingsApiKeys(
  userId: string,
  walletAddress: string | null,
): Promise<{
  keys: PublicApiKey[];
  ceilings: { perTxUsdc: string; dailyUsdc: string };
  keyEnv: "test" | "live";
  moneyEligible: boolean;
}> {
  const deps = runtimeAccessDeps();
  const [keys, link] = await Promise.all([
    listApiKeys(userId, deps),
    findGithubLinkByUserId(userId, getRuntimeDb()),
  ]);
  return {
    keys,
    ceilings: spendCeilings(),
    keyEnv: apiKeyEnvFor(),
    moneyEligible: Boolean(walletAddress?.trim()) && Boolean(link),
  };
}
