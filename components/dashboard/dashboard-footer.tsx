import Link from "next/link";

import { DASHBOARD_FOOTER_LINKS, SITE } from "@/lib/marketing";

export function DashboardFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white/80 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">
          {SITE.name}
        </p>
        <nav
          aria-label="Legal and support"
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"
        >
          {DASHBOARD_FOOTER_LINKS.map((link, index) => (
            <span key={link.href} className="inline-flex items-center gap-3">
              {index > 0 ? (
                <span className="text-slate-300" aria-hidden="true">
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
      </div>
    </footer>
  );
}
