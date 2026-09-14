/**
 * Submit job mode tokens shared by web client + server action.
 * Keep free of Node/fs and pdf-lib so the customer form can import safely.
 */

export const JOB_MODE_NORMAL = "NORMAL" as const;
export const JOB_MODE_ID_CARD_FRONT_BACK = "ID_CARD_FRONT_BACK" as const;

export type SubmitJobMode =
  | typeof JOB_MODE_NORMAL
  | typeof JOB_MODE_ID_CARD_FRONT_BACK;

export function parseSubmitJobMode(
  raw: FormDataEntryValue | null,
): SubmitJobMode {
  if (typeof raw !== "string") return JOB_MODE_NORMAL;
  const value = raw.trim();
  if (value === JOB_MODE_ID_CARD_FRONT_BACK) {
    return JOB_MODE_ID_CARD_FRONT_BACK;
  }
  return JOB_MODE_NORMAL;
}
