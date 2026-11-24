import bcrypt from 'bcryptjs';
import { AccountInvitationStatus, AccountTier, Prisma } from '@prisma/client';
import { APP_URL } from '../../config/env';
import { logAuditEvent } from '../../lib/auditLog';
import { emailDeliveryConfigured } from '../../lib/emailDelivery';
import { isValidEmail } from '../../lib/email';
import { HttpError } from '../../lib/httpError';
import { findUserIdByEmail } from '../../lib/identity';
import { isUuid } from '../../lib/messageInput';
import { prisma } from '../../lib/prisma';
import { revokeAllSessions } from '../../lib/sessions';
import { ensureSharedWorkspaceMembership, SYSTEM_USER_EMAIL } from '../../lib/sharedWorkspace';
import { uniqueUsername } from '../../lib/username';
import { sendAccountInvitationEmail } from '../../utils/mailer';
import {
  BCRYPT_COST,
  credentialFingerprint,
  generateActivationToken,
  generateTemporaryPassword,
  generateUnusablePassword,
  hashActivationToken,
  invitationTtlMs,
} from './credentials';

/**
 * Stage 2 (T.20) — Company Admin → Team Lead provisioning. Every route that
 * calls these is mounted behind requireSessionUser + requireAdmin (unchanged,
 * DB role re-check), so only Company Admins (platform ADMIN) reach them.
 *
 * Separate from the existing admin "Create user" (userProvisioning.service,
 * unchanged): this creates an ordinary USER account holding the TEAM_LEAD
 * tier, with an unknowable password, plus a single-use activation invitation.
 * The account stays SUSPENDED until activation (T.21): no sign-in by any
 * route (login, forgot-password reset, sockets), and no SmartConnect Collab
 * membership (the reconcile only adds ACTIVE accounts) until then.
 * The plaintext link token and temporary password are returned ONCE, in the
 * response to the admin who created them, and are never stored or logged.
 */

export const RESERVED_EMAILS = [SYSTEM_USER_EMAIL, 'deleted-user@system.internal'];
const TEXT_MAX = 80;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
export const DUPLICATE = 'An account with this e-mail address already exists.';

export type InvitationView = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/** EXPIRED is derived: a PENDING invitation whose expiry has passed. */
export const invitationView = (invitation: { status: AccountInvitationStatus; expiresAt: Date }, now = Date.now()): InvitationView =>
  invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= now ? 'EXPIRED' : invitation.status;

// Explicit selections: hashes and fingerprints are never read into a response.
export const INVITATION_SELECT = {
  id: true,
  status: true,
  teamLabel: true,
  expiresAt: true,
  createdAt: true,
  acceptedAt: true,
  revokedAt: true,
  revokedReason: true,
} as const;

const TEAM_LEAD_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  profile: { select: { displayName: true } },
  accountInvitations: { orderBy: { createdAt: 'desc' as const }, take: 1, select: INVITATION_SELECT },
} as const;

type InvitationRow = Prisma.AccountInvitationGetPayload<{ select: typeof INVITATION_SELECT }>;
type TeamLeadRow = Prisma.UserGetPayload<{ select: typeof TEAM_LEAD_SELECT }>;

export const toInvitation = (invitation: InvitationRow) => ({ ...invitation, status: invitationView(invitation) });

const toTeamLead = (user: TeamLeadRow) => ({
  id: user.id,
  username: user.username,
  loginId: user.email,
  displayName: user.profile?.displayName ?? null,
  status: user.status,
  createdAt: user.createdAt,
  invitation: user.accountInvitations[0] ? toInvitation(user.accountInvitations[0]) : null,
});

const loadTeamLead = async (userId: string) =>
  toTeamLead(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: TEAM_LEAD_SELECT }));

// The token travels in the URL fragment, which browsers never send to a
// server — so it cannot end up in access logs or Referer headers.
export const activationUrl = (token: string) => `${APP_URL.replace(/\/+$/, '')}/activate#token=${token}`;

export const parseEmail = (value: unknown) => {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a valid e-mail address.');
  const email = value.trim().toLowerCase();
  // isValidEmail caps the length before its pattern runs (FA-SEC-02).
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid e-mail address.');
  return email;
};

export const parseOptionalText = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > TEXT_MAX || CONTROL_CHARS.test(text)) throw new HttpError(400, `${label} must be at most ${TEXT_MAX} characters.`);
  return text;
};

/** A readable, unique username (moved to lib/username.ts; shared with public sign-up). */
export { uniqueUsername };

