import { getCurrentPublicUser } from "@/auth/protect";
import { startHuggingFaceConnect } from "@/huggingface/http";

export const dynamic = "force-dynamic";

/** Start Hugging Face connect for the signed-in Google user. Not product login. */
export async function GET() {
  const user = await getCurrentPublicUser();
  return startHuggingFaceConnect({ userId: user?.id ?? null });
}

export async function POST() {
  const user = await getCurrentPublicUser();
  return startHuggingFaceConnect({ userId: user?.id ?? null });
}
