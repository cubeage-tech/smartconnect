/**
 * A credential as pasted into a host's dashboard: surrounding whitespace and
 * one pair of matching quotes removed. A trailing newline or a quoted value
 * is the usual reason a correct key is rejected by the provider (QA C1/C2).
 * Kept dependency-free so config/env.ts and lib/emailDelivery.ts can share it.
 */
export const credentialSetting = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim() ?? '';
  const unquoted = /^(['"])(.*)\1$/s.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  return unquoted || undefined;
};
