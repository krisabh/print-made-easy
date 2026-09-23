import { FaqSection } from "@/components/marketing/faq-section";
import {
  PrivacyWorkflowSection,
  ProductWorkflowSection,
} from "@/components/marketing/product-workflow";
import {
  AgentOverviewSection,
  FeaturesSection,
  FinalCtaSection,
  HeroSection,
  PricingSection,
  ProblemSection,
} from "@/components/marketing/sections";
import { getCurrentPremiumPriceInr, getCurrentTrialOffer } from "@/lib/admin-settings";
import type { Metadata } from "next";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Home",
  description: SITE.description,
  alternates: {
    canonical: "/",
  },
};

export default async function HomePage() {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  const offer = {
    premiumPriceInr,
    trialEnabled: trial.enabled,
    trialDays: trial.days,
  };

  return (
    <>
      <HeroSection {...offer} />
      <ProblemSection />
      <ProductWorkflowSection />
      <PrivacyWorkflowSection />
      <FeaturesSection compact />
      <AgentOverviewSection />
      <PricingSection {...offer} />
      <FaqSection {...offer} />
      <FinalCtaSection trialEnabled={trial.enabled} />
    </>
  );
}
