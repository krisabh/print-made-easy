/**
 * Simple structured logs — never log secrets or document contents.
 */
export function logInfo(event: string, detail?: string) {
  if (detail) {
    console.info(`[pme] ${event}: ${detail}`);
  } else {
    console.info(`[pme] ${event}`);
  }
}

export function logWarn(event: string, detail?: string) {
  if (detail) {
    console.warn(`[pme] ${event}: ${detail}`);
  } else {
    console.warn(`[pme] ${event}`);
  }
}

export function logError(event: string, error?: unknown) {
  const message =
    error instanceof Error ? error.message : error ? String(error) : undefined;
  if (message) {
    console.error(`[pme] ${event}: ${message}`);
  } else {
    console.error(`[pme] ${event}`);
  }
}
