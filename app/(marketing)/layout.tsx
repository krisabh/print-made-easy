import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { WhatsAppFloatingButton } from "@/components/marketing/whatsapp-floating-button";
import { getCurrentUser } from "@/lib/auth";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read existing httpOnly session cookie — does not set/clear auth.
  // Anonymous visitors still get full public access.
  const session = await getCurrentUser();
  const authenticated = Boolean(session);

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <MarketingHeader
        authenticated={authenticated}
        shopName={session?.shop.shopName ?? null}
      />
      <main className="pb-20 sm:pb-8">{children}</main>
      <MarketingFooter authenticated={authenticated} />
      <WhatsAppFloatingButton />
    </div>
  );
}
