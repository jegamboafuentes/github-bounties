import type { Database } from "../db/client";
import { getRuntimeDb } from "../db/runtime";
import {
  confirmInstallation,
  exchangeOAuthCode,
  getAuthenticatedGitHubUser,
  listInstallationRepos,
  type GitHubHttp,
} from "./api";
import { backfillUnlinkedClaimsForHunter } from "../webhooks/claims";
import { upsertGithubLink, upsertInstallationRepos } from "./persist";
import { githubAppOAuthUrl, githubCallbackUrl, publicAppOrigin } from "./urls";
import { signGitHubConnectState, verifyGitHubConnectState } from "./state";

export type GitHubCompleteInput = {
  userId: string;
  state?: string | null;
  installationId?: string | null;
  setupAction?: string | null;
  code?: string | null;
  origin?: string;
};

export type GitHubCompleteResult =
  | {
      ok: true;
      linked: boolean;
      installationId?: string;
      repos: Array<{ fullName: string; githubRepoId: string }>;
      githubLogin?: string;
      next?: "oauth";
      oauthUrl?: string;
    }
  | { ok: false; error: string; message: string };

export async function completeGitHubAppReturn(
  input: GitHubCompleteInput,
  opts: { db?: Database; http?: GitHubHttp; jwt?: string } = {},
): Promise<GitHubCompleteResult> {
  const state = verifyGitHubConnectState(input.state);
  if (!state) {
    return {
      ok: false,
      error: "invalid_state",
      message:
        "Install state is missing or expired. Start again from Settings → Connect GitHub.",
    };
  }
  if (state.userId !== input.userId) {
    return {
      ok: false,
      error: "state_user_mismatch",
      message: "This GitHub install was started by a different signed-in user.",
    };
  }

  const db = opts.db ?? getRuntimeDb();
  const installationId = input.installationId || state.installationId;
  const origin = input.origin ?? publicAppOrigin();
  let githubLogin: string | undefined;
  let linked = false;

  if (input.code) {
    try {
      const token = await exchangeOAuthCode(input.code, githubCallbackUrl(origin), {
        http: opts.http,
      });
      const identity = await getAuthenticatedGitHubUser(token, { http: opts.http });
      const row = await upsertGithubLink(input.userId, identity, db);
      githubLogin = row.githubLogin;
      linked = true;
      try {
        await backfillUnlinkedClaimsForHunter(
          {
            userId: input.userId,
            githubLogin: row.githubLogin,
            githubId: row.githubId,
          },
          db,
        );
      } catch (err) {
        console.error(
          `[eligibility] github-link backfill failed user=${input.userId} login=${row.githubLogin}`,
          err,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub user OAuth failed";
      return { ok: false, error: "oauth_failed", message };
    }
  }

  if (!installationId) {
    if (linked) {
      return { ok: true, linked, repos: [], githubLogin };
    }
    return {
      ok: false,
      error: "missing_installation",
      message: "GitHub did not return an installation_id. Re-run Connect GitHub.",
    };
  }

  try {
    const installation = await confirmInstallation(installationId, {
      http: opts.http,
      jwt: opts.jwt,
    });
    if (installation.suspended) {
      return {
        ok: false,
        error: "installation_suspended",
        message: "That GitHub App installation is suspended.",
      };
    }
    const repositories = await listInstallationRepos(installation.id, {
      http: opts.http,
      jwt: opts.jwt,
    });
    const rows = await upsertInstallationRepos({
      userId: input.userId,
      installationId: BigInt(installation.id),
      repositories,
      db,
    });

    if (!linked) {
      const oauthState = signGitHubConnectState({
        userId: input.userId,
        installationId: String(installation.id),
      });
      return {
        ok: true,
        linked: false,
        installationId: String(installation.id),
        repos: rows.map((r) => ({
          fullName: r.fullName,
          githubRepoId: r.githubRepoId.toString(),
        })),
        next: "oauth",
        oauthUrl: githubAppOAuthUrl({
          state: oauthState,
          redirectUri: githubCallbackUrl(origin),
        }),
      };
    }

    return {
      ok: true,
      linked: true,
      installationId: String(installation.id),
      repos: rows.map((r) => ({
        fullName: r.fullName,
        githubRepoId: r.githubRepoId.toString(),
      })),
      githubLogin,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not confirm the GitHub App installation";
    return { ok: false, error: "install_unconfirmed", message };
  }
}
