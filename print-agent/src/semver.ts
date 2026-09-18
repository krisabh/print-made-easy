/**
 * Minimal semantic version helpers for Agent update checks.
 * Expects major.minor.patch (optional leading "v"). No prerelease/build support.
 */

export type SemVer = { major: number; minor: number; patch: number };

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(value: unknown): SemVer | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = SEMVER_RE.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  return { major, minor, patch };
}

/** -1 if a < b, 0 if equal, 1 if a > b. Null if either side is malformed. */
export function compareSemver(
  a: string | SemVer,
  b: string | SemVer,
): -1 | 0 | 1 | null {
  const left = typeof a === "string" ? parseSemver(a) : a;
  const right = typeof b === "string" ? parseSemver(b) : b;
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

/** True only when remote is a valid semver strictly greater than current. */
export function isRemoteNewer(current: string, remote: string): boolean {
  const cmp = compareSemver(current, remote);
  return cmp === -1;
}
