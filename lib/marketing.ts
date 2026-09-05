export const SITE = {
  name: "PrintMadeEasy",
  tagline:
    "Print-shop management software for local shops — QR print requests, Windows Agent, and organized jobs.",
  title: "PrintMadeEasy | Print Shop Management Software",
  description:
    "PrintMadeEasy is software for print-shop owners. Shopkeepers subscribe for ₹199/month after a 7-day free trial. Customers scan the shop QR code to submit documents for printing — they do not pay PrintMadeEasy. Uploaded documents are deleted automatically after 1 hour.",
  url: "https://clauras.com",
  email: "abhiram12sep@gmail.com",
  emailHref: "mailto:abhiram12sep@gmail.com",
  whatsappDisplay: "+91 8618089513",
  whatsappHref: "https://wa.me/918618089513",
  whatsappLabel: "Chat with us on WhatsApp",
} as const;

/** Desktop primary nav — keeps the header uncluttered. */
export const MARKETING_PRIMARY_NAV = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
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