export const uniqueViolationOn = (err: unknown, field: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && JSON.stringify(err.meta?.target ?? '').includes(field);

/** Fresh one-time credentials and the invitation row data that stores only their hashes. */
export const issueCredentials = async () => {
  const token = generateActivationToken();
  const temporaryPassword = generateTemporaryPassword();
  const tempPasswordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + invitationTtlMs());
  return { token, temporaryPassword, expiresAt, row: { tokenHash: hashActivationToken(token), tempPasswordHash, expiresAt } };
};

export const credentialsResponse = (loginId: string, issued: Awaited<ReturnType<typeof issueCredentials>>) => ({
  loginId,
  temporaryPassword: issued.temporaryPassword,
  activationUrl: activationUrl(issued.token),
  expiresAt: issued.expiresAt,
});

/** What happened to the activation e-mail — the one-time credentials go to the creator either way. */
export type AccountInvitationDelivery = { emailSent: boolean; emailUnavailable?: true };

/**
 * E-mails a newly provisioned account (Team Lead, or Member of
 * `workspaceName`) its login, temporary password and activation link.
 * Existing accounts never come through here: they get workspace invitations
 * (invitations.service). Delivery is reported, never assumed: with no e-mail
 * provider, or if sending fails, the account still exists awaiting
 * activation and its creator holds the one-time credentials to hand over
 * (or reissues them). The secrets are never logged.
 */
export const emailAccountInvitation = async (
  role: 'TEAM_LEAD' | 'MEMBER',
  loginId: string,
  issued: Awaited<ReturnType<typeof issueCredentials>>,
  workspaceName: string | null
): Promise<AccountInvitationDelivery> => {
  if (!emailDeliveryConfigured()) return { emailSent: false, emailUnavailable: true };
  try {
    await sendAccountInvitationEmail({
      to: loginId,
      role,
      loginId,
      temporaryPassword: issued.temporaryPassword,
      activationUrl: activationUrl(issued.token),
      expiresAt: issued.expiresAt,
      workspaceName,
    });
    return { emailSent: true };
  } catch (err) {
    // No recipient address in the log (it is personal data and the person who
    // added them already sees the failure in the response).
    console.error(`Account invitation e-mail (${role}) failed:`, err instanceof Error ? err.message : 'unknown error');
    return { emailSent: false };
  }
};

/**
 * Why an existing account cannot simply be made a Team Lead, or null when it
 * can (promoteToTeamLead). Only an ACTIVE, ordinary account qualifies.
 */
const promotionBlocker = (account: { role: string; status: string; email: string; accountTier: { tier: AccountTier } | null }) => {
  if (RESERVED_EMAILS.includes(account.email.toLowerCase())) return 'This account cannot be changed.';
  if (account.role === 'ADMIN') return 'Company Admins already have every Team Lead capability.';
  if (account.accountTier?.tier === 'TEAM_LEAD') return 'This account is already a Team Lead.';
  if (account.status !== 'ACTIVE') return 'Only active accounts can be made Team Leads.';
  return null;
};

const PROMOTION_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  status: true,
  accountTier: { select: { tier: true } },
  profile: { select: { displayName: true } },
} as const;

export type ProvisionTeamLeadResult =
  | {
      kind: 'created';
      body: { teamLead: ReturnType<typeof toTeamLead>; credentials: ReturnType<typeof credentialsResponse>; delivery: AccountInvitationDelivery };
    }
  | { kind: 'conflict'; body: Record<string, unknown> };

