import nodemailer from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !password) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT || "465");
  const secureRaw = (process.env.SMTP_SECURE || "true").trim().toLowerCase();
  const secure = secureRaw === "true" || secureRaw === "1";

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 465,
    secure,
    user,
    password,
    from: user,
  };
}

export function isSmtpConfigured() {
  return getSmtpConfig() !== null;
}

/** Send mail via Gmail SMTP. Credentials come only from env — never logged. */
export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Inject for tests. */
  transport?: {
    sendMail: (options: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }) => Promise<unknown>;
  };
}) {
  if (input.transport) {
    const config = getSmtpConfig();
    await input.transport.sendMail({
      from: config?.from || process.env.SMTP_USER || "noreply@printmadeeasy.local",
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return;
  }

  const config = getSmtpConfig();
  if (!config) {
    throw new Error("Email is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });

  await transporter.sendMail({
    from: `PrintMadeEasy <${config.from}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

export function buildPasswordResetEmail(input: {
  resetUrl: string;
  recipientName?: string | null;
}) {
  const subject = "Reset your PrintMadeEasy password";
  const greeting = input.recipientName?.trim()
    ? `Hi ${input.recipientName.trim()},`
    : "Hi,";

  const text = [
    "PrintMadeEasy",
    "",
    "Password Reset",
    "",
    greeting,
    "",
    "We received a request to reset the password for your PrintMadeEasy account.",
    "Open the link below to create a new password:",
    "",
    input.resetUrl,
    "",
    "This link expires in 30 minutes and can only be used once.",
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "For security, PrintMadeEasy will never ask for your existing password.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;">PrintMadeEasy</p>
              <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#0f172a;">Password Reset</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;font-size:14px;line-height:1.6;color:#334155;">
              <p style="margin:0 0 14px;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 14px;">We received a request to reset the password for your PrintMadeEasy account.</p>
              <p style="margin:0 0 22px;">Click the button below to create a new password.</p>
              <p style="margin:0 0 22px;">
                <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px;">Reset Password</a>
              </p>
              <p style="margin:0 0 14px;color:#64748b;font-size:13px;">This link expires in 30 minutes and can only be used once.</p>
              <p style="margin:0 0 14px;color:#64748b;font-size:13px;">If you did not request a password reset, you can safely ignore this email.</p>
              <p style="margin:0;color:#64748b;font-size:13px;">For security, PrintMadeEasy will never ask for your existing password.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
