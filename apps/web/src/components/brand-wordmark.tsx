import Image from "next/image";
import { PRODUCT_NAME } from "@/lib/constants";

/** Intrinsic size of public/logo-wordmark.png (logo-1 family). */
const WORDMARK = { width: 1228, height: 457 } as const;

const sizeClass = {
  nav: "h-8 w-auto",
  splash: "h-14 w-auto sm:h-16",
  hero: "h-16 w-auto sm:h-20",
} as const;

type BrandWordmarkSize = keyof typeof sizeClass;

/**
 * Enrique-locked scanline wordmark.
 * Light UI uses logo-1 (`/logo-wordmark.png`). Dark UI uses logo-6
 * (`/logo-wordmark-on-dark.png`) because logo-1 is dark-on-transparent
 * and fails contrast on zinc-950 headers.
 */
export function BrandWordmark({
  size = "nav",
  priority = false,
}: {
  size?: BrandWordmarkSize;
  priority?: boolean;
}) {
  const frame = sizeClass[size];
  return (
    <span className="inline-flex items-center">
      <Image
        src="/logo-wordmark.png"
        alt={PRODUCT_NAME}
        width={WORDMARK.width}
        height={WORDMARK.height}
        className={`${frame} dark:hidden`}
        priority={priority}
      />
      <Image
        src="/logo-wordmark-on-dark.png"
        alt=""
        width={WORDMARK.width}
        height={WORDMARK.height}
        className={`${frame} hidden dark:block`}
        priority={priority}
      />
    </span>
  );
}
