import type { Database } from "../db/client";
import { deleteHfLinkByUserId } from "./persist";

export const DISCONNECT_HF_NOTICE = "Hugging Face account unlinked. Product login stays Google.";

export type UnlinkHfResult = {
  deleted: boolean;
  hfUsername: string | null;
};

/** Clears `hf_links` for the signed-in user. Does not sign out of Google. */
export async function unlinkHuggingFaceForUser(userId: string, db: Database): Promise<UnlinkHfResult> {
  if (!userId) {
    throw new Error("userId is required to unlink Hugging Face.");
  }
  const row = await deleteHfLinkByUserId(userId, db);
  return {
    deleted: Boolean(row),
    hfUsername: row?.hfUsername ?? null,
  };
}
