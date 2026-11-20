import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { APP_URL, JWT_SECRET } from '../../config/env';
import { isValidEmail } from '../../lib/email';
import { prisma } from '../../lib/prisma';
import { emailDeliveryConfigured } from '../../lib/emailDelivery';
import { sendInviteEmail } from '../../utils/mailer';
import { logAuditEvent } from '../../lib/auditLog';
import { HttpError } from '../../lib/httpError';
import { findUserIdByEmail } from '../../lib/identity';
import { isUuid } from '../../lib/messageInput';
import { isSameEmail } from '../../lib/signupEmail';
import { emitToRooms } from '../../sockets/registry';
import {
  assertWorkspace,
  canJoinWorkspaces,
  canWorkspace,
  InvitationDenial,
  invitationAcceptanceDenial,
  invitationExpiresAt,
  invitationState,
  loadWorkspaceActor,
  normalizeEmail,
} from '../../lib/policy';

/**
 * Batch 3/E: every management decision here is lib/policy
 * 'workspace.manageInvitations' (workspace owner/ADMINs plus organization
 * OWNER/ADMINs) — the old inline "WorkspaceMember.role === 'ADMIN'" check
 * ignored organization inheritance. 404 for a missing workspace, 403 for a
 * caller without the right (the established workspace convention).
 */
const assertCanManageInvitations = async (userId: string, workspaceId: unknown) => {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new HttpError(400, 'workspaceId is required');
  }
  const actor = await loadWorkspaceActor(userId, workspaceId);
  assertWorkspace(actor, 'workspace.manageInvitations');
  return actor;
};

/** Is `userId` (still) allowed to manage invitations for `workspaceId`? */
const stillManages = async (userId: string, workspaceId: string) =>
  canWorkspace(await loadWorkspaceActor(userId, workspaceId), 'workspace.manageInvitations');

// Stage 6C (IDN-3): exact and case-insensitive; "_", "%" and "\" are ordinary characters.
const findUserByEmail = async (email: string) => {
  const id = await findUserIdByEmail(prisma, email);
  return id ? { id } : null;
};

/** The link the invitee opens (InviteHandler.tsx): sign up, or sign in and accept/decline. */
const invitationLink = (token: string) => `${APP_URL}/invite/${token}`;

/**
 * Tells an invited account's open sessions to refresh its in-app invitations
 * (frontend PendingInvitations). Payload carries no token.
 */
const notifyInvitee = async (email: string, workspaceId: string) => {
  const invitee = await findUserByEmail(email);
  if (invitee) emitToRooms([], [invitee.id], 'invitations:changed', { workspaceId });
};

/**
 * GET /api/invitations[?workspaceId=] — invitations the caller sent, limited
 * to workspaces they can STILL manage (a removed or demoted admin no longer
 * sees, or can copy, those invite tokens).
 */
