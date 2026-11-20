import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { APP_URL, JWT_SECRET } from '../../config/env';
import { logAuditEvent } from '../../lib/auditLog';
import { isValidEmail } from '../../lib/email';
import { findUserIdByEmail } from '../../lib/identity';
import { passwordProblem } from '../../lib/passwordPolicy';
import { prisma } from '../../lib/prisma';
import { issueSession, revokeAllSessions } from '../../lib/sessions';
import { generateOtp, hashOtp, MAX_OTP_ATTEMPTS, OTP_TTL_MS, verifyOtp as verifyOtpCode } from '../../lib/otp';
import { findSharedWorkspace, SHARED_CHANNELS, SHARED_WORKSPACE_SLUG, SharedWorkspaceMissingError } from '../../lib/sharedWorkspace';
import { hasSignupConflict, lockSignupEmail, rethrowAsDuplicateAccount } from '../../lib/signupEmail';
import { uniqueUsername } from '../../lib/username';
import { sendOtpEmail, sendResetPasswordEmail } from '../../utils/mailer';
import { acceptInvitationForNewAccount } from '../invitations/invitations.service';
import { ensureOrganizationMembership } from '../organizations/organizations.service';

/**
 * Public sign-up — anyone may create an account, and it is ALWAYS an ordinary
 * Member:
 *  - User.role is left at its default (USER — never platform ADMIN);
 *  - no AccountTierGrant row is created (no row = MEMBER, lib/policy/hierarchy),
 *    so it can never be a Team Lead;
 *  - status is the default ACTIVE.
 * Only the fields named in SignupBody are read: a role, tier, status,
 * workspace, ownership or permission sent in the request body is ignored.
 *
 * In the same transaction as the account, it joins the EXISTING SmartConnect
 * Collab (the shared workspace and its default channels) as MEMBER and lands
 * there. Sign-up never creates a workspace or a channel: if Collab is missing
 * that is a configuration/data-integrity error (503) and no account is
 * created, so nobody is ever left with no workspace at all.
 *
 * An e-mail invitation's token (the ?inviteToken= of the invitation link) is
 * optional. When it is still acceptable for exactly this address, the same
 * transaction accepts it: the account also joins that one workspace as MEMBER
 * and lands there instead. A token that is no longer acceptable (expired,
 * revoked, used, or for another address) grants nothing — and no longer
 * blocks the sign-up, since sign-up is open to everyone.
 */

