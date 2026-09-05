/**
 * Web re-export of the canonical print-settings module.
 */
export {
  PRINT_SETTINGS_VERSION,
  DEFAULT_PRINT_SETTINGS_V1,
  buildPrintSettingsV1,
  buildDefaultPrintSettingsV1,
  resolvePrintSettings,
  shouldUseLegacyPrintBehavior,
  planJobPrint,
  isValidPageRange,
  type PrintSettingsV1,
  type PrintOrientationV1,
  type PrintPaperSizeV1,
  type PrintScaleV1,
  type PrintMarginsV1,
  type ResolvedPrintSettings,
  type ResolvePrintSettingsOptions,
  type JobPrintPlan,
} from "../shared/print-settings";
