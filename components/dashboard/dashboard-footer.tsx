import Link from "next/link";

import {
  DASHBOARD_FOOTER_LEGAL_LINKS,
  DASHBOARD_FOOTER_PRIMARY_LINKS,
  SITE,
} from "@/lib/marketing";

function LinkRow({
  links,
  ariaLabel,
}: {
  links: readonly { href: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {links.map((link, index) => (
        <span key={link.href} className="inline-flex items-center text-xs text-slate-500">
          {index > 0 ? (
            <span className="mx-1.5 text-slate-300" aria-hidden="true">
              ·
            </span>
          ) : null}
          <Link
            href={link.href}
            className="transition-colors hover:text-blue-700"
          >
            {link.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function DashboardFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50/80 px-4 py-3.5 sm:px-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
            {SITE.name}
          </p>
          <LinkRow
            links={DASHBOARD_FOOTER_PRIMARY_LINKS}
            ariaLabel="Product and support"
          />
        </div>
        <LinkRow
          links={DASHBOARD_FOOTER_LEGAL_LINKS}
          ariaLabel="Legal policies"
        />
      </div>
    </footer>
  );
}
