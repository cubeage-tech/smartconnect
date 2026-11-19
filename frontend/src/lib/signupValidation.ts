/**
 * Client-side checks for public sign-up — the same rules the server applies
 * (backend auth.service validateSignupFields + lib/passwordPolicy), so most
 * mistakes are explained before a request is made. The server re-checks
 * everything; this is convenience, never the authority.
 */

export const FULL_NAME_MAX = 80;
export const PASSWORD_MIN_LENGTH = 6;
/** bcrypt ignores everything after 72 bytes, so the server refuses longer passwords. */
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface SignupInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type SignupErrors = Partial<Record<keyof SignupInput, string>>;

const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Problems keyed by field, in form order; empty when the form may be submitted. */
export const validateSignup = ({ fullName, email, password, confirmPassword }: SignupInput): SignupErrors => {
  const errors: SignupErrors = {};
  const name = fullName.trim();
  if (!name) errors.fullName = 'Enter your full name.';
  else if (CONTROL_CHARS.test(fullName)) errors.fullName = 'Your name contains characters that are not allowed.';
  else if (name.replace(/\s+/g, ' ').length > FULL_NAME_MAX) errors.fullName = `Use at most ${FULL_NAME_MAX} characters.`;

  const address = email.trim();
  if (!address) errors.email = 'Enter your email address.';
  else if (address.length > 254 || !EMAIL_PATTERN.test(address)) errors.email = 'Enter a valid email address, like you@company.com.';

  if (!password) errors.password = 'Choose a password.';
  else if (password.length < PASSWORD_MIN_LENGTH) errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (byteLength(password) > PASSWORD_MAX_BYTES) errors.password = 'This password is too long — use a shorter one.';

  if (!confirmPassword) errors.confirmPassword = 'Enter your password again.';
  else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  return errors;
};
