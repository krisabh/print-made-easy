/**
 * WhatsApp support for the Agent window.
 * Same phone as the PrintYantra website. Nothing is sent until the user clicks.
 */

/** India +91, no leading 0. Matches lib/marketing.ts SITE.whatsappE164. */
export const AGENT_WHATSAPP_E164 = "918618089513";

export const AGENT_WHATSAPP_MESSAGE =
  "Hello PrintYantra Support, I need help with my PrintYantra Agent.";

export const AGENT_WHATSAPP_SUPPORT_HREF = `https://wa.me/${AGENT_WHATSAPP_E164}?text=${encodeURIComponent(AGENT_WHATSAPP_MESSAGE)}`;
