"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
} from "lucide-react";

import { logoutAction } from "@/app/auth/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/shops", label: "Shops", icon: Building2 },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
] as const;

type AdminShellProps = {
  adminName: string;
  children: React.ReactNode;
};

export function AdminShell({ adminName, children }: AdminShellProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-slate-200 bg-white lg:w-64 lg:border-r lg:border-b-0">
          <div className="px-5 py-5">
            <p className="text-xs font-semibold tracking-[0.16em] text-blue-600 uppercase">
              PrintMadeEasy
            </p>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">
              Admin Console
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">{adminName}</p>
          </div>
          <nav className="space-y-1 px-3 pb-4">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
            <form action={logoutAction} className="pt-2">
              <button
                type="submit"
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <LogOut className="size-4 shrink-0" aria-hidden="true" />
                Logout
              </button>
            </form>
          </nav>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
