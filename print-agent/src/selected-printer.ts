/**
 * Default printer selection semantics (Phase 1).
 *
 * Rules:
 * - Never replace a configured selectedPrinter when it is missing/offline.
 * - First-run may initialize only when there is NO configured selection
 *   and exactly one detected printer.
 * - Explicit shopkeeper selection is handled separately (agent:set-printer).
 */

export type PrinterLike = {
  name: string;
  status: string;
};

export type ResolvedPrinterSelection = {
  /** Value that must remain in agent-config (null only if never configured). */
  configuredPrinter: string | null;
  /** True when configured name is present in the detected list. */
  isDetected: boolean;
  /** Status for UI/heartbeat. Unavailable when configured but not detected. */
  status: string;
  /**
   * Only when configuredPrinter is null and exactly one printer is detected.
   * Caller may persist this as the initial default.
   */
  firstRunCandidate: string | null;
};

export function normalizeConfiguredPrinter(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve which printer is the configured default without automatic failover.
 */
export function resolveConfiguredPrinterSelection(
  configured: string | null | undefined,
  printers: PrinterLike[],
): ResolvedPrinterSelection {
  const saved = normalizeConfiguredPrinter(configured);

  if (saved) {
    const found = printers.find((printer) => printer.name === saved);
    return {
      configuredPrinter: saved,
      isDetected: Boolean(found),
      status: found?.status || "Offline",
      firstRunCandidate: null,
    };
  }

  // Genuine first-run / no prior configuration.
  if (printers.length === 1) {
    return {
      configuredPrinter: null,
      isDetected: false,
      status: "Unknown",
      firstRunCandidate: printers[0]?.name ?? null,
    };
  }

  return {
    configuredPrinter: null,
    isDetected: false,
    status: "Unknown",
    firstRunCandidate: null,
  };
}

/**
 * Apply first-run initialization only. Never overwrites an existing config value.
 * Returns the selectedPrinter value that should be used going forward.
 */
export function applyFirstRunPrinterIfNeeded(
  configured: string | null | undefined,
  printers: PrinterLike[],
  persist: (printerName: string) => void,
): string | null {
  const resolved = resolveConfiguredPrinterSelection(configured, printers);

  if (resolved.configuredPrinter) {
    return resolved.configuredPrinter;
  }

  if (resolved.firstRunCandidate) {
    persist(resolved.firstRunCandidate);
    return resolved.firstRunCandidate;
  }

  return null;
}