/** POST /api/team-management/team-leads { email, displayName?, teamLabel? } */
export const provisionTeamLead = async (adminId: string, body: Record<string, unknown> | undefined): Promise<ProvisionTeamLeadResult> => {
  // Only these three fields are read; anything else in the body (role, tier,
  // status, password, …) is ignored.
  const email = parseEmail(body?.email);
  const displayName = parseOptionalText(body?.displayName, 'Display name');
  const teamLabel = parseOptionalText(body?.teamLabel, 'Team label');

  if (RESERVED_EMAILS.includes(email)) throw new HttpError(409, DUPLICATE);
  // Stage 6C (IDN-3): exact and case-insensitive; "_", "%" and "\" are ordinary characters.
  const existingId = await findUserIdByEmail(prisma, email);
  if (existingId) {
    // Never a second account, and never a new password for this one. Tell the
    // admin whether the existing account (e.g. a self-registered Member) can
    // be made a Team Lead instead — a separate, explicit action.
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: existingId }, select: PROMOTION_SELECT });
    const blocker = promotionBlocker(existing);
    return {
      kind: 'conflict',
      body: {
        error: DUPLICATE,
        existingAccount: true,
        promotable: blocker === null,
        ...(blocker ? { reason: blocker } : {}),
        user: { id: existing.id, username: existing.username, displayName: existing.profile?.displayName ?? null, status: existing.status },
      },
    };
  }

  const { userId, username, issued } = await createInvitedAccount(adminId, { email, displayName, teamLabel, tier: 'TEAM_LEAD', workspaceId: null });
  await logAuditEvent(
    adminId,
    'PROVISION_TEAM_LEAD',
    'USER',
    userId,
    `Provisioned Team Lead "${username}" (login ${email})${teamLabel ? ` for "${teamLabel}"` : ''}; invitation expires ${issued.expiresAt.toISOString()}`
  );
  const delivery = await emailAccountInvitation('TEAM_LEAD', email, issued, null);
  return { kind: 'created', body: { teamLead: await loadTeamLead(userId), credentials: credentialsResponse(email, issued), delivery } };
};

/**
 * POST /api/team-management/team-leads/promote { userId } — a Company Admin
 * makes an existing, ACTIVE ordinary account (typically a self-registered
 * Member) a Team Lead. The account keeps its password, sessions, workspace
 * memberships and platform role; only the TEAM_LEAD tier is granted. No other
 * route grants a tier — signup, invitations and Team Leads never can.
 */
export const promoteToTeamLead = async (adminId: string, body: Record<string, unknown> | undefined) => {
  const userId = body?.userId;
  if (!isUuid(userId)) throw new HttpError(404, 'Account not found.');
  const account = await prisma.user.findUnique({ where: { id: userId }, select: PROMOTION_SELECT });
  if (!account || RESERVED_EMAILS.includes(account.email.toLowerCase())) throw new HttpError(404, 'Account not found.');
  const blocker = promotionBlocker(account);
  if (blocker) throw new HttpError(409, blocker);

  await prisma.$transaction(async (tx) => {
    // Re-checked under a row lock, so a concurrent suspension or promotion
    // cannot slip in between the check above and the grant.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${account.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: account.id }, select: PROMOTION_SELECT });
    const stillBlocked = promotionBlocker(current);
    if (stillBlocked) throw new HttpError(409, stillBlocked);
    await tx.accountTierGrant.upsert({
      where: { userId: account.id },
      update: { tier: 'TEAM_LEAD', grantedById: adminId },
      create: { userId: account.id, tier: 'TEAM_LEAD', grantedById: adminId },
    });
  });
  await logAuditEvent(adminId, 'PROMOTE_TEAM_LEAD', 'USER', account.id, `Made existing account "${account.username}" a Team Lead`);
  return { teamLead: await loadTeamLead(account.id) };
};

/** A Team Lead by id — 404 for anyone else (Members, admins, system accounts, unknown ids). */
const loadTeamLeadAccount = async (userId: unknown) => {
  if (!isUuid(userId)) throw new HttpError(404, 'Team Lead not found.');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, status: true, accountTier: { select: { tier: true } }, accountInvitations: { select: { status: true } } },
  });
  if (!user || user.accountTier?.tier !== 'TEAM_LEAD' || RESERVED_EMAILS.includes(user.email.toLowerCase())) {
    throw new HttpError(404, 'Team Lead not found.');
  }
  return user;
};

/**
 * Has this Team Lead ever been able to sign in? Provisioned accounts stay
 * SUSPENDED until they activate (T.21), so "SUSPENDED" alone does not tell a
 * deactivated Team Lead from one still awaiting activation. A Team Lead with
 * no invitation at all was promoted from an existing account (or backfilled).
 */
const hasActivated = (lead: { accountInvitations: { status: AccountInvitationStatus }[] }) =>
  lead.accountInvitations.length === 0 || lead.accountInvitations.some((i) => i.status === 'ACCEPTED');

/**
 * POST /api/team-management/team-leads/:userId/deactivate — the Team Lead can
 * no longer sign in (ACTIVE → SUSPENDED) and every session ends at once. Their
 * tier, workspaces and memberships are kept, so reactivating restores
 * everything; while deactivated, the hierarchy grants them nothing
 * (lib/policy loadHierarchyActor reads status on every request).
 */
