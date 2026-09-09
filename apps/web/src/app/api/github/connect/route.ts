import { getCurrentPublicUser } from "@/auth/protect";
import { githubConnectStubResponse } from "@/auth/public-user";

export const dynamic = "force-dynamic";

/** Stub. Real GitHub App install is V1-3. Requires a Google session. */
export async function POST() {
  const user = await getCurrentPublicUser();
  return githubConnectStubResponse(user);
}

export async function GET() {
  const user = await getCurrentPublicUser();
  return githubConnectStubResponse(user);
}
