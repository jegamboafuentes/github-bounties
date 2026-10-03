import Link from "next/link";

export function ConnectHuggingFaceButton() {
  return (
    <Link
      href="/api/huggingface/connect"
      className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
    >
      Connect Hugging Face
    </Link>
  );
}
