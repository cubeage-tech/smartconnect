import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real mailer module, with its senders observable and never delivering anything.
vi.mock('../utils/mailer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/mailer')>();
  return {
    ...real,
    sendInviteEmail: vi.fn().mockResolvedValue({ success: true }),
    sendAccountInvitationEmail: vi.fn().mockResolvedValue(undefined),
  };
});

import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { sendAccountInvitationEmail, sendInviteEmail } from '../utils/mailer';
import { authHeader, createAndLoginUser, createTeamLead, uniqueEmail } from './helpers';

/**
 * The SmartConnect role model end to end, over the API: public sign-up makes
 * Members; only a Company Admin creates, promotes, deactivates or reactivates
 * Team Leads; Team Leads create workspaces and invite people (new and
 * existing) to their own workspaces only; workspaces stay isolated.
 * E-mail is "configured" with the mailer mocked — nothing is delivered.
 * Disposable test DB only.
 */

const PASSWORD = 'Password123!';
const NEW_PASSWORD = 'a-brand-new-passphrase';
type Session = { token: string };
const as = (u: Session) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set(authHeader(u.token)).send(b),
});
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const activate = (body: object) => request(app).post('/api/account-activation').send(body);
const tokenFrom = (activationUrl: string) => new URL(activationUrl).hash.replace(/^#token=/, '');
const workspaceIds = async (u: Session) => ((await as(u).get('/api/workspaces')).body as { id: string }[]).map((w) => w.id).sort();
const TL = '/api/team-management';

/** A self-registered Member, through the real public sign-up. */
const publicMember = async (name = 'Pat Member') => {
  const email = uniqueEmail();
  const res = await request(app).post('/api/auth/signup').send({ fullName: name, email, password: PASSWORD, confirmPassword: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, id: res.body.user.id as string, email };
};

/** An admin-created Team Lead, activated through the real activation endpoint, then signed in. */
const activatedTeamLead = async (admin: Session) => {
  const email = uniqueEmail();
  const created = await as(admin).post(`${TL}/team-leads`, { email, displayName: 'Tara Lead' });
  expect(created.status).toBe(201);
  const { temporaryPassword, activationUrl } = created.body.credentials;
  expect((await activate({ token: tokenFrom(activationUrl), temporaryPassword, newPassword: NEW_PASSWORD })).status).toBe(200);
  const signedIn = await login(email, NEW_PASSWORD);
  expect(signedIn.status).toBe(200);
  return { token: signedIn.body.token as string, id: created.body.teamLead.id as string, email };
};

const createWorkspaceAs = async (u: Session, name: string) => {
  const res = await as(u).post('/api/workspaces', { name });
  expect(res.status).toBe(201);
  return { workspaceId: res.body.workspace.id as string, generalChannelId: res.body.generalChannel.id as string };
};

let collabId: string;
let admin: Session & { id: string };
const EMAIL_SETTINGS = ['BREVO_API_KEY', 'BREVO_FROM_EMAIL'] as const;
let savedSettings: Record<string, string | undefined> = {};
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
  const a = await createAndLoginUser({ role: 'ADMIN' });
  admin = { token: a.token, id: a.user.id };
});
beforeEach(() => {
  savedSettings = Object.fromEntries(EMAIL_SETTINGS.map((name) => [name, process.env[name]]));
  process.env.BREVO_API_KEY = 'test-provider-key';
  process.env.BREVO_FROM_EMAIL = 'no-reply@verified.example';
  vi.mocked(sendAccountInvitationEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendInviteEmail).mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  for (const name of EMAIL_SETTINGS) {
    if (savedSettings[name] === undefined) delete process.env[name];
    else process.env[name] = savedSettings[name];
  }
});
afterAll(() => vi.restoreAllMocks());

