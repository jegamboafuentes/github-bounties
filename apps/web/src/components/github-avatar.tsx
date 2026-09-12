import { githubAvatarUrl, githubProfileUrl } from "@/github/avatar";

export function GitHubAvatar({
  login,
  size = 24,
  className,
}: {
  login?: string | null;
  size?: number;
  className?: string;
}) {
  const src = githubAvatarUrl(login, size * 2);
  if (!src || !login) return null;
  const href = githubProfileUrl(login);
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- GitHub avatars are a public CDN; avoid next/image remote config.
    <img
      src={src}
      alt={`${login} GitHub avatar`}
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-zinc-200 object-cover dark:bg-zinc-800"
    />
  );
  if (!href) return <span className={className}>{img}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={`@${login} on GitHub`}
    >
      {img}
    </a>
  );
}
