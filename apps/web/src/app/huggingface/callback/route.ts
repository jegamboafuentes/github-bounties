import { getCurrentPublicUser } from "@/auth/protect";
import { finishHuggingFaceConnect } from "@/huggingface/http";

export const dynamic = "force-dynamic";

/** Hugging Face redirects here. Links hf_links for the signed-in Google user. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getCurrentPublicUser();
  return finishHuggingFaceConnect({
    userId: user?.id ?? null,
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    oauthError: url.searchParams.get("error"),
    cookieHeader: request.headers.get("cookie"),
  });
}
