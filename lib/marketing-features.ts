/**
 * Shared PrintYantra marketing feature copy.
 * Used by homepage, /features, /products — keep titles and bodies in sync.
 */
export const MARKETING_CORE_FEATURES = [
  {
    id: "scan-qr-upload",
    title: "Scan QR & Upload",
    body: "Scan the shop QR code and upload your document directly from your phone.",
  },
  {
    id: "preview-adjust",
    title: "Preview & Adjust",
    body: "Preview your document and make print adjustments before submitting.",
  },
  {
    id: "brightness-scale",
    title: "Brightness & Scale",
    body: "Adjust brightness and scale for clearer, better-sized prints — especially useful for images and ID cards.",
  },
  {
    id: "auto-print",
    title: "Auto Print",
    body: "Submit the job and let the connected printer handle the printing automatically.",
  },
  {
    id: "privacy-auto-delete",
    title: "Privacy — Auto Delete & Temporary Storage",
    body: "Customer documents are stored temporarily for printing and automatically deleted after the configured storage period.",
  },
  {
    id: "simple-print-management",
    title: "Simple Print Management",
    body: "Keep print jobs simple and organized from the shop dashboard.",
  },
] as const;

export type MarketingCoreFeature = (typeof MARKETING_CORE_FEATURES)[number];
