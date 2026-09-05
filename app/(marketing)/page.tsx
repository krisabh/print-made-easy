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
import type { Metadata } from "next";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Home",
  description: SITE.description,
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ProblemSection />
      <ProductWorkflowSection />
      <PrivacyWorkflowSection />
      <FeaturesSection compact />
      <AgentOverviewSection />
      <PricingSection />
      <FaqSection />
      <FinalCtaSection />
    </>
  );
}