describe('Admin — Team Lead creation and lifecycle', () => {
  it('an Admin creates a Team Lead: TEAM_LEAD tier, activation e-mail, no access until activation', async () => {
    const email = uniqueEmail();
    const created = await as(admin).post(`${TL}/team-leads`, { email, displayName: 'Priya Sharma', role: 'ADMIN', tier: 'MEMBER' });
    expect(created.status).toBe(201);
    expect(created.body.delivery).toEqual({ emailSent: true });
    expect(sendAccountInvitationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAccountInvitationEmail).mock.calls[0][0]).toMatchObject({ to: email, role: 'TEAM_LEAD', workspaceName: null });

    const account = await prisma.user.findUniqueOrThrow({ where: { id: created.body.teamLead.id }, select: { role: true, status: true, accountTier: { select: { tier: true } } } });
    expect(account).toEqual({ role: 'USER', status: 'SUSPENDED', accountTier: { tier: 'TEAM_LEAD' } }); // never platform ADMIN
    // The temporary password never works on the sign-in page.
    expect((await login(email, created.body.credentials.temporaryPassword)).status).toBe(401);
  });

  it('activation makes the Team Lead ACTIVE with SmartConnect Collab, and they can create workspaces', async () => {
    const lead = await activatedTeamLead(admin);
    expect((await as(lead).get('/api/me/hierarchy')).body).toEqual({ role: 'TEAM_LEAD', canCreateWorkspaces: true, canProvisionMembers: true });
    expect(await workspaceIds(lead)).toEqual([collabId]);
    await createWorkspaceAs(lead, 'Lead Space');
  });

  it('Members and Team Leads cannot create, promote, deactivate or reactivate Team Leads', async () => {
    const member = await publicMember();
    const lead = await activatedTeamLead(admin);
    const target = await activatedTeamLead(admin);
    for (const actor of [member, lead]) {
      expect((await as(actor).post(`${TL}/team-leads`, { email: uniqueEmail() })).status).toBe(403);
      expect((await as(actor).get(`${TL}/team-leads`)).status).toBe(403);
      expect((await as(actor).post(`${TL}/team-leads/promote`, { userId: member.id })).status).toBe(403);
      expect((await as(actor).post(`${TL}/team-leads/${target.id}/deactivate`)).status).toBe(403);
      expect((await as(actor).post(`${TL}/team-leads/${target.id}/reactivate`)).status).toBe(403);
      // Nor promote anyone to platform Admin.
      expect((await as(actor).patch(`/api/admin/users/${member.id}/role`)).status).toBe(403);
    }
    expect(await prisma.accountTierGrant.findUnique({ where: { userId: member.id } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
  });

  it('duplicate Team Leads are prevented; a self-registered Member can be promoted instead, keeping everything they had', async () => {
    const member = await publicMember('Morgan Self');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, select: { password: true } });

    // Creating a Team Lead for that address: 409, no second account, offered as promotable.
    const duplicate = await as(admin).post(`${TL}/team-leads`, { email: member.email.toUpperCase() });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ existingAccount: true, promotable: true, user: { id: member.id, displayName: 'Morgan Self', status: 'ACTIVE' } });
    expect(await prisma.user.count({ where: { email: { equals: member.email, mode: 'insensitive' } } })).toBe(1);
    expect(await prisma.accountInvitation.count({ where: { userId: member.id } })).toBe(0);
    expect(sendAccountInvitationEmail).not.toHaveBeenCalled();

    const promoted = await as(admin).post(`${TL}/team-leads/promote`, { userId: member.id, tier: 'MEMBER', role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.teamLead).toMatchObject({ id: member.id, status: 'ACTIVE', invitation: null });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id }, select: { password: true, role: true, accountTier: { select: { tier: true, grantedById: true } } } });
    expect(after).toEqual({ password: before.password, role: 'USER', accountTier: { tier: 'TEAM_LEAD', grantedById: admin.id } });
    // Same session, same password, same memberships — now with Team Lead powers.
    expect(await workspaceIds(member)).toEqual([collabId]);
    await createWorkspaceAs(member, 'Promoted Space');
    expect((await login(member.email, PASSWORD)).status).toBe(200);

    // Promoting again, or an admin, a suspended or an unknown account, is refused.
    expect((await as(admin).post(`${TL}/team-leads/promote`, { userId: member.id })).status).toBe(409);
    expect((await as(admin).post(`${TL}/team-leads/promote`, { userId: admin.id })).status).toBe(409);
    const suspended = await publicMember();
    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    expect((await as(admin).post(`${TL}/team-leads/promote`, { userId: suspended.id })).status).toBe(409);
    expect((await as(admin).post(`${TL}/team-leads/promote`, { userId: randomUUID() })).status).toBe(404);
    expect((await as(admin).post(`${TL}/team-leads/promote`, { userId: 'not-a-uuid' })).status).toBe(404);
    const again = await as(admin).post(`${TL}/team-leads`, { email: member.email });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ promotable: false, reason: 'This account is already a Team Lead.' });
  });

  it('deactivating a Team Lead ends their sessions and powers; reactivating restores them with their workspaces intact', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Pausable');

    const deactivated = await as(admin).post(`${TL}/team-leads/${lead.id}/deactivate`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.teamLead.status).toBe('SUSPENDED');
    expect((await as(lead).get('/api/auth/me')).status).toBe(401); // the old session is gone
    expect((await login(lead.email, NEW_PASSWORD)).status).toBe(403);
    expect((await as(admin).post(`${TL}/team-leads/${lead.id}/deactivate`)).status).toBe(409); // already

    const reactivated = await as(admin).post(`${TL}/team-leads/${lead.id}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.teamLead.status).toBe('ACTIVE');
    const back = await login(lead.email, NEW_PASSWORD);
    expect(back.status).toBe(200);
    expect(await workspaceIds({ token: back.body.token })).toEqual([collabId, workspaceId].sort());
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).ownerId).toBe(lead.id);
    expect((await as(admin).post(`${TL}/team-leads/${lead.id}/reactivate`)).status).toBe(409); // already

    // The audit log records both.
    const actions = (await prisma.auditLog.findMany({ where: { targetId: lead.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['DEACTIVATE_TEAM_LEAD', 'REACTIVATE_TEAM_LEAD']));
  });

  it('a Team Lead still awaiting activation cannot be deactivated or reactivated (revoke/reissue instead); Members are not Team Leads', async () => {
    const pending = await as(admin).post(`${TL}/team-leads`, { email: uniqueEmail() });
    const id = pending.body.teamLead.id as string;
    expect((await as(admin).post(`${TL}/team-leads/${id}/reactivate`)).status).toBe(409);
    expect((await as(admin).post(`${TL}/team-leads/${id}/deactivate`)).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('SUSPENDED');
    // It still activates normally afterwards.
    const { temporaryPassword, activationUrl } = pending.body.credentials;
    expect((await activate({ token: tokenFrom(activationUrl), temporaryPassword, newPassword: NEW_PASSWORD })).status).toBe(200);

    const member = await publicMember();
    expect((await as(admin).post(`${TL}/team-leads/${member.id}/deactivate`)).status).toBe(404);
    expect((await as(admin).post(`${TL}/team-leads/${randomUUID()}/reactivate`)).status).toBe(404);
  });
});

describe('Team Lead — workspaces and invitations', () => {
  it('creates SmartUnifolio and invites several people at once: new addresses get Member accounts, existing accounts get invitations', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'SmartUnifolio');
    const existing = await publicMember('Eve Existing');
    const newcomers = [uniqueEmail(), uniqueEmail()];
    vi.mocked(sendAccountInvitationEmail).mockClear(); // the lead's own activation e-mail is not part of this

    for (const email of newcomers) {
      const res = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email, role: 'ADMIN', tier: 'TEAM_LEAD' });
      expect(res.status).toBe(201);
      expect(res.body.delivery).toEqual({ emailSent: true });
    }
    expect(vi.mocked(sendAccountInvitationEmail).mock.calls.map((c) => c[0])).toEqual(
      newcomers.map((to) => expect.objectContaining({ to, role: 'MEMBER', workspaceName: 'SmartUnifolio' }))
    );
    // The existing account: the member-invitations path says so (no second account)…
    const conflict = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: existing.email });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ existingAccount: true });
    // …and it gets a workspace invitation instead (in the app, and by e-mail).
    const invited = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ existingAccount: true, emailSent: true });
    expect(sendInviteEmail).toHaveBeenCalledWith(existing.email.toLowerCase(), expect.any(String), 'SmartUnifolio');
    expect(await prisma.user.count({ where: { email: { in: [...newcomers, existing.email] } } })).toBe(3);
  });

  it('cannot manage another Team Lead\'s workspace, nor promote members to privileged roles', async () => {
    const lead = await activatedTeamLead(admin);
    const other = await activatedTeamLead(admin);
    const { workspaceId: mine } = await createWorkspaceAs(lead, 'Mine');
    const { workspaceId: theirs } = await createWorkspaceAs(other, 'Theirs');
    const member = await publicMember();

    // Another Team Lead's private workspace: no invitations, no provisioning, no settings, no content.
    expect((await as(lead).post(`/api/workspaces/${theirs}/invites`, { email: uniqueEmail() })).status).toBe(403);
    expect((await as(lead).post(`/api/workspaces/${theirs}/member-invitations`, { email: uniqueEmail() })).status).toBe(403);
    expect((await as(lead).get(`/api/workspaces/${theirs}/member-invitations`)).status).toBe(403);
    expect((await as(lead).patch(`/api/workspaces/${theirs}`, { name: 'Hijacked' })).status).toBe(403);
    expect((await as(lead).get(`/api/workspaces/${theirs}/channels`)).status).toBe(403);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: theirs } })).name).toBe('Theirs');

    // In their own workspace, a Member can never be made an admin, and no Team Lead grants tiers.
    await prisma.workspaceMember.create({ data: { userId: member.id, workspaceId: mine, role: 'MEMBER' } });
    expect((await as(lead).patch(`/api/workspaces/${mine}/members/${member.id}`, { role: 'ADMIN' })).status).toBe(403);
    expect((await as(lead).post(`${TL}/team-leads/promote`, { userId: member.id })).status).toBe(403);
    expect((await as(lead).patch(`/api/admin/users/${member.id}/role`)).status).toBe(403);
    expect(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: member.id, workspaceId: mine } }, select: { role: true } })).toEqual({ role: 'MEMBER' });
    expect(await prisma.accountTierGrant.findUnique({ where: { userId: member.id } })).toBeNull();
    // SmartConnect Collab is nobody's to invite into.
    expect((await as(lead).post(`/api/workspaces/${collabId}/invites`, { email: uniqueEmail() })).status).toBe(403);
  });

  it('Members cannot create workspaces or invite anyone', async () => {
    const member = await publicMember();
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Team');
    await prisma.workspaceMember.create({ data: { userId: member.id, workspaceId, role: 'MEMBER' } });
    expect((await as(member).post('/api/workspaces', { name: 'Nope' })).status).toBe(403);
    expect((await as(member).post(`/api/workspaces/${workspaceId}/invites`, { email: uniqueEmail() })).status).toBe(403);
    expect((await as(member).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: uniqueEmail() })).status).toBe(403);
  });
});

describe('Invitations', () => {
  it('a new person: activation makes a MEMBER with Collab and exactly the invited workspace — nothing else', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Invited Here');
    const { workspaceId: unrelated } = await createWorkspaceAs(lead, 'Not Invited Here');
    const email = uniqueEmail();
    const created = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email });
    const { temporaryPassword, activationUrl } = created.body.credentials;
    const token = tokenFrom(activationUrl);

    expect((await activate({ token, temporaryPassword, newPassword: NEW_PASSWORD })).status).toBe(200);
    const session = await login(email, NEW_PASSWORD);
    expect(session.status).toBe(200);
    expect(await workspaceIds({ token: session.body.token })).toEqual([collabId, workspaceId].sort());
    const account = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true, accountTier: true, workspaces: { select: { workspaceId: true, role: true } } } });
    expect(account.role).toBe('USER');
    expect(account.accountTier).toBeNull();
    expect(account.workspaces.every((m) => m.role === 'MEMBER')).toBe(true);
    expect((await as({ token: session.body.token }).get(`/api/workspaces/${unrelated}/channels`)).status).toBe(403);

    // The activation link is single-use.
    expect((await activate({ token, temporaryPassword, newPassword: 'another-passphrase-1' })).status).toBe(410);
  });

  it('an existing account: never a new account, password or role — joins only after accepting, keeping every other membership', async () => {
    const lead = await activatedTeamLead(admin);
    const otherLead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Accept Me');
    const { workspaceId: earlier } = await createWorkspaceAs(otherLead, 'Earlier Team');
    const existing = await publicMember();
    await prisma.workspaceMember.create({ data: { userId: existing.id, workspaceId: earlier, role: 'MEMBER' } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, select: { password: true, role: true, accountTier: true } });

    const invited = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    expect(invited.status).toBe(201);
    // Not a member until they accept.
    expect(await workspaceIds(existing)).toEqual([collabId, earlier].sort());
    const received = await as(existing).get('/api/invitations/received');
    expect(received.body).toEqual([expect.objectContaining({ id: invited.body.id, workspace: { id: workspaceId, name: 'Accept Me' } })]);

    const accepted = await as(existing).post(`/api/invitations/received/${invited.body.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(await workspaceIds(existing)).toEqual([collabId, earlier, workspaceId].sort());
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, select: { password: true, role: true, accountTier: true } });
    expect(after).toEqual(before); // same password hash, same role, still no tier
    expect((await login(existing.email, PASSWORD)).status).toBe(200);
    expect(await prisma.accountInvitation.count({ where: { userId: existing.id } })).toBe(0); // no temporary password, ever
    // Reusing the accepted invitation adds nothing.
    expect((await as(existing).post(`/api/invitations/received/${invited.body.id}/decline`)).status).toBe(400);
    expect((await as(existing).get('/api/invitations/received')).body).toEqual([]);
  });

  it('a declined invitation grants no access and cannot be accepted later', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Declined');
    const existing = await publicMember();
    const invited = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    expect((await as(existing).post(`/api/invitations/received/${invited.body.id}/decline`)).status).toBe(200);
    expect((await as(existing).post(`/api/invitations/received/${invited.body.id}/accept`)).status).toBe(400);
    expect((await as(existing).post(`/api/invitations/accept/${invited.body.token}`)).status).toBe(400);
    expect(await prisma.workspaceMember.count({ where: { userId: existing.id, workspaceId } })).toBe(0);
    expect((await as(existing).get(`/api/workspaces/${workspaceId}/channels`)).status).toBe(403);
  });

  it('expired, revoked and reused tokens are refused (workspace invitations and account activations)', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Tokens');
    const existing = await publicMember();

    // Workspace invitation: expired and revoked.
    const expired = await prisma.invitation.create({ data: { email: existing.email, inviterId: lead.id, workspaceId, createdAt: new Date(Date.now() - 15 * 24 * 3600_000) } });
    expect((await as(existing).post(`/api/invitations/accept/${expired.token}`)).status).toBe(400);
    const revoked = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    expect((await request(app).delete(`/api/workspaces/${workspaceId}/invitations/${revoked.body.id}`).set(authHeader(lead.token))).status).toBe(200);
    expect((await as(existing).post(`/api/invitations/accept/${revoked.body.token}`)).status).toBe(400);
    expect(await prisma.workspaceMember.count({ where: { userId: existing.id, workspaceId } })).toBe(0);
    // Reused: accepted once by its owner, refused for anyone else.
    const fresh = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    expect((await as(existing).post(`/api/invitations/accept/${fresh.body.token}`)).status).toBe(200);
    const stranger = await publicMember();
    expect((await as(stranger).post(`/api/invitations/accept/${fresh.body.token}`)).status).toBe(400);
    expect(await prisma.workspaceMember.count({ where: { userId: stranger.id, workspaceId } })).toBe(0);

    // Account activation: revoked and expired.
    const email = uniqueEmail();
    const created = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email });
    const creds = created.body.credentials;
    expect((await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations/${created.body.invitation.id}/revoke`)).status).toBe(200);
    expect((await activate({ token: tokenFrom(creds.activationUrl), temporaryPassword: creds.temporaryPassword, newPassword: NEW_PASSWORD })).status).toBe(410);
    const reissued = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations/${created.body.invitation.id}/reissue`);
    expect(reissued.status).toBe(201);
    await prisma.accountInvitation.update({ where: { id: reissued.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = reissued.body.credentials;
    expect((await activate({ token: tokenFrom(r.activationUrl), temporaryPassword: r.temporaryPassword, newPassword: NEW_PASSWORD })).status).toBe(410);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('SUSPENDED');
  });

  it('duplicate invitations: one pending invitation per address and workspace; one account per new address', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Dupes');
    const existing = await publicMember();
    const first = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email });
    const second = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email.toUpperCase() });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true, id: first.body.id });
    expect(await prisma.invitation.count({ where: { workspaceId, email: { equals: existing.email, mode: 'insensitive' } } })).toBe(1);

    const email = uniqueEmail();
    expect((await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email })).status).toBe(201);
    const again = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ pendingActivation: true });
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.accountInvitation.count({ where: { user: { email } } })).toBe(1);

    // Already a member: refused, nothing created.
    await as(existing).post(`/api/invitations/accept/${first.body.token}`);
    expect((await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.email })).status).toBe(400);
  });
});