export const listInvitations = async (inviterId: string, workspaceId?: unknown) => {
  const rows = await prisma.invitation.findMany({
    where: { inviterId, ...(typeof workspaceId === 'string' && workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  const workspaceIds = [...new Set(rows.map((r) => r.workspaceId))];
  const allowed = new Set<string>();
  for (const id of workspaceIds) if (await stillManages(inviterId, id)) allowed.add(id);
  return rows
    .filter((r) => allowed.has(r.workspaceId))
    .map((r) => ({ ...r, state: invitationState(r), expiresAt: invitationExpiresAt(r) }));
};

/** GET /api/workspaces/:workspaceId/invitations — managers; never exposes tokens. */
export const listWorkspaceInvitations = async (actorId: string, workspaceId: string) => {
  await assertCanManageInvitations(actorId, workspaceId);
  const rows = await prisma.invitation.findMany({
    where: { workspaceId },
    select: { id: true, email: true, status: true, createdAt: true, inviter: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map(({ status, ...row }) => ({ ...row, state: invitationState({ status, createdAt: row.createdAt }), expiresAt: invitationExpiresAt(row) }));
};

export const createInvitation = async (email: unknown, inviterId: string, workspaceId: unknown) => {
  if (!email || typeof email !== 'string') {
    throw new HttpError(400, 'Valid email required');
  }
  const normalized = normalizeEmail(email);
  // FA-SEC-02: the 254-character cap now runs before the pattern (it ran after).
  if (!isValidEmail(normalized)) {
    throw new HttpError(400, 'Invalid email format');
  }
  return createInvitationForAddress(normalized, inviterId, workspaceId);
};

/**
 * The invitation itself, for a validated e-mail address (createInvitation)
 * or an existing account's own login, resolved by the server (Settings →
 * Members → Add people, members.service) — a login may be any identifier,
 * such as "sam@2003". One pending invitation per workspace and address; an
 * existing account sees it in the app at once; an e-mail goes out only when
 * the address is one and a provider is configured.
 */
export const createInvitationForAddress = async (normalized: string, inviterId: string, workspaceId: unknown) => {
  await assertCanManageInvitations(inviterId, workspaceId);
  const workspaceKey = workspaceId as string;
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceKey }, select: { name: true } });

  // Inviting someone who already has an account is the whole point now (see
  // acceptInvitation/isExistingUser) — what actually needs blocking is
  // inviting someone who's already IN this specific workspace, which would
  // just be a confusing no-op invite.
  const existingUser = await findUserByEmail(normalized);
  if (existingUser) {
    const alreadyMember = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId: workspaceKey } },
    });
    if (alreadyMember) {
      throw new HttpError(400, 'This user is already a member of this workspace.');
    }
  }

  // One pending invitation per workspace and address (any letter case): a
  // repeated request returns the pending one instead of a duplicate. The
  // per-(workspace, address) lock makes concurrent requests agree.
  const { invitation, created } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workspace-invitation:' || ${workspaceKey}::text || ':' || lower(${normalized}::text)))`;
    const pendingRows = await tx.$queryRaw<{ id: string; status: string; createdAt: Date }[]>`
      SELECT id, status, "createdAt" FROM "Invitation"
      WHERE "workspaceId" = ${workspaceKey}::text AND lower(email) = lower(${normalized}::text) AND status = 'pending'
      ORDER BY "createdAt" DESC`;
    const live = pendingRows.find((row) => invitationState(row) === 'pending');
    if (live) return { invitation: await tx.invitation.findUniqueOrThrow({ where: { id: live.id } }), created: false };
    return { invitation: await tx.invitation.create({ data: { email: normalized, inviterId, workspaceId: workspaceKey } }), created: true };
  });
  // Returned to the inviter only (never listed): the link to share when no
  // e-mail goes out. It grants nothing by itself — signing up needs this exact
  // address, and accepting needs that account's own session.
  const inviteLink = invitationLink(invitation.token);
  const result = { success: true, id: invitation.id, token: invitation.token, inviteLink, existingAccount: !!existingUser };

  if (!created) {
    return {
      status: 200,
      body: { ...result, duplicate: true, emailSent: false, message: `An invitation for ${normalized} is already pending.` },
    };
  }
  await logAuditEvent(inviterId, 'CREATE_INVITATION', 'WORKSPACE', workspaceKey, `Invited ${normalized}`);
  // An existing account sees the invitation in the app (accept or decline) at once.
  if (existingUser) emitToRooms([], [existingUser.id], 'invitations:changed', { workspaceId: workspaceKey });

  // T.36: with no e-mail provider configured, say so — never "sent". The
  // invitation still exists (it lets this address sign up), and the Team
  // Lead's no-e-mail path (Members → Add team member) is the way to add
  // someone right now.
  if (!emailDeliveryConfigured()) {
    return {
      status: 201,
      body: {
        ...result,
        emailSent: false,
        emailUnavailable: true,
        message: 'Invitation saved, but no e-mail was sent: e-mail delivery is not configured on this server.',
      },
    };
  }
  // An account whose login is not an e-mail address gets the in-app invitation only.
  if (!isValidEmail(normalized)) {
    return {
      status: 201,
      body: { ...result, emailSent: false, message: 'Invitation saved. They will see it in SmartConnect (their login is not an e-mail address).' },
    };
  }

  try {
    await sendInviteEmail(normalized, inviteLink, workspace.name);
  } catch (emailErr: any) {
    console.error('Email sending failed:', emailErr.message);
    return {
      status: 201,
      body: {
        ...result,
        emailSent: false,
        message: 'Invitation created but email failed to send',
        emailError: emailErr.message,
      },
    };
  }

  return {
    status: 201,
    body: { ...result, emailSent: true, message: 'Invite sent successfully' },
  };
};

