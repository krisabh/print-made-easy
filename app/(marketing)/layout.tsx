import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { WhatsAppFloatingButton } from "@/components/marketing/whatsapp-floating-button";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <MarketingHeader />
      <main className="pb-20 sm:pb-8">{children}</main>
      <MarketingFooter />
      <WhatsAppFloatingButton />
    </div>
  );
}
