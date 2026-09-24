import type { CSSProperties } from "react";
import {
  BOARD_FUNDER_AVATAR_LIMIT,
  BOARD_FUNDER_AVATAR_SIZE,
  funderStackAriaLabel,
  type BoardFunder,
} from "@/bounties/funders";

const FACE =
  "relative inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-zinc-200 text-[10px] font-semibold leading-none text-zinc-700 ring-2 ring-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-900";

const AVATAR = `${FACE} w-6 overflow-hidden`;

const OVERFLOW = `${FACE} min-w-6 px-1`;

/**
 * One circular funder face. Picture when `avatarUrl` is set, otherwise initials.
 * Shared by the board stack and the bounty detail Funders rows.
 */
export function FunderFace({
  displayName,
  avatarUrl,
  className,
  style,
}: {
  displayName: string;
  avatarUrl: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      title={displayName}
      aria-hidden
      className={className ? `${AVATAR} ${className}` : AVATAR}
      style={style}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Same public CDN / Google picture as profile identity; avoid next/image remote config.
        <img
          src={avatarUrl}
          alt=""
          width={BOARD_FUNDER_AVATAR_SIZE}
          height={BOARD_FUNDER_AVATAR_SIZE}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{funderInitials(displayName)}</span>
      )}
    </span>
  );
}

/**
 * Overlapping funder faces for a bounty card.
 * Renders nothing when there are no funders.
 */
export function FunderAvatarStack({
  funders,
  funderCount,
}: {
  funders: readonly BoardFunder[];
  funderCount: number;
}) {
  const visible = funders.slice(0, BOARD_FUNDER_AVATAR_LIMIT);
  if (visible.length === 0 || funderCount <= 0) return null;
  const overflow = Math.max(0, funderCount - visible.length);
  const label = funderStackAriaLabel(visible, funderCount);

  return (
    <div className="flex items-center" role="img" aria-label={label}>
      {visible.map((funder, index) => (
        <FunderFace
          key={funder.userId}
          displayName={funder.displayName}
          avatarUrl={funder.avatarUrl}
          className={index > 0 ? "-ml-2" : undefined}
          style={{ zIndex: visible.length - index }}
        />
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden
          title={`${overflow} more ${overflow === 1 ? "funder" : "funders"}`}
          className={`${OVERFLOW} -ml-2`}
          style={{ zIndex: visible.length + 1 }}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function funderInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  if (parts.length === 1) return first.slice(0, 1).toUpperCase();
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}
