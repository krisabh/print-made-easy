export const SITE = {
  name: "PrintYantra",
  parentCompany: "Clauras",
  /** Registered enterprise / operator (exact legal style name). */
  legalName: "Ramyad Enterprises - Abhiram",
  udyamRegistrationNumber: "UDYAM-BR-26-0156791",
  gstin: "10BJXPA3480P1ZU",
  tagline:
    "Print-shop management software for local shops — QR print requests, Windows Agent, and organized jobs.",
  /** Compact public hierarchy for footers and UI. */
  productLine: "A Clauras product",
  poweredByLine: "Powered by Ramyad Enterprises - Abhiram",
  /** Single-line identity for compact surfaces (e.g. dashboard). */
  identityCompact:
    "A Clauras product • Powered by Ramyad Enterprises - Abhiram",
  /** Preferred relationship sentence for about/legal/contact. */
  relationship:
    "PrintYantra is a Clauras product, powered by Ramyad Enterprises - Abhiram.",
  title: "PrintYantra | Print Shop Management Software",
  description:
    "PrintYantra is a Clauras product, powered by Ramyad Enterprises - Abhiram — print-shop management software for shopkeepers. Subscribe for ₹199/month after a 7-day free trial. Customers scan the shop QR code to submit documents for printing — they do not pay PrintYantra. Uploaded documents are deleted automatically after 1 hour.",
  url: "https://printyantra.com",
  email: "support@printyantra.com",
  emailHref: "mailto:support@printyantra.com",
  phone: "8618089513",
  phoneHref: "tel:8618089513",
  whatsappDisplay: "8618089513",
  /** International WhatsApp number without + (India +91, no leading 0). */
  whatsappE164: "918618089513",
  whatsappPrefillMessage:
    "Hello PrintYantra Support, I need help with my print shop account.",
  whatsappLabel: "Chat with PrintYantra Support on WhatsApp",
} as const;

/** Official WhatsApp click-to-chat URL with safe prefilled message (no secrets). */
export function getWhatsAppSupportHref(message?: string) {
  const text = message ?? SITE.whatsappPrefillMessage;
  return `https://wa.me/${SITE.whatsappE164}?text=${encodeURIComponent(text)}`;
}

/** Convenience alias for templates that need a static href. */
export const WHATSAPP_SUPPORT_HREF = getWhatsAppSupportHref();

/** Desktop primary nav — keeps the header uncluttered. */
export const MARKETING_PRIMARY_NAV = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products & Services" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
] as const;

/** Desktop secondary items (More menu). */
export const MARKETING_SECONDARY_NAV = [
  { href: "/about", label: "About" },
  { href: "/support", label: "Support" },
  { href: "/contact", label: "Contact Us" },
] as const;

/** Full public nav for mobile drawer. */
export const MARKETING_NAV = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products & Services" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/support", label: "Support" },
  { href: "/contact", label: "Contact Us" },
] as const;

/** Public footer product/company links (marketing layout). */
export const FOOTER_PRODUCT_LINKS = [
  { href: "/products", label: "Products & Services" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
] as const;

export const FOOTER_COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/support", label: "Support" },
  { href: "/contact", label: "Contact Us" },
] as const;

export const FOOTER_LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refunds", label: "Refund & Cancellation Policy" },
] as const;

/** Compact product/support links for authenticated dashboard footer. */
export const DASHBOARD_FOOTER_PRIMARY_LINKS = [
  { href: "/products", label: "Products & Services" },
  { href: "/pricing", label: "Pricing" },
  { href: "/support", label: "Support" },
  { href: "/contact", label: "Contact Us" },
] as const;

export const DASHBOARD_FOOTER_LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refunds", label: "Refund & Cancellation Policy" },
] as const;
