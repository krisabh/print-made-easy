/**
 * Public support actions for the Agent window.
 * Same address and phone as the PrintYantra website. The WhatsApp
 * message is specific to the Agent. Nothing is sent until the user clicks.
 */
export const AGENT_SUPPORT_EMAIL = "support@printyantra.com";
export const AGENT_SUPPORT_EMAIL_HREF = `mailto:${AGENT_SUPPORT_EMAIL}`;

/** India +91, no leading 0. Matches lib/marketing.ts SITE.whatsappE164. */
export const AGENT_WHATSAPP_E164 = "918618089513";

export const AGENT_WHATSAPP_MESSAGE =
  "Hello PrintYantra Support, I need help with my PrintYantra Agent.";

export const AGENT_WHATSAPP_SUPPORT_HREF = `https://wa.me/${AGENT_WHATSAPP_E164}?text=${encodeURIComponent(AGENT_WHATSAPP_MESSAGE)}`;
