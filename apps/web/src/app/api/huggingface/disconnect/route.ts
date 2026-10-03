import { getCurrentPublicUser } from "@/auth/protect";
import { disconnectHuggingFace } from "@/huggingface/http";

export const dynamic = "force-dynamic";

/** Unlink hf_links for the signed-in Google user. */
export async function POST() {
  const user = await getCurrentPublicUser();
  return disconnectHuggingFace({ userId: user?.id ?? null });
}