describe('Workspace isolation', () => {
  it('Members see only Collab and the workspaces they belong to; switching never widens access', async () => {
    const lead = await activatedTeamLead(admin);
    const { workspaceId: a, generalChannelId: aGeneral } = await createWorkspaceAs(lead, 'Team A');
    const { workspaceId: b, generalChannelId: bGeneral } = await createWorkspaceAs(lead, 'Team B');
    const member = await publicMember();
    const invited = await as(lead).post(`/api/workspaces/${a}/invites`, { email: member.email });
    expect((await as(member).post(`/api/invitations/received/${invited.body.id}/accept`)).status).toBe(200);

    expect(await workspaceIds(member)).toEqual([collabId, a].sort());
    expect((await as(member).get(`/api/workspaces/${a}/channels`)).status).toBe(200);
    expect((await as(member).get(`/api/workspaces/${b}/channels`)).status).toBe(403);
    expect((await as(member).get(`/api/channels/${aGeneral}/messages`)).status).toBe(200);
    expect((await as(member).get(`/api/channels/${bGeneral}/messages`)).status).toBe(403);
    // Remembering B as the "last active" workspace grants nothing either.
    expect((await as(member).patch('/api/users/me/active-workspace', { workspaceId: b })).status).toBeGreaterThanOrEqual(400);
    expect(await workspaceIds(member)).toEqual([collabId, a].sort());
  });

  it('every public sign-up gets Collab; joining one more workspace never removes earlier memberships', async () => {
    const people = await Promise.all([publicMember('One'), publicMember('Two'), publicMember('Three')]);
    for (const p of people) expect(await workspaceIds(p)).toEqual([collabId]);
    const lead = await activatedTeamLead(admin);
    const { workspaceId } = await createWorkspaceAs(lead, 'Additive');
    const invited = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: people[0].email });
    await as(people[0]).post(`/api/invitations/received/${invited.body.id}/accept`);
    expect(await workspaceIds(people[0])).toEqual([collabId, workspaceId].sort());
    expect(await prisma.workspaceMember.count({ where: { userId: people[0].id, workspaceId: collabId } })).toBe(1);
  });
});

it('no password used above was ever stored in plain text', async () => {
  expect(await prisma.user.count({ where: { password: { in: [PASSWORD, NEW_PASSWORD] } } })).toBe(0);
});
