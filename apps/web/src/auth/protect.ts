import { redirect } from "next/navigation";
import { getOptionalSession } from "./index";
import { type PublicUser, toPublicUser } from "./public-user";
import { findUserById } from "./users";

export async function getCurrentPublicUser(): Promise<PublicUser | null> {
  const session = await getOptionalSession();
  const id = session?.user?.id;
  if (!id) return null;
  try {
    const row = await findUserById(id);
    return row ? toPublicUser(row) : null;
  } catch {
    return null;
  }
}

export async function requirePageUser(callbackUrl = "/settings"): Promise<PublicUser> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return user;
}