/** Organization membership for the invited workspace (outside the account transaction, like accepting later). */
const joinInvitedOrganization = async (joined: { workspaceId: string } | null, userId: string) => {
  if (joined) await ensureOrganizationMembership(joined.workspaceId, userId);
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// `role` rides in the JWT so the client can decide whether to show admin UI
// without a round-trip — but it's never trusted as the *authorization*
// decision itself. Every admin-gated route re-checks the database via
// requireAdmin (middleware/admin.middleware.ts), since a role change or a ban
// must take effect before a 7-day-old token naturally expires.
//
// T.32 (audit H1): login tokens are issued with a server-side session
// (lib/sessions.ts issueSession) so they can be revoked before they expire.
type SessionMeta = { userAgent?: string | null };

const isFilledString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isMissing = (value: unknown) => value === undefined || value === null || value === '';

export const FULL_NAME_MAX = 80;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// A full-name sign-up never chooses a username, so the only possible clash is the address.
const EMAIL_TAKEN = 'An account with this email address already exists.';
const LEGACY_DUPLICATE = 'A user with this email or username already exists';
const PASSWORDS_DIFFER = 'Passwords do not match.';

/** The only sign-up fields the server reads. Anything else in the body is ignored. */
export interface SignupBody {
  fullName?: unknown;
  /** Legacy clients (and the OTP path) choose a username instead of giving a full name. */
  username?: unknown;
  email?: unknown;
  password?: unknown;
  confirmPassword?: unknown;
  inviteToken?: unknown;
}

interface SignupFields {
  email: string;
  password: string;
  /** Chosen by a legacy client; null = generated from the full name. */
  username: string | null;
  displayName: string | null;
  duplicateMessage: string;
}

const checkUsername = (username: unknown) => {
  if (typeof username !== 'string' || username.trim().length === 0) throw new HttpError(400, 'Username must be text.');
  if (username.length > 64) throw new HttpError(400, 'Username must be at most 64 characters long');
  return username;
};

const checkPassword = (password: unknown, confirmPassword: unknown) => {
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  // Optional for API clients, but when sent it must match (the web form always sends it).
  if (confirmPassword !== undefined && confirmPassword !== password) throw new HttpError(400, PASSWORDS_DIFFER);
  return password as string;
};

/**
 * Sign-up field rules. T.32 (audit M3): values of the wrong type are a 400
 * (an e-mail that is not a string is an invalid e-mail), never a 500 from
 * Prisma/bcrypt.
 *
 * Two shapes are accepted:
 *  - { fullName, email, password, confirmPassword } — the web form: the full
 *    name becomes the profile's display name and a unique username is
 *    generated from it;
 *  - { username, email, password } — legacy clients and the OTP path,
 *    validated exactly as before.
 */
const validateSignupFields = (body: SignupBody): SignupFields => {
  const { fullName, username, email, password, confirmPassword } = body;
  const legacy = fullName === undefined && username !== undefined;

  if (legacy) {
    if (isMissing(username) || isMissing(email) || isMissing(password)) {
      throw new HttpError(400, 'username, email and password are required');
    }
    if (typeof email !== 'string' || !isValidEmail(email)) throw new HttpError(400, 'Invalid email format');
    return {
      username: checkUsername(username),
      email,
      password: checkPassword(password, confirmPassword),
      displayName: null,
      duplicateMessage: LEGACY_DUPLICATE,
    };
  }

  if (isMissing(fullName) || isMissing(email) || isMissing(password)) {
    throw new HttpError(400, 'Full name, email and password are required.');
  }
  if (typeof fullName !== 'string' || fullName.trim().length === 0) throw new HttpError(400, 'Enter your full name.');
  if (CONTROL_CHARS.test(fullName)) throw new HttpError(400, 'Full name contains characters that are not allowed.');
  const displayName = fullName.trim().replace(/\s+/g, ' ');
  if (displayName.length > FULL_NAME_MAX) throw new HttpError(400, `Full name must be at most ${FULL_NAME_MAX} characters.`);
  if (typeof email !== 'string' || !isValidEmail(email)) throw new HttpError(400, 'Invalid email format');
  // A username sent alongside a full name is still honoured (and validated).
  const chosen = isMissing(username) ? null : checkUsername(username);
  return {
    username: chosen,
    email,
    password: checkPassword(password, confirmPassword),
    displayName,
    duplicateMessage: chosen ? LEGACY_DUPLICATE : EMAIL_TAKEN,
  };
};

// T.32 (audit M4): login runs bcrypt even for an unknown address, so response
// time does not reveal which addresses have accounts. Computed once, lazily.
let timingEqualiserHash: Promise<string> | null = null;
const equaliseLoginTiming = (password: string) => {
  timingEqualiserHash ??= bcrypt.hash('smartconnect-timing-equaliser', 12);
  return timingEqualiserHash.then((hash) => bcrypt.compare(password, hash)).then(() => false);
};

// E-mail format: isValidEmail (lib/email.ts) caps the length before the
// pattern runs — the pattern alone could block the event loop (FA-SEC-02).

/**
 * Inside the account transaction: membership (MEMBER) of the EXISTING
 * SmartConnect Collab and its existing default channels — the same channels
 * every activated or provisioned account gets (lib/sharedWorkspace) — and
 * Collab as the landing workspace. Upserts / skipDuplicates: never a second
 * membership. Creates no workspace and no channel; a missing Collab throws
 * (503), which rolls the whole account back.
 */
const joinSharedWorkspace = async (tx: Prisma.TransactionClient, userId: string): Promise<string> => {
  const workspace = await findSharedWorkspace(tx);
  if (!workspace) {
    console.error(
      `Sign-up refused: SmartConnect Collab (slug="${SHARED_WORKSPACE_SLUG}", isDefault=true) was not found. ` +
        'The server creates it at startup (reconcileSharedWorkspace) — check the startup log for "SmartConnect Collab reconcile failed".'
    );
    throw new SharedWorkspaceMissingError();
  }
  await tx.workspaceMember.upsert({
    where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
    update: {},
    create: { userId, workspaceId: workspace.id, role: 'MEMBER' },
  });
  await tx.user.update({ where: { id: userId }, data: { lastActiveWorkspaceId: workspace.id } });

  const channels = await tx.channel.findMany({
    where: {
      workspaceId: workspace.id,
      isDM: false,
      archivedAt: null,
      OR: SHARED_CHANNELS.map((c) => ({ name: { equals: c.name, mode: 'insensitive' as const } })),
    },
    select: { id: true },
  });
  if (channels.length === 0) {
    // Not created here: that's the shared-workspace reconcile's job, not a new account's.
    console.error('SmartConnect Collab has none of its default channels — the workspace setup is incomplete.');
  }
  await tx.channelMember.createMany({
    data: channels.map((c) => ({ userId, channelId: c.id, role: 'member' })),
    skipDuplicates: true,
  });
  return workspace.id;
};

/**
 * The account itself, inside the caller's transaction (after lockSignupEmail
 * and the duplicate check): a plain MEMBER account, SmartConnect Collab, and
 * — when a still-acceptable invitation token was given — that workspace.
 */
const createMemberAccount = async (
  tx: Prisma.TransactionClient,
  account: { username: string; email: string; passwordHash: string; displayName: string | null },
  inviteToken: unknown
) => {
  const user = await tx.user.create({
    data: {
      username: account.username,
      email: account.email,
      password: account.passwordHash,
      // role and status keep their defaults (USER, ACTIVE) and no tier grant
      // is written: whatever the request said, this is a plain Member.
      ...(account.displayName ? { profile: { create: { displayName: account.displayName } } } : {}),
    },
  });
  const sharedWorkspaceId = await joinSharedWorkspace(tx, user.id);
  const invitation = isMissing(inviteToken) ? null : await acceptInvitationForNewAccount(tx, inviteToken, user);
  return { user, lastActiveWorkspaceId: invitation?.workspaceId ?? sharedWorkspaceId, invitation };
};

type CreatedAccount = Awaited<ReturnType<typeof createMemberAccount>>;

const signupResponse = async ({ user, lastActiveWorkspaceId, invitation }: CreatedAccount, meta: SessionMeta) => {
  await joinInvitedOrganization(invitation, user.id);
  const token = await issueSession({ id: user.id, username: user.username, role: user.role }, meta);
  return {
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role, lastActiveWorkspaceId },
    invitation,
  };
};

