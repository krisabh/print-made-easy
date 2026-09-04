import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";

import { SITE } from "@/lib/marketing";

const PRODUCT_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "Windows Agent" },
] as const;

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/support", label: "Support" },
] as const;

const ACCOUNT_LINKS = [
  { href: "/login", label: "Shopkeeper Login" },
  { href: "/signup", label: "Create Your Shop" },
] as const;

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <p className="text-sm font-bold tracking-wide text-blue-700 uppercase">
            {SITE.name}
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
            {SITE.tagline}
          </p>
        </div>

        <FooterColumn title="Product" links={PRODUCT_LINKS} />
        <FooterColumn title="Company" links={COMPANY_LINKS} />
        <FooterColumn title="Account" links={ACCOUNT_LINKS} />

        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Contact
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <a
                href={SITE.emailHref}
                className="inline-flex items-center gap-2 text-slate-700 transition-colors hover:text-blue-700"
              >
                <Mail className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="break-all">{SITE.email}</span>
              </a>
            </li>
            <li>
              <a
                href={SITE.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-slate-700 transition-colors hover:text-blue-700"
              >
                <MessageCircle
                  className="size-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                WhatsApp
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 {SITE.name}. All rights reserved.</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="hover:text-blue-700">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-blue-700">
              Terms of Service
            </Link>
            <Link href="/refunds" className="hover:text-blue-700">
              Refunds &amp; Cancellations
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className="text-sm text-slate-700 transition-colors hover:text-blue-700"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
