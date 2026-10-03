import { githubProvider } from "./github";
import { huggingfaceProvider } from "./huggingface";
import { ProviderNotSupportedError, type RepoProvider } from "./types";

/** GitHub is live. Hugging Face reads discussions; merge and claim still throw `provider_not_supported`. */
export function getProvider(provider: string): RepoProvider {
  if (provider === "github") return githubProvider;
  if (provider === "huggingface") return huggingfaceProvider;
  throw new ProviderNotSupportedError(provider);
}