const isUsernameClash = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && JSON.stringify(err.meta?.target ?? '').includes('username');

/**
 * POST /api/auth/signup — direct, single-step public sign-up: creates the
 * account, joins SmartConnect Collab and signs the person in. Email
 * verification is not required on this path (unchanged: it was added as the
 * active path while e-mail delivery was unreliable); the OTP path below
 * (requestSignupOtp/verifySignupOtp) stays fully working for when verified
 * sign-up is wanted. Same validation, hashing and Collab membership on both.
 */
export const signup = async (body: SignupBody, meta: SessionMeta = {}) => {
  const fields = validateSignupFields(body);
  const { email, displayName, duplicateMessage } = fields;

  // Stage 6A (AUTH-1): the address matches in any letter case (lib/signupEmail.ts).
  if (fields.username ? await hasSignupConflict(prisma, email, fields.username) : await findUserIdByEmail(prisma, email)) {
    throw new HttpError(400, duplicateMessage);
  }

  const passwordHash = await bcrypt.hash(fields.password, 12);

  const create = async (): Promise<CreatedAccount> => {
    for (let attempt = 0; ; attempt++) {
      const username = fields.username ?? (await uniqueUsername(displayName, email, 'member'));
      try {
        return await prisma.$transaction(async (tx) => {
          // Re-checked under a per-address lock: concurrent sign-ups for one
          // address (any letter case) create exactly one account.
          await lockSignupEmail(tx, email);
          const taken = fields.username ? await hasSignupConflict(tx, email, username) : await findUserIdByEmail(tx, email);
          if (taken) throw new HttpError(400, duplicateMessage);
          return createMemberAccount(tx, { username, email, passwordHash, displayName }, body.inviteToken);
        });
      } catch (err) {
        // A generated username lost a race with another account created in
        // the same instant: pick another. (A chosen one is a duplicate.)
        if (!fields.username && isUsernameClash(err)) {
          if (attempt < 2) continue;
          throw new HttpError(409, 'Could not allocate a unique username. Please try again.');
        }
        return rethrowAsDuplicateAccount(duplicateMessage)(err);
      }
    }
  };

  return signupResponse(await create(), meta);
};

