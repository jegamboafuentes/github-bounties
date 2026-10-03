import { PublicApiError } from "../api/public/errors";

/**
 * C0 controls and DEL. Postgres rejects U+0000 in a text parameter, and the
 * other controls are not meaningful search text.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function containsControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

export function controlCharMessage(label: string): string {
  return `${label} cannot include control characters.`;
}

/** 400 validation_failed. Same envelope as utm_campaign / utm_source checks. */
export function rejectControlChars(value: string | null | undefined, label: string): void {
  if (value != null && value !== "" && containsControlChars(value)) {
    throw new PublicApiError("validation_failed", controlCharMessage(label));
  }
}
