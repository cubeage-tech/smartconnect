import { isValidEmail } from './email';

/**
 * T.36: whether this server can send e-mail at all. Callers use it to say so
 * honestly instead of claiming an e-mail went out. Kept apart from
 * utils/mailer — a configuration question, not a send function — so asking
 * never depends on the mail module (which several test suites replace
 * wholesale).
 *
 * E-mail goes through Brevo's transactional HTTP API (utils/mailer.ts). It
 * needs BREVO_API_KEY and BREVO_FROM_EMAIL — a plain address that is a
 * verified sender (or on a verified domain) in Brevo — in every environment:
 * Brevo has no shared test sender. BREVO_FROM_NAME is optional.
 */
export const DEFAULT_SENDER_NAME = 'SmartConnect';

const setting = (name: string) => process.env[name]?.trim() ?? '';

/** The e-mail settings that are missing or invalid — names only, never values (for the startup log). */
export const missingEmailSettings = () => [
  ...(setting('BREVO_API_KEY') ? [] : ['BREVO_API_KEY']),
  ...(isValidEmail(setting('BREVO_FROM_EMAIL')) ? [] : ['BREVO_FROM_EMAIL']),
];

export const emailDeliveryConfigured = () => missingEmailSettings().length === 0;

export interface EmailSettings {
  apiKey: string;
  sender: { name: string; email: string };
}

/** The Brevo settings, or null when e-mail delivery is not configured. */
export const emailSettings = (): EmailSettings | null =>
  emailDeliveryConfigured()
    ? {
        apiKey: setting('BREVO_API_KEY'),
        sender: { name: setting('BREVO_FROM_NAME') || DEFAULT_SENDER_NAME, email: setting('BREVO_FROM_EMAIL') },
      }
    : null;