/**
 * Step 1 of sign-up: validates input, hashes the password, generates a code,
 * and stores everything in OTPVerification — no `User` row is created here.
 * `email` is `@unique` on that table, so this doubles as the "resend" path:
 * requesting again just replaces the pending code/attempts/expiry.
 * (Username-based, as before: OTPVerification has no column for a full name.)
 */
export const requestSignupOtp = async (rawUsername: unknown, rawEmail: unknown, rawPassword: unknown) => {
  const { username, email, password } = validateSignupFields({ username: rawUsername ?? null, email: rawEmail, password: rawPassword });
  const chosen = username as string; // the legacy shape always carries one

  // Stage 6A (AUTH-1): any letter case. Early answer only — verifySignupOtp
  // re-checks under the per-address lock when it creates the account.
  if (await hasSignupConflict(prisma, email, chosen)) {
    throw new HttpError(400, 'A user with this email or username already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const code = generateOtp();
  const otpHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // sendOtpEmail throws if it can't actually deliver the code — better to
  // fail the request outright than store a pending signup the user has no
  // way to complete.
  await sendOtpEmail(email, code);

  await prisma.oTPVerification.upsert({
    where: { email },
    update: { username: chosen, password: hashedPassword, otpHash, attempts: 0, expiresAt },
    create: { email, username: chosen, password: hashedPassword, otpHash, expiresAt },
  });

  return { message: 'Verification code sent to your email.', expiresAt };
};

/**
 * Step 2: checks the code (expiry, attempt cap, timing-safe hash compare),
 * and only on success actually creates the `User` row (a plain Member, in
 * SmartConnect Collab, plus the invited workspace when a still-acceptable
 * invitation token is given) and removes the OTPVerification record — all
 * inside one transaction.
 */
export const verifySignupOtp = async (email: unknown, code: unknown, meta: SessionMeta = {}, inviteToken?: unknown) => {
  if (!isFilledString(email) || !isFilledString(code)) {
    throw new HttpError(400, 'email and code are required');
  }

  const pending = await prisma.oTPVerification.findUnique({ where: { email } });
  if (!pending) {
    throw new HttpError(400, 'No pending verification for this email. Request a new code.');
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.oTPVerification.delete({ where: { email } }).catch(() => {});
    throw new HttpError(400, 'This code has expired. Request a new one.');
  }

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.oTPVerification.delete({ where: { email } }).catch(() => {});
    throw new HttpError(429, 'Too many incorrect attempts. Request a new code.');
  }

  if (!verifyOtpCode(code, pending.otpHash)) {
    const attemptsNow = pending.attempts + 1;
    if (attemptsNow >= MAX_OTP_ATTEMPTS) {
      await prisma.oTPVerification.delete({ where: { email } });
      throw new HttpError(429, 'Too many incorrect attempts. Request a new code.');
    }
    await prisma.oTPVerification.update({ where: { email }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, `Incorrect code. ${MAX_OTP_ATTEMPTS - attemptsNow} attempt(s) remaining.`);
  }

  // Re-check uniqueness: someone could have registered this exact
  // email/username directly in the window since the code was requested.
  // Stage 6A (AUTH-1): any letter case (lib/signupEmail.ts).
  if (await hasSignupConflict(prisma, pending.email, pending.username)) {
    await prisma.oTPVerification.delete({ where: { email } }).catch(() => {});
    throw new HttpError(400, 'A user with this email or username already exists.');
  }

  const created = await prisma.$transaction(async (tx) => {
    // Re-checked under the per-address lock shared with direct sign-up.
    await lockSignupEmail(tx, pending.email);
    if (await hasSignupConflict(tx, pending.email, pending.username)) {
      throw new HttpError(400, 'A user with this email or username already exists.');
    }
    const account = await createMemberAccount(
      tx,
      { username: pending.username, email: pending.email, passwordHash: pending.password, displayName: null },
      inviteToken
    );
    await tx.oTPVerification.delete({ where: { email } });
    return account;
  }).catch(rethrowAsDuplicateAccount('A user with this email or username already exists.'));

  return signupResponse(created, meta);
};

export const login = async (email: unknown, password: unknown, meta: SessionMeta = {}) => {
  if (!isFilledString(email) || !isFilledString(password)) {
    throw new HttpError(400, 'email and password are required');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = user ? await bcrypt.compare(password, user.password) : await equaliseLoginTiming(password);
  if (!user || !passwordOk) {
    throw new HttpError(401, 'Invalid credentials');
  }
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, user.status === 'BANNED' ? 'This account has been banned.' : 'This account has been suspended.');
  }

  const token = await issueSession({ id: user.id, username: user.username, role: user.role }, meta);
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      lastActiveWorkspaceId: user.lastActiveWorkspaceId,
    },
  };
};

