"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, Menu, X } from "lucide-react";

import {
  MARKETING_NAV,
  MARKETING_PRIMARY_NAV,
  MARKETING_SECONDARY_NAV,
  SITE,
} from "@/lib/marketing";
import { cn } from "@/lib/utils";

type MarketingHeaderProps = {
  /** True when a shopkeeper session cookie is valid (server-detected). */
  authenticated?: boolean;
  shopName?: string | null;
};

export function MarketingHeader({
  authenticated = false,
  shopName = null,
}: MarketingHeaderProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const moreActive = MARKETING_SECONDARY_NAV.some((item) => isActive(item.href));

  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-md">
      <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0"
          onClick={() => setOpen(false)}
          aria-label={`${SITE.name} home`}
        >
          <span className="text-[13px] font-bold tracking-[0.12em] text-blue-700 uppercase">
            {SITE.name}
          </span>
        </Link>

        <nav
          className="ml-2 hidden flex-1 items-center justify-center gap-0.5 xl:flex"
          aria-label="Primary"
        >
          {MARKETING_PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-2 text-[13px] font-medium tracking-tight transition-colors",
                isActive(item.href)
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              {item.label}
            </Link>
          ))}

          <div className="relative" ref={moreRef}>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium tracking-tight transition-colors",
                moreActive || moreOpen
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((v) => !v)}
            >
              More
              <ChevronDown
                className={cn(
                  "size-3.5 text-slate-400 transition-transform",
                  moreOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="absolute top-full left-0 z-50 mt-1.5 min-w-[11rem] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-200/70"
              >
                {MARKETING_SECONDARY_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "block rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                      isActive(item.href)
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {authenticated ? (
            <>
              {shopName ? (
                <span className="hidden max-w-[10rem] truncate text-xs text-slate-500 lg:inline">
                  {shopName}
                </span>
              ) : null}
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
              >
                <LayoutDashboard className="size-4" aria-hidden="true" />
                Dashboard
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                Shopkeeper Login
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
              >
                Create Your Shop
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="ml-auto inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition-colors hover:bg-slate-50 xl:hidden sm:ml-0"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-slate-200 bg-white xl:hidden">
          <div className="mx-auto max-w-6xl space-y-1 px-4 py-3 sm:px-6">
            {MARKETING_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-xl px-3 py-3 text-sm font-medium",
                  isActive(item.href)
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-700 hover:bg-slate-50",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              {authenticated ? (
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white"
                >
                  <LayoutDashboard className="size-4" aria-hidden="true" />
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700"
                  >
                    Shopkeeper Login
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white"
                  >
                    Create Your Shop
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
