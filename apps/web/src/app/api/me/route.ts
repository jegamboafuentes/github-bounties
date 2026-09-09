import { getCurrentPublicUser } from "@/auth/protect";
import { jsonMe } from "@/auth/public-user";

export const dynamic = "force-dynamic";

/** Protected. Returns the persisted User for the session (google_sub). */
export async function GET() {
  const user = await getCurrentPublicUser();
  return jsonMe(user);
}