/** DELETE /api/workspaces/:workspaceId/invitations/:invitationId — managers revoke a pending invitation. */
export const revokeInvitation = async (actorId: string, workspaceId: string, invitationId: unknown) => {
  await assertCanManageInvitations(actorId, workspaceId);
  const invitation = isUuid(invitationId)
    ? await prisma.invitation.findFirst({ where: { id: invitationId, workspaceId } })
    : null;
  if (!invitation) throw new HttpError(404, 'Invitation not found');
  const revoked = await prisma.invitation.updateMany({
    where: { id: invitation.id, status: 'pending' },
    data: { status: 'revoked' },
  });
  if (revoked.count === 0) throw new HttpError(400, 'Only pending invitations can be revoked.');
  await logAuditEvent(actorId, 'REVOKE_INVITATION', 'WORKSPACE', workspaceId, `Revoked the invitation for ${invitation.email}`);
  await notifyInvitee(invitation.email, workspaceId); // it leaves their in-app list
  return { id: invitation.id, state: 'revoked' as const };
};

const DENIALS: Record<InvitationDenial, [number, (email: string) => string]> = {
  used: [400, () => 'This invitation has already been used.'],
  declined: [400, () => 'This invitation was declined.'],
  revoked: [400, () => 'This invitation has been revoked.'],
  expired: [400, () => 'This invitation has expired.'],
  inviterLostAccess: [400, () => 'This invitation is no longer valid.'],
  wrongAccount: [403, (email) => `This invitation was sent to ${email}, not the account you're signed in as.`],
  inactiveAccount: [403, () => 'This account is not active.'],
};

/**
 * Public token inspection — no auth required, since InviteHandler.tsx calls
 * this before it knows whether the visitor is logged in at all. The
 * `isExistingUser` flag is what lets the frontend decide whether to route the
 * visitor to /login (existing account) or /signup (brand-new invitee)
 * without ever needing to attempt a login itself just to find out.
 */
export const getInvitationByToken = async (token: string) => {
  if (!token) throw new HttpError(400, 'Invalid invitation token');

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!invitation) throw new HttpError(404, 'Invitation not found or expired');
  const state = invitationState(invitation);
  const denial: InvitationDenial | null =
    state === 'accepted' ? 'used' : state === 'declined' ? 'declined' : state === 'revoked' ? 'revoked' : state === 'expired' ? 'expired'
      : (await stillManages(invitation.inviterId, invitation.workspaceId)) ? null : 'inviterLostAccess';
  if (denial) throw new HttpError(DENIALS[denial][0], DENIALS[denial][1](invitation.email));

  const existingUser = await findUserByEmail(invitation.email);

  return {
    valid: true as const,
    email: invitation.email,
    workspaceId: invitation.workspace.id,
    workspaceName: invitation.workspace.name,
    isExistingUser: !!existingUser,
  };
};

/**
 * Consumes an invitation for the CALLER'S OWN, already-authenticated session
 * — this never creates an account itself. Batch 3/E rules (lib/policy
 * invitationAcceptanceDenial): pending and not expired, the inviter must
 * still be allowed to invite, the session's email must match the invited
 * address (case-insensitively), and the account must be active. Grants plain
 * MEMBER only. Single-use is atomic; a duplicate accept by the same person
 * (double click, StrictMode) is a harmless success.
 */
export const acceptInvitation = async (token: string, userId: string) => {
  if (!token) throw new HttpError(400, 'Invalid invitation token');

  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) throw new HttpError(404, 'Invitation not found or expired');
  return acceptLoadedInvitation(invitation, userId);
};

type InvitationRow = { id: string; email: string; status: string; createdAt: Date; inviterId: string; workspaceId: string };

