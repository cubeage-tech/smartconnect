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

/**
 * QA L3: sign-in explains missing fields inline (no browser bubble). The login
 * is not format-checked: administrator-provisioned accounts sign in with an
 * issued identifier (such as `name@2003`) that is not a full e-mail address,
 * so the server decides — a wrong login gets its normal "invalid credentials".
 */
export const validateSignIn = (login: string, password: string): SignupErrors => {
  const errors: SignupErrors = {};
  const value = login.trim();
  if (!value) errors.email = 'Enter your email address.';
  else if (value.length > 254) errors.email = 'That sign-in is too long — check what you entered.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
};

/** QA M16: a reset link can only be sent to a real e-mail address. */
export const validateResetEmail = (email: string): string | undefined => {
  const address = email.trim();
  if (!address) return 'Enter your email address.';
  if (address.length > 254 || !EMAIL_PATTERN.test(address)) return 'Enter a valid email address, like you@company.com.';
  return undefined;
};

export interface PasswordStrength {
  label: 'Weak' | 'Fair' | 'Strong';
  /** Text colour utility for the label. */
  tone: string;
  tip?: string;
}

/**
 * QA L7: a strength hint while choosing a password — advice only. The rule the
 * server enforces (PASSWORD_MIN_LENGTH) is a product decision and unchanged.
 */
export const passwordStrength = (password: string): PasswordStrength => {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && classes >= 3) return { label: 'Strong', tone: 'text-success' };
  if (password.length >= 8 && classes >= 2) return { label: 'Fair', tone: 'text-warning', tip: 'Longer, with a symbol or number, is stronger.' };
  return { label: 'Weak', tone: 'text-danger', tip: 'Use 8+ characters with letters and numbers.' };
};