export const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, role: true, lastActiveWorkspaceId: true },
  });
  if (!user) throw new HttpError(404, 'User not found');
  return user;
};

// Shared by self-service forgotPassword below and the admin "force reset"
// action (admin.service.ts) — issues a one-time reset link and emails it.
// Appending the current password hash to the JWT secret makes the link
// self-invalidating: the moment the password actually changes, every
// previously issued link (including any the admin generated) stops verifying.
export const issuePasswordReset = async (user: { id: string; email: string; password: string }) => {
  const secret = JWT_SECRET + user.password;
  const resetToken = jwt.sign({ id: user.id }, secret, { expiresIn: '15m' });
  // The frontend's /reset-password page, at the configured frontend origin (APP_URL).
  const resetLink = `${APP_URL}/reset-password?token=${resetToken}&id=${user.id}`;
  await sendResetPasswordEmail(user.email, resetLink);
};

// T.32 (audit M1): one answer whether or not the address has an account, so
// this endpoint cannot be used to discover accounts (it is rate limited too).
const FORGOT_PASSWORD_REPLY = { message: 'If an account exists for that address, a password reset link has been sent.' };

export const forgotPassword = async (email: unknown) => {
  if (!isFilledString(email)) throw new HttpError(400, 'Email is required');
  if (!isValidEmail(email)) return FORGOT_PASSWORD_REPLY;

  const user = await prisma.user.findUnique({ where: { email } });
  // A reset never grants access by itself: a suspended or banned account
  // still cannot sign in afterwards (tests/stage2-team-leads.test.ts).
  if (!user) return FORGOT_PASSWORD_REPLY;

  await issuePasswordReset(user);
  return FORGOT_PASSWORD_REPLY;
};

const INVALID_RESET_LINK = 'Invalid or expired reset link. Please request a new one.';

/**
 * Completes a reset. T.32: the same 400 for an unknown account as for a bad
 * token (no account discovery), the shared password policy, and — audit H1 —
 * every existing session of the account is ended, so a stolen token or an
 * old device does not survive the reset.
 */
export const resetPassword = async (id: unknown, token: unknown, newPassword: unknown) => {
  if (!isFilledString(id) || !isFilledString(token) || newPassword === undefined || newPassword === null || newPassword === '') {
    throw new HttpError(400, 'Missing required fields');
  }
  const problem = passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);

  const user = await prisma.user.findUnique({ where: { id } }).catch(() => null);
  if (!user) throw new HttpError(400, INVALID_RESET_LINK);

  const secret = JWT_SECRET + user.password;
  try {
    jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(400, INVALID_RESET_LINK);
  }

  const hashedPassword = await bcrypt.hash(newPassword as string, 12);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
  const ended = await revokeAllSessions(user.id);
  await logAuditEvent(user.id, 'RESET_PASSWORD', 'USER', user.id, `Reset their password with an e-mailed link (${ended} session(s) ended)`);

  return { message: 'Password updated successfully! You can now log in.' };
};

/**
 * POST /api/auth/change-password — a signed-in user changes their own
 * password. The current password is required; every OTHER session of the
 * account is ended (this one stays signed in).
 */
export const changePassword = async (userId: string, sid: string | undefined, currentPassword: unknown, newPassword: unknown) => {
  if (!isFilledString(currentPassword) || newPassword === undefined || newPassword === null || newPassword === '') {
    throw new HttpError(400, 'currentPassword and newPassword are required');
  }
  const problem = passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  if (currentPassword === newPassword) throw new HttpError(400, 'Choose a password different from your current one.');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, password: true } });
  if (!user) throw new HttpError(404, 'User not found');
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword as string, 12) } });
  const ended = await revokeAllSessions(user.id, { exceptSid: sid });
  await logAuditEvent(user.id, 'CHANGE_PASSWORD', 'USER', user.id, `Changed their password (${ended} other session(s) ended)`);
  return { message: 'Password changed. Other devices have been signed out.', endedSessions: ended };
};

export { HttpError };