/** The acceptance rules above, for an invitation already loaded by token or by id. */
const acceptLoadedInvitation = async (invitation: InvitationRow, userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
  if (!user) throw new HttpError(404, 'User not found');

  const generalChannel = await prisma.channel.findFirst({
    where: { name: 'General', isDM: false, workspaceId: invitation.workspaceId },
  });
  const alreadyJoined = async () =>
    !!(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } } }));

  const denial = invitationAcceptanceDenial({
    state: invitationState(invitation),
    inviteeEmail: invitation.email,
    accountEmail: user.email,
    accountActive: canJoinWorkspaces(user),
    inviterCanManage: await stillManages(invitation.inviterId, invitation.workspaceId),
  });
  if (denial === 'used' && normalizeEmail(invitation.email) === normalizeEmail(user.email) && (await alreadyJoined()) && generalChannel) {
    return { workspaceId: invitation.workspaceId, generalChannelId: generalChannel.id };
  }
  if (denial) throw new HttpError(DENIALS[denial][0], DENIALS[denial][1](invitation.email));
  if (!generalChannel) {
    throw new HttpError(500, 'This workspace has no "General" channel to join — contact an admin.');
  }

  const consumed = await prisma.$transaction(async (tx) => {
    // Conditional update = the single-use lock: only one accept can flip it.
    const flipped = await tx.invitation.updateMany({ where: { id: invitation.id, status: 'pending' }, data: { status: 'accepted' } });
    if (flipped.count === 0) return false;
    await tx.workspaceMember.upsert({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
      update: {},
      create: { userId, workspaceId: invitation.workspaceId, role: 'MEMBER' },
    });
    await tx.channelMember.upsert({
      where: { userId_channelId: { userId, channelId: generalChannel.id } },
      update: {},
      create: { userId, channelId: generalChannel.id, role: 'member' },
    });
    return true;
  });
  // Lost the race to a concurrent accept: fine if it was this same person.
  if (!consumed && !(await alreadyJoined())) throw new HttpError(400, DENIALS.used[1](invitation.email));

  return { workspaceId: invitation.workspaceId, generalChannelId: generalChannel.id };
};

/** The signed-in account's own address, for matching invitations to it. */
const accountEmail = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new HttpError(404, 'User not found');
  return user.email;
};

/**
 * An invitation addressed to this account, by id — 404 for anyone else's, so
 * ids reveal nothing about other people's invitations.
 */
const loadOwnInvitation = async (userId: string, invitationId: unknown) => {
  const invitation = isUuid(invitationId) ? await prisma.invitation.findUnique({ where: { id: invitationId } }) : null;
  if (!invitation || normalizeEmail(invitation.email) !== normalizeEmail(await accountEmail(userId))) {
    throw new HttpError(404, 'Invitation not found');
  }
  return invitation;
};

/**
 * GET /api/invitations/received — the signed-in account's in-app workspace
 * invitations: pending, unexpired, from someone who may still invite, to a
 * workspace it is not in yet. Never includes tokens. One per workspace (the
 * newest) even if older duplicates exist.
 */
export const listReceivedInvitations = async (userId: string) => {
  const email = await accountEmail(userId);
  // Stage 6C (IDN-3): exact address in any letter case — "_" and "%" are ordinary characters.
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Invitation" WHERE lower(email) = lower(${email}::text) AND status = 'pending'`;
  if (ids.length === 0) return [];
  const rows = await prisma.invitation.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      inviterId: true,
      workspaceId: true,
      workspace: { select: { id: true, name: true } },
      inviter: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const memberOf = new Set(
    (await prisma.workspaceMember.findMany({ where: { userId, workspaceId: { in: rows.map((r) => r.workspaceId) } }, select: { workspaceId: true } }))
      .map((m) => m.workspaceId)
  );
  const received = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.workspaceId) || memberOf.has(row.workspaceId)) continue;
    if (invitationState(row) !== 'pending' || !(await stillManages(row.inviterId, row.workspaceId))) continue;
    seen.add(row.workspaceId);
    received.push({
      id: row.id,
      workspace: row.workspace,
      inviter: { id: row.inviter.id, username: row.inviter.username, displayName: row.inviter.profile?.displayName ?? null },
      createdAt: row.createdAt,
      expiresAt: invitationExpiresAt(row),
    });
  }
  return received;
};

/** POST /api/invitations/received/:invitationId/accept — same rules as accepting from the link. */
export const acceptReceivedInvitation = async (userId: string, invitationId: unknown) =>
  acceptLoadedInvitation(await loadOwnInvitation(userId, invitationId), userId);

