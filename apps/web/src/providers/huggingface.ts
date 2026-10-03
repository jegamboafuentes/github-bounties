import { ProviderNotSupportedError, type RepoProvider } from "./types";

function unsupported(): never {
  throw new ProviderNotSupportedError("huggingface");
}

/** Placeholder until the Hugging Face adapter lands. Every method refuses. */
export const huggingfaceProvider: RepoProvider = {
  id: "huggingface",
  parseIssueUrl() {
    unsupported();
  },
  fetchIssue() {
    unsupported();
  },
  parsePrUrl() {
    unsupported();
  },
  verifyMerge() {
    unsupported();
  },
  repoMeta() {
    unsupported();
  },
  identitiesMatch() {
    unsupported();
  },
  findLinkedUser() {
    unsupported();
  },
  identityForUser() {
    unsupported();
  },
  listClosingPulls() {
    unsupported();
  },
  mergeDeliveryPayload() {
    unsupported();
  },
};
