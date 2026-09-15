/**
 * Feature 2 Phase 2F — lightweight rate limit for Agent account login.
 * Mirrors the in-memory sliding-window pattern used by password-reset.
 * Counts failed attempts only (401). Successful logins clear the email bucket.
 */

type WindowState = { count: number; windowStartedAt: number };

const emailWindows = new Map<string, WindowState>();
const ipWindows = new Map<string, WindowState>();

/** Max failed Agent logins per email per rolling window. */
export const AGENT_LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const AGENT_LOGIN_EMAIL_WINDOW_MAX = 10;

/** Max failed Agent logins per IP per rolling window. */
export const AGENT_LOGIN_IP_WINDOW_MS = 60 * 60 * 1000;
export const AGENT_LOGIN_IP_WINDOW_MAX = 30;

function windowAllows(
  map: Map<string, WindowState>,
  key: string,
  windowMs: number,
  max: number,
  nowMs: number,
) {
  const existing = map.get(key);
  if (!existing || nowMs - existing.windowStartedAt > windowMs) {
    return true;
  }
  return existing.count < max;
}

function windowBump(
  map: Map<string, WindowState>,
  key: string,
  windowMs: number,
  nowMs: number,
) {
  const existing = map.get(key);
  if (!existing || nowMs - existing.windowStartedAt > windowMs) {
    map.set(key, { count: 1, windowStartedAt: nowMs });
    return;
  }
  existing.count += 1;
}

/** Test helper — clears in-memory Agent login rate-limit state. */
export function resetAgentLoginRateLimits() {
  emailWindows.clear();
  ipWindows.clear();
}

/**
 * Returns whether another login attempt is allowed before credential checks.
 * Does not increment counters (only failures record).
 */
export function checkAgentLoginRateLimit(input: {
  email: string;
  ip?: string | null;
  now?: Date;
}): { allowed: true } | { allowed: false; reason: "email_window" | "ip_window" } {
  const nowMs = (input.now || new Date()).getTime();
  const emailKey = input.email.trim().toLowerCase();

  if (
    !windowAllows(
      emailWindows,
      emailKey,
      AGENT_LOGIN_EMAIL_WINDOW_MS,
      AGENT_LOGIN_EMAIL_WINDOW_MAX,
      nowMs,
    )
  ) {
    return { allowed: false, reason: "email_window" };
  }

  if (input.ip) {
    if (
      !windowAllows(
        ipWindows,
        input.ip,
        AGENT_LOGIN_IP_WINDOW_MS,
        AGENT_LOGIN_IP_WINDOW_MAX,
        nowMs,
      )
    ) {
      return { allowed: false, reason: "ip_window" };
    }
  }

  return { allowed: true };
}

/** Record a failed Agent login (wrong password / unknown user / wrong role). */
export function recordAgentLoginFailure(input: {
  email: string;
  ip?: string | null;
  now?: Date;
}) {
  const nowMs = (input.now || new Date()).getTime();
  const emailKey = input.email.trim().toLowerCase();
  windowBump(emailWindows, emailKey, AGENT_LOGIN_EMAIL_WINDOW_MS, nowMs);
  if (input.ip) {
    windowBump(ipWindows, input.ip, AGENT_LOGIN_IP_WINDOW_MS, nowMs);
  }
}

/** Clear email failure streak after a successful login. */
export function clearAgentLoginFailuresForEmail(email: string) {
  emailWindows.delete(email.trim().toLowerCase());
}

export function getClientIpFromRequest(request: {
  headers: { get(name: string): string | null };
}): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}
