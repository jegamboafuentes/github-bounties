import { getCurrentPublicUser } from "@/auth/protect";
import { unauthorizedJson } from "@/auth/public-user";
import { signGitHubConnectState } from "@/github/state";
import { githubAppInstallUrl } from "@/github/urls";
import {
  githubAppMissingEnvResponse,
  missingGitHubAppInstallEnv,
} from "@/webhooks/env";

export const dynamic = "force-dynamic";

/** Start GitHub App install. Requires a Google session. */
export async function GET() {
  return startConnect();
}

export async function POST() {
  return startConnect();
}

async function startConnect() {
  const user = await getCurrentPublicUser();
  if (!user) return unauthorizedJson();

  const missing = missingGitHubAppInstallEnv();
  if (missing.length > 0) {
    return githubAppMissingEnvResponse(missing);
  }

  const state = signGitHubConnectState({ userId: user.id });
  return Response.redirect(githubAppInstallUrl(state), 302);
}
