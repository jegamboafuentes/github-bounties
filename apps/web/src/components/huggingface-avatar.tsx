export function HuggingFaceAvatar({
  username,
  avatarUrl,
  size = 24,
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const href = `https://huggingface.co/${encodeURIComponent(username)}`;
  const img = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- HF picture is an https URL from userinfo; avoid next/image remote config.
    <img
      src={avatarUrl}
      alt={`${username} Hugging Face avatar`}
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-zinc-200 object-cover dark:bg-zinc-800"
    />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      style={{ width: size, height: size }}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
  return (
    <a href={href} target="_blank" rel="noreferrer" title={`@${username} on Hugging Face`}>
      {img}
    </a>
  );
}