export const deactivateTeamLead = async (adminId: string, userId: unknown) => {
  const lead = await loadTeamLeadAccount(userId);
  if (lead.id === adminId) throw new HttpError(400, 'You cannot deactivate your own account.');
  if (lead.status === 'BANNED') throw new HttpError(409, 'This account is banned. Manage it under User Management.');
  const changed = await prisma.user.updateMany({ where: { id: lead.id, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
  if (changed.count === 0) {
    throw new HttpError(409, hasActivated(lead) ? 'This Team Lead is already deactivated.' : 'This Team Lead has not activated their account yet. Revoke the invitation instead.');
  }
  const ended = await revokeAllSessions(lead.id); // also disconnects their live sockets
  await logAuditEvent(adminId, 'DEACTIVATE_TEAM_LEAD', 'USER', lead.id, `Deactivated Team Lead "${lead.username}" (${ended} session(s) ended)`);
  return { teamLead: await loadTeamLead(lead.id) };
};

/**
 * POST /api/team-management/team-leads/:userId/reactivate — SUSPENDED → ACTIVE
 * for a Team Lead who had activated before. A Team Lead still awaiting
 * activation is refused: making that account ACTIVE would only break its
 * activation (reissue the invitation instead).
 */
export const reactivateTeamLead = async (adminId: string, userId: unknown) => {
  const lead = await loadTeamLeadAccount(userId);
  if (!hasActivated(lead)) {
    throw new HttpError(409, 'This Team Lead has not activated their account yet. Reissue the invitation instead.');
  }
  if (lead.status === 'BANNED') throw new HttpError(409, 'This account is banned. Manage it under User Management.');
  const changed = await prisma.user.updateMany({ where: { id: lead.id, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } });
  if (changed.count === 0) throw new HttpError(409, 'This Team Lead is already active.');
  await ensureSharedWorkspaceMembership(lead.id); // SmartConnect Collab, as for every active account
  await logAuditEvent(adminId, 'REACTIVATE_TEAM_LEAD', 'USER', lead.id, `Reactivated Team Lead "${lead.username}"`);
  return { teamLead: await loadTeamLead(lead.id) };
};

/**
 * Shared by Company Admin → Team Lead (Stage 2) and Team Lead → Member
 * (Stage 3): one SUSPENDED account with an unknowable password, its tier
 * (a TEAM_LEAD grant; Members get no row = MEMBER), and one PENDING
 * activation invitation storing only hashes. Callers authorize and check
 * duplicates first; a concurrent duplicate e-mail still ends in 409 here.
 */
export const createInvitedAccount = async (
  creatorId: string,
  account: { email: string; displayName: string | null; teamLabel: string | null; tier: AccountTier; workspaceId: string | null }
) => {
  const { email, displayName, teamLabel, tier, workspaceId } = account;
  // The account's own password is an unknowable random value: the normal
  // login can never accept the temporary password, which lives only (hashed)
  // on the invitation.
  const placeholderHash = await bcrypt.hash(generateUnusablePassword(), BCRYPT_COST);
  const issued = await issueCredentials();
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = await uniqueUsername(displayName, email);
    try {
      const userId = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username,
            email,
            password: placeholderHash,
            role: 'USER', // never platform ADMIN
            status: 'SUSPENDED', // until activation (T.21)
            ...(displayName ? { profile: { create: { displayName } } } : {}),
          },
          select: { id: true },
        });
        if (tier === 'TEAM_LEAD') await tx.accountTierGrant.create({ data: { userId: user.id, tier: 'TEAM_LEAD', grantedById: creatorId } });
        await tx.accountInvitation.create({
          data: {
            ...issued.row,
            userId: user.id,
            intendedTier: tier,
            credentialFingerprint: credentialFingerprint(placeholderHash),
            teamLabel,
            workspaceId,
            createdById: creatorId,
          },
        });
        return user.id;
      });
      return { userId, username, issued };
    } catch (err) {
      if (uniqueViolationOn(err, 'email')) throw new HttpError(409, DUPLICATE);
      if (uniqueViolationOn(err, 'username')) continue; // lost a race for the generated username — pick another
      throw err;
    }
  }
  throw new HttpError(409, 'Could not allocate a unique username. Please try again.');
};

