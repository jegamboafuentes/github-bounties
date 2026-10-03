export function ProviderBadge({ provider }: { provider: string }) {
  if (provider !== "huggingface") return null;
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      Hugging Face
    </span>
  );
}