const declineLoadedInvitation = async (invitation: InvitationRow, userId: string) => {
  if (invitationState(invitation) !== 'pending') throw new HttpError(400, 'Only pending invitations can be declined.');
  const declined = await prisma.invitation.updateMany({ where: { id: invitation.id, status: 'pending' }, data: { status: 'declined' } });
  if (declined.count === 0) throw new HttpError(400, 'Only pending invitations can be declined.');
  await logAuditEvent(userId, 'DECLINE_INVITATION', 'WORKSPACE', invitation.workspaceId, `Declined the invitation for ${invitation.email}`);
  return { id: invitation.id, state: 'declined' as const };
};

/** POST /api/invitations/received/:invitationId/decline — the invited account says no; nothing else changes. */
export const declineReceivedInvitation = async (userId: string, invitationId: unknown) =>
  declineLoadedInvitation(await loadOwnInvitation(userId, invitationId), userId);

/** POST /api/invitations/decline/:token — the same, from the invitation link (InviteHandler.tsx). */
export const declineInvitationByToken = async (token: string, userId: string) => {
  const invitation = isUuid(token) ? await prisma.invitation.findUnique({ where: { token } }) : null;
  if (!invitation) throw new HttpError(404, 'Invitation not found or expired');
  if (normalizeEmail(invitation.email) !== normalizeEmail(await accountEmail(userId))) {
    throw new HttpError(DENIALS.wrongAccount[0], DENIALS.wrongAccount[1](invitation.email));
  }
  return declineLoadedInvitation(invitation, userId);
};

/**
 * Sign-up through an e-mail invitation (auth.service signup/verifySignupOtp):
 * inside the transaction that creates the account, consume exactly the
 * invitation whose link was used and add the new account to that workspace as
 * MEMBER (+ its General channel), landing there first. null = not acceptable
 * (unknown, revoked, declined, used, expired, another address, or the inviter
 * may no longer invite) — the account is still created (sign-up is public),
 * but it gets nothing beyond SmartConnect Collab.
 */
export const acceptInvitationForNewAccount = async (
  tx: Prisma.TransactionClient,
  token: unknown,
  account: { id: string; email: string }
): Promise<{ workspaceId: string; generalChannelId: string | null } | null> => {
  if (!isUuid(token)) return null;
  const invitation = await tx.invitation.findUnique({ where: { token } });
  if (!invitation || invitationState(invitation) !== 'pending') return null;
  if (!(await isSameEmail(tx, invitation.email, account.email))) return null;
  if (!(await stillManages(invitation.inviterId, invitation.workspaceId))) return null;
  // The single-use lock, as in acceptInvitation.
  const flipped = await tx.invitation.updateMany({ where: { id: invitation.id, status: 'pending' }, data: { status: 'accepted' } });
  if (flipped.count === 0) return null;
  const { workspaceId } = invitation;
  await tx.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: account.id, workspaceId } },
    update: {},
    create: { userId: account.id, workspaceId, role: 'MEMBER' },
  });
  const general = await tx.channel.findFirst({ where: { name: 'General', isDM: false, workspaceId }, select: { id: true } });
  if (general) {
    await tx.channelMember.upsert({
      where: { userId_channelId: { userId: account.id, channelId: general.id } },
      update: {},
      create: { userId: account.id, channelId: general.id, role: 'member' },
    });
  }
  await tx.user.update({ where: { id: account.id }, data: { lastActiveWorkspaceId: workspaceId } });
  return { workspaceId, generalChannelId: general?.id ?? null };
};

// Discord/Slack-style reusable invite link — "anyone with the link can ask
// to join". Backed by an opaque random token in WorkspaceInviteLink.
//
// These used to be JWTs signed with the session JWT_SECRET and carrying only
// { workspaceId }. Because `authenticate` accepts any JWT signed with that
// secret, a link token doubled as a login token with no user id, which
// unscoped several list queries (audit SEC-01). DB tokens can't be confused
// with session JWTs and can be expired/revoked per link.
const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Reuse the newest active link unless it expires within a day, so repeatedly
// opening the invite dialog doesn't mint a new row every time.
const INVITE_LINK_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

