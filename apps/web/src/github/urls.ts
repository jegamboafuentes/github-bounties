import { readGitHubAppOAuth, readGitHubAppSlug } from "../webhooks/env";

export function publicAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (env.PUBLIC_BASE_URL || env.AUTH_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "http://localhost:3000";
}

export function githubAppInstallUrl(state: string, env: NodeJS.ProcessEnv = process.env): string {
  const slug = readGitHubAppSlug(env);
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function githubAppOAuthUrl(args: {
  state: string;
  redirectUri: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const { clientId } = readGitHubAppOAuth(args.env ?? process.env);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  return url.toString();
}

export function githubCallbackUrl(origin = publicAppOrigin()): string {
  return `${origin.replace(/\/$/, "")}/github/callback`;
}
