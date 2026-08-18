"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Printer,
  QrCode,
  Settings,
  IndianRupee,
  X,
} from "lucide-react";

import { logoutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/dashboard/agent-status-badge";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/jobs", label: "Jobs", icon: ListOrdered },
  { href: "/dashboard/qr", label: "QR Code", icon: QrCode },
  { href: "/dashboard/pricing", label: "Pricing", icon: IndianRupee },
  { href: "/dashboard/printers", label: "Printers", icon: Printer },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

type DashboardShellProps = {
  shopName: string;
  shopCode: string;
  children: React.ReactNode;
};

export function DashboardShell({
  shopName,
  shopCode,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  const nav = (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
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
  );

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <div className="mb-8">
            <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
              PrintMadeEasy
            </p>
            <p className="mt-1 text-sm text-slate-500">Shopkeeper Dashboard</p>
          </div>
          {nav}
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-72 bg-white p-5 shadow-xl">
              <div className="mb-6 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Menu</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                >
                  <X className="size-4" />
                </Button>
              </div>
              {nav}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setOpen(true)}
                  aria-label="Open menu"
                >
                  <Menu className="size-4" />
                </Button>
                <div>
                  <p className="text-xs font-medium tracking-wide text-blue-600 uppercase">
                    PrintMadeEasy
                  </p>
                  <h1 className="text-lg font-semibold text-slate-900">
                    {shopName}
                  </h1>
                  <p className="text-sm text-slate-500">Shop Code: {shopCode}</p>
                </div>
              </div>
              <AgentStatusBadge />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