const newInviteToken = () => crypto.randomBytes(32).toString('base64url');

export const getWorkspaceInviteLink = async (adminId: string, workspaceId: string) => {
  await assertCanManageInvitations(adminId, workspaceId);

  const reusable = await prisma.workspaceInviteLink.findFirst({
    where: {
      workspaceId,
      revokedAt: null,
      expiresAt: { gt: new Date(Date.now() + INVITE_LINK_MIN_REMAINING_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  const link =
    reusable ??
    (await prisma.workspaceInviteLink.create({
      data: {
        token: newInviteToken(),
        workspaceId,
        createdById: adminId,
        expiresAt: new Date(Date.now() + INVITE_LINK_TTL_MS),
      },
    }));

  return { url: `${APP_URL}/join-workspace?token=${link.token}`, expiresAt: link.expiresAt };
};

/** DELETE /api/workspaces/:workspaceId/invite-link — revokes every active link (new ones can be generated). */
export const revokeInviteLinks = async (actorId: string, workspaceId: string) => {
  await assertCanManageInvitations(actorId, workspaceId);
  const result = await prisma.workspaceInviteLink.updateMany({
    where: { workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await logAuditEvent(actorId, 'REVOKE_INVITE_LINKS', 'WORKSPACE', workspaceId, `Revoked ${result.count} invite link(s)`);
  return { revoked: result.count };
};

interface LegacyWorkspaceJoinTokenPayload {
  workspaceId?: unknown;
}

/**
 * Resolves a join-link token to its workspace id.
 *
 * LEGACY: JWT links issued before this change are still honoured, verify
 * only, until they expire naturally (7-day TTL). No code path mints them
 * anymore, so this branch can be deleted once this change has been deployed
 * for 7 days.
 */
const resolveInviteToken = async (token: string): Promise<{ workspaceId: string; linkId: string | null }> => {
  const link = await prisma.workspaceInviteLink.findUnique({ where: { token } });
  if (link) {
    if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, 'This invite link is invalid or has expired.');
    }
    return { workspaceId: link.workspaceId, linkId: link.id };
  }

  if (token.split('.').length === 3) {
    try {
      const payload = jwt.verify(token, JWT_SECRET as string) as LegacyWorkspaceJoinTokenPayload;
      if (typeof payload.workspaceId === 'string' && payload.workspaceId) {
        return { workspaceId: payload.workspaceId, linkId: null };
      }
    } catch {
      // fall through to the generic error below
    }
  }
  throw new HttpError(400, 'This invite link is invalid or has expired.');
};

// Authenticated — files a join request for whoever is currently signed in.
// No email-match check (unlike acceptInvitation): this link was never bound
// to a specific recipient in the first place. Deliberately does NOT add the
// user to WorkspaceMember directly — see resolveJoinRequest, which is the
// only place that actually happens, gated on admin approval.
export const requestToJoinWorkspace = async (userId: string, token: string) => {
  if (!token || typeof token !== 'string' || token.length > 2048) {
    throw new HttpError(400, 'Invalid invite link');
  }

  const { workspaceId, linkId } = await resolveInviteToken(token);

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new HttpError(404, 'This workspace no longer exists.');
  }
  // Batch 3/E: suspended/banned accounts can't ask to join anything.
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!account || !canJoinWorkspaces(account)) throw new HttpError(403, 'This account is not active.');

  // Already a member (e.g. re-clicking an old link, or a previously
  // approved request) — no need to file another request, just let them
  // straight in like a normal workspace open.
  const existingMembership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (existingMembership) {
    const generalChannel = await prisma.channel.findFirst({
      where: { name: 'General', isDM: false, workspaceId },
    });
    if (!generalChannel) {
      throw new HttpError(500, 'This workspace has no "General" channel to join — contact an admin.');
    }
    return { status: 'already_member' as const, workspaceId, generalChannelId: generalChannel.id };
  }

  // Upsert rather than a plain create: re-requesting after a REJECTED
  // decision resets the same row back to PENDING instead of failing on the
  // @@unique([userId, workspaceId]) constraint or piling up duplicate rows.
  // Re-requesting while already PENDING is a harmless no-op (same result).
  await prisma.workspaceJoinRequest.upsert({
    where: { userId_workspaceId: { userId, workspaceId } },
    update: { status: 'PENDING' },
    create: { userId, workspaceId, status: 'PENDING' },
  });
  if (linkId) {
    await prisma.workspaceInviteLink.update({ where: { id: linkId }, data: { useCount: { increment: 1 } } });
  }

  return { status: 'pending' as const };
};

// GET /api/workspaces/:workspaceId/requests — admin only.
export const listPendingJoinRequests = async (adminId: string, workspaceId: string) => {
  await assertCanManageInvitations(adminId, workspaceId);

  return prisma.workspaceJoinRequest.findMany({
    where: { workspaceId, status: 'PENDING' },
    include: { user: { select: { id: true, username: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
};

// PUT /api/workspaces/:workspaceId/requests/:requestId — admin only.
// APPROVE is the only path that actually creates the WorkspaceMember (+
// General ChannelMember) row — the reusable link itself no longer does this
// directly (see requestToJoinWorkspace above).
export const resolveJoinRequest = async (
  adminId: string,
  workspaceId: string,
  requestId: string,
  action: 'APPROVE' | 'REJECT'
) => {
  await assertCanManageInvitations(adminId, workspaceId);

  if (action !== 'APPROVE' && action !== 'REJECT') {
    throw new HttpError(400, 'action must be APPROVE or REJECT');
  }

  const joinRequest = isUuid(requestId) ? await prisma.workspaceJoinRequest.findUnique({ where: { id: requestId } }) : null;
  if (!joinRequest || joinRequest.workspaceId !== workspaceId) {
    throw new HttpError(404, 'Join request not found');
  }
  if (joinRequest.status !== 'PENDING') {
    throw new HttpError(400, 'This request has already been resolved.');
  }

  if (action === 'REJECT') {
    // Conditional update: a concurrent APPROVE/REJECT can't both win.
    const rejected = await prisma.workspaceJoinRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
    if (rejected.count === 0) throw new HttpError(400, 'This request has already been resolved.');
    await logAuditEvent(adminId, 'REJECT_JOIN_REQUEST', 'WORKSPACE', workspaceId, `Rejected join request of user ${joinRequest.userId}`);
    return { status: 'REJECTED' as const };
  }

  // Batch 3/E: never approve a suspended/banned account into a workspace.
  const requester = await prisma.user.findUnique({ where: { id: joinRequest.userId }, select: { status: true } });
  if (!requester || !canJoinWorkspaces(requester)) {
    throw new HttpError(409, 'That account is not active and cannot join this workspace.');
  }

  const generalChannel = await prisma.channel.findFirst({
    where: { name: 'General', isDM: false, workspaceId },
  });
  if (!generalChannel) {
    throw new HttpError(500, 'This workspace has no "General" channel to add the user to — contact an admin.');
  }

  await prisma.$transaction(async (tx) => {
    const approved = await tx.workspaceJoinRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
    if (approved.count === 0) throw new HttpError(400, 'This request has already been resolved.');
    // Always plain MEMBER — the requester never chooses a role.
    await tx.workspaceMember.upsert({
      where: { userId_workspaceId: { userId: joinRequest.userId, workspaceId } },
      update: {},
      create: { userId: joinRequest.userId, workspaceId, role: 'MEMBER' },
    });
    await tx.channelMember.upsert({
      where: { userId_channelId: { userId: joinRequest.userId, channelId: generalChannel.id } },
      update: {},
      create: { userId: joinRequest.userId, channelId: generalChannel.id, role: 'member' },
    });
  });
  // QA L43: name the person (the id stays for traceability).
  const approvedUser = await prisma.user.findUnique({ where: { id: joinRequest.userId }, select: { username: true } });
  await logAuditEvent(
    adminId,
    'APPROVE_JOIN_REQUEST',
    'WORKSPACE',
    workspaceId,
    `Approved the join request of "${approvedUser?.username ?? 'unknown user'}" (user ${joinRequest.userId})`
  );

  return {
    status: 'APPROVED' as const,
    approvedUserId: joinRequest.userId,
    generalChannelId: generalChannel.id,
  };
};

export { HttpError };
