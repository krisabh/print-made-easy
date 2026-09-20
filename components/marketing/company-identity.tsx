import Link from "next/link";

import { SiteLogo } from "@/components/brand/site-logo";
import { SITE } from "@/lib/marketing";
import { cn } from "@/lib/utils";

type BrandHierarchyProps = {
  className?: string;
  /** Show the PrintYantra product name above Clauras / operator lines. */
  showProductName?: boolean;
  compact?: boolean;
};

/**
 * Consistent public brand hierarchy:
 * PrintYantra → A Clauras product → Powered by Ramyad Enterprises - Abhiram
 */
export function BrandHierarchy({
  className,
  showProductName = true,
  compact = false,
}: BrandHierarchyProps) {
  if (compact) {
    return (
      <p className={cn("text-xs leading-relaxed text-slate-500", className)}>
        {showProductName ? (
          <>
            <span className="font-semibold text-slate-700">{SITE.name}</span>
            {" · "}
          </>
        ) : null}
        {SITE.identityCompact}
      </p>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {showProductName ? (
        <p className="text-sm font-bold tracking-[0.12em] text-blue-700 uppercase">
          {SITE.name}
        </p>
      ) : null}
      <p className="text-xs font-medium text-slate-600">{SITE.productLine}</p>
      <p className="text-xs leading-relaxed text-slate-500">
        {SITE.poweredByLine}
      </p>
    </div>
  );
}

type RegistrationDetailsProps = {
  className?: string;
  /** Slightly denser layout for pricing trust strip. */
  compact?: boolean;
};

/** Factual Udyam / GSTIN presentation — no endorsement claims. */
export function RegistrationDetails({
  className,
  compact = false,
}: RegistrationDetailsProps) {
  return (
    <dl
      className={cn(
        compact ? "space-y-2 text-sm" : "space-y-3 text-sm",
        className,
      )}
    >
      <div>
        <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Enterprise Name
        </dt>
        <dd className="mt-1 font-medium text-slate-900">{SITE.legalName}</dd>
      </div>
      <div>
        <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Udyam Registration Number
        </dt>
        <dd className="mt-1 font-medium tracking-wide text-slate-900">
          {SITE.udyamRegistrationNumber}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          GSTIN
        </dt>
        <dd className="mt-1 font-medium tracking-wide text-slate-900">
          {SITE.gstin}
        </dd>
      </div>
    </dl>
  );
}

/** Subtle dashboard trust line linking to About. */
export function DashboardBrandTrust({
  className,
  /** When false, omit the logo (right content header). Left sidebar keeps the logo. */
  showLogo = true,
}: {
  className?: string;
  showLogo?: boolean;
}) {
  return (
    <Link
      href="/about"
      className={cn(
        "group block max-w-xs rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        className,
      )}
      aria-label={`${SITE.name} — about`}
    >
      {showLogo ? <SiteLogo as="img" size="sm" className="mb-1" /> : null}
      <p
        className={cn(
          "text-[11px] leading-snug text-slate-500 transition-colors group-hover:text-slate-600",
          showLogo && "mt-0.5",
        )}
      >
        {SITE.identityCompact}
      </p>
    </Link>
  );
}
