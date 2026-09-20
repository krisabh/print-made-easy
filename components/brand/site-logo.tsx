import Link from "next/link";

import { SITE } from "@/lib/marketing";
import { cn } from "@/lib/utils";

export const SITE_NAVBAR_LOGO_SRC = "/brand/printyantra-navbar-logo.png";

/** Intrinsic size of cleaned navbar logo PNG (CSS uses height + width:auto). */
export const SITE_NAVBAR_LOGO_INTRINSIC = { width: 574, height: 335 } as const;

type SiteLogoProps = {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  as?: "link" | "img";
};

/**
 * Pixel heights applied via inline style (always paint correctly).
 * Standard Tailwind box classes are kept as a matching layout hint.
 * Fits inside h-14 / h-16 menu bars without overflowing the hero.
 */
const SIZE_PX = {
  sm: 40,
  md: 44,
  lg: 48,
} as const;

const SIZE_BOX = {
  sm: "h-10",
  md: "h-11",
  lg: "h-12",
} as const;

/**
 * Shared website navbar/menu logo.
 *
 * Uses a plain <img> (not next/image) so SSR and client hydration always emit
 * identical markup. Overflow box + explicit height prevent the 574×335
 * intrinsic attributes from painting at full size.
 */
export function SiteLogo({
  href = "/",
  className,
  size = "md",
  onClick,
  as = "link",
}: SiteLogoProps) {
  const heightPx = SIZE_PX[size];

  const image = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden",
        SIZE_BOX[size],
      )}
      style={{ height: heightPx }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- plain img for deterministic SSR/hydration */}
      <img
        src={SITE_NAVBAR_LOGO_SRC}
        alt={SITE.name}
        width={SITE_NAVBAR_LOGO_INTRINSIC.width}
        height={SITE_NAVBAR_LOGO_INTRINSIC.height}
        decoding="async"
        className={cn(
          "w-auto max-w-none object-contain object-left",
          className,
        )}
        style={{ width: "auto", height: heightPx }}
      />
    </span>
  );

  if (as === "img") {
    return image;
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className="inline-flex h-full shrink-0 items-center outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      aria-label={SITE.name}
    >
      {image}
    </Link>
  );
}