/** GET /api/team-management/team-leads — every Team Lead with their latest invitation (no secrets). */
export const listTeamLeads = async () => {
  const users = await prisma.user.findMany({
    where: { accountTier: { tier: 'TEAM_LEAD' } },
    select: TEAM_LEAD_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return users.map(toTeamLead);
};

/** POST /api/team-management/invitations/:invitationId/revoke — pending (or expired) only. */
export const revokeInvitation = async (adminId: string, invitationId: unknown) => {
  if (!isUuid(invitationId)) throw new HttpError(404, 'Invitation not found.');
  const invitation = await prisma.accountInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, userId: true, user: { select: { username: true } } },
  });
  if (!invitation) throw new HttpError(404, 'Invitation not found.');
  const revoked = await prisma.accountInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'ADMIN', tempPasswordHash: null },
  });
  if (revoked.count === 0) throw new HttpError(409, 'Only pending invitations can be revoked.');
  await logAuditEvent(adminId, 'REVOKE_ACCOUNT_INVITATION', 'USER', invitation.userId, `Revoked the activation invitation of "${invitation.user.username}"`);
  return { invitation: toInvitation(await prisma.accountInvitation.findUniqueOrThrow({ where: { id: invitationId }, select: INVITATION_SELECT })) };
};

/**
 * POST /api/team-management/team-leads/:userId/reissue — a fresh invitation
 * for a provisioned Team Lead who never activated (previous one expired or
 * revoked). Refused while a live invitation exists, after activation, or if
 * the account's password was set some other way.
 */
export const reissueInvitation = async (adminId: string, userId: unknown) => {
  const { email, issued, userId: id } = await reissueAccountInvitation(adminId, userId, { tier: 'TEAM_LEAD', workspaceId: null });
  const delivery = await emailAccountInvitation('TEAM_LEAD', email, issued, null);
  return { teamLead: await loadTeamLead(id), credentials: credentialsResponse(email, issued), delivery };
};

/**
 * Shared reissue (Stage 2 Team Leads, Stage 3 Members): a fresh invitation for
 * a provisioned account that never activated, within the caller's scope (the
 * account's tier, and — for Members — the workspace the invitation binds).
 */
export const reissueAccountInvitation = async (
  actorId: string,
  userId: unknown,
  scope: { tier: AccountTier; workspaceId: string | null }
) => {
  const NOT_FOUND = 'No pending activation to reissue for this account.';
  if (!isUuid(userId)) throw new HttpError(404, NOT_FOUND);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      password: true, // used only to compare fingerprints below; never returned
      accountTier: { select: { tier: true } },
      accountInvitations: {
        orderBy: { createdAt: 'desc' },
        select: { status: true, expiresAt: true, credentialFingerprint: true, teamLabel: true, intendedTier: true, workspaceId: true },
      },
    },
  });
  const latest = user?.accountInvitations[0];
  if (
    !user ||
    !latest ||
    (user.accountTier?.tier ?? 'MEMBER') !== scope.tier ||
    latest.intendedTier !== scope.tier ||
    (latest.workspaceId ?? null) !== scope.workspaceId
  ) {
    throw new HttpError(404, NOT_FOUND);
  }
  if (user.accountInvitations.some((i) => i.status === 'ACCEPTED')) throw new HttpError(409, 'This account has already been activated.');
  if (user.accountInvitations.some((i) => invitationView(i) === 'PENDING')) {
    throw new HttpError(409, 'A pending invitation already exists. Revoke it first, or wait until it expires.');
  }
  if (credentialFingerprint(user.password) !== latest.credentialFingerprint) {
    throw new HttpError(409, "This account's password was set another way, so it cannot be activated by invitation.");
  }
  if (user.status !== 'SUSPENDED') throw new HttpError(409, 'This account is no longer awaiting activation, so it cannot get a new invitation.');

  const issued = await issueCredentials();
  await prisma.$transaction(async (tx) => {
    // Serialize reissues for this account, then re-check under the lock.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const now = new Date();
    if (await tx.accountInvitation.count({ where: { userId: user.id, status: 'PENDING', expiresAt: { gt: now } } })) {
      throw new HttpError(409, 'A pending invitation already exists. Revoke it first, or wait until it expires.');
    }
    await tx.accountInvitation.updateMany({
      where: { userId: user.id, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: now, revokedReason: 'REISSUED', tempPasswordHash: null },
    });
    await tx.accountInvitation.create({
      data: {
        ...issued.row,
        userId: user.id,
        intendedTier: scope.tier,
        credentialFingerprint: latest.credentialFingerprint,
        teamLabel: latest.teamLabel,
        workspaceId: latest.workspaceId,
        createdById: actorId,
      },
    });
  });
  await logAuditEvent(actorId, 'REISSUE_ACCOUNT_INVITATION', 'USER', user.id, `Reissued the activation invitation of "${user.username}"; expires ${issued.expiresAt.toISOString()}`);
  return { userId: user.id, email: user.email, username: user.username, issued };
};
