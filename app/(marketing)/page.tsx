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
