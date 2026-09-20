/**
 * Central upload size limit — server + client share the same default.
 *
 * Server reads MAX_UPLOAD_SIZE_MB from the environment.
 * Client receives the resolved value via ShopUploadContext (authoritative for UI).
 */

export const DEFAULT_MAX_UPLOAD_SIZE_MB = 500;

export function resolveMaxUploadSizeMb(
  envValue: string | number | null | undefined = process.env.MAX_UPLOAD_SIZE_MB,
): number {
  const raw = Number(envValue ?? DEFAULT_MAX_UPLOAD_SIZE_MB);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }
  return Math.floor(raw);
}

export function getMaxUploadSizeMb(): number {
  return resolveMaxUploadSizeMb();
}

export function getMaxUploadSizeBytes(
  maxMb: number = getMaxUploadSizeMb(),
): number {
  return maxMb * 1024 * 1024;
}

/** User-facing rejection when a file exceeds the configured limit. */
export function maxUploadSizeErrorMessage(
  maxMb: number = getMaxUploadSizeMb(),
): string {
  return `File is too large. Maximum allowed size is ${maxMb} MB.`;
}
