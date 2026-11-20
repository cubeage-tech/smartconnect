import { isValidEmail } from './email';
import { credentialSetting } from './settings';

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

const setting = (name: string) => credentialSetting(process.env[name]) ?? '';

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

/**
 * QA C2: Brevo accepting a request is the most this server can know about
 * delivery, and Brevo refusing one is often not about that message at all (a
 * revoked key, an unverified sender). After a refusal, e-mail is treated as
 * failing for a while, for every address alike: a password-reset answer then
 * stays the same whether or not the address has an account.
 */
export const EMAIL_FAILING_AFTER_REJECTION_MS = 10 * 60_000; // key or sender refused (HTTP 401/403)
export const EMAIL_FAILING_AFTER_OUTAGE_MS = 2 * 60_000; // timeout, network, 5xx
let failingUntil = 0;

export const markEmailDeliveryFailing = (forMs: number) => {
  failingUntil = Math.max(failingUntil, Date.now() + forMs);
};
export const emailDeliveryFailing = () => Date.now() < failingUntil;
/** Tests only. */
export const resetEmailDeliveryHealth = () => {
  failingUntil = 0;
};

/**
 * A send Brevo did not accept. `providerRejected` marks a refusal of this
 * server's key or sender (HTTP 401/403) as opposed to an outage. Defined here,
 * not in utils/mailer, so callers can test for it even where the mailer is
 * replaced in tests.
 */
export class EmailSendError extends Error {
  readonly providerRejected: boolean;
  constructor(message: string, providerRejected: boolean) {
    super(message);
    this.name = 'EmailSendError';
    this.providerRejected = providerRejected;
  }
}
