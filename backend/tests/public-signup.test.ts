import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace, SHARED_CHANNELS } from '../lib/sharedWorkspace';
import { createWorkspace } from './collab-helpers';
import { authHeader, createAndLoginUser, createTeamLead, uniqueEmail, uniqueUsername } from './helpers';

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
  sendAccountInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));
import { sendOtpEmail } from '../utils/mailer';

/**
 * Public sign-up (replaces the T.21 invitation-only rule). Anyone can register
 * with full name, e-mail and password; every self-registered account is a
 * plain MEMBER of SmartConnect Collab, whatever the request body claims. An
 * e-mail invitation token is optional: a still-acceptable one also joins its
 * workspace, any other grants nothing extra. Disposable test DB only.
 */
const PASSWORD = 'Password123!';
const signup = (body: Record<string, unknown>, path = '/api/auth/signup') => request(app).post(path).send(body);
const newSignup = (extra: Record<string, unknown> = {}) =>
  signup({ fullName: 'Nadia Khan', email: uniqueEmail(), password: PASSWORD, confirmPassword: PASSWORD, ...extra });
const originalEnv = process.env.NODE_ENV;

let collabId: string;
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
});
beforeEach(() => vi.mocked(sendOtpEmail).mockClear());
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

/** Every fact that makes an account "a plain Member of SmartConnect Collab". */
const expectPlainCollabMember = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, status: true, accountTier: true, workspaces: { select: { workspaceId: true, role: true } } },
  });
  expect(user.role).toBe('USER');
  expect(user.status).toBe('ACTIVE');
  expect(user.accountTier).toBeNull(); // no grant = MEMBER tier
  expect(user.workspaces).toContainEqual({ workspaceId: collabId, role: 'MEMBER' });
  expect(user.workspaces.every((m) => m.role === 'MEMBER')).toBe(true);
  const channels = await prisma.channelMember.findMany({ where: { userId, channel: { workspaceId: collabId } }, select: { channel: { select: { name: true } } } });
  expect(channels.map((c) => c.channel.name).sort()).toEqual(SHARED_CHANNELS.map((c) => c.name).sort());
  return user;
};

/** A Team Lead's private workspace whose owner can issue real pending invitations. */
const inviter = async () => {
  const owner = await createTeamLead();
  const { workspaceId, generalChannelId } = await createWorkspace(owner);
  const invite = async (email: string, extra: Record<string, unknown> = {}) =>
    (await prisma.invitation.create({ data: { email: email.trim().toLowerCase(), inviterId: owner.user.id, workspaceId, ...extra } })).token;
  return { owner, workspaceId, generalChannelId, invite };
};

describe('public sign-up', () => {
  it('creates a plain MEMBER of SmartConnect Collab, signs them in and lands them in Collab', async () => {
    const email = uniqueEmail();
    const res = await signup({ fullName: '  Nadia   Khan ', email, password: PASSWORD, confirmPassword: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: 'USER', lastActiveWorkspaceId: collabId });
    expect(res.body.invitation).toBeNull();
    // Derived from the name: nadia.khan, nadia.khan2 … nadia.khan20, then a random suffix.
    expect(res.body.user.username).toMatch(/^nadia\.khan(\d+|\.[0-9a-f]{6})?$/);

    // The session works straight away and lands in Collab.
    const me = await request(app).get('/api/auth/me').set(authHeader(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.lastActiveWorkspaceId).toBe(collabId);
    const workspaces = await request(app).get('/api/workspaces').set(authHeader(res.body.token));
    expect((workspaces.body as { id: string }[]).map((w) => w.id)).toEqual([collabId]);
    const hierarchy = await request(app).get('/api/me/hierarchy').set(authHeader(res.body.token));
    expect(hierarchy.body).toEqual({ role: 'MEMBER', canCreateWorkspaces: false, canProvisionMembers: false });

    await expectPlainCollabMember(res.body.user.id);
    const profile = await prisma.userProfile.findUnique({ where: { userId: res.body.user.id } });
    expect(profile?.displayName).toBe('Nadia Khan'); // trimmed, inner whitespace collapsed
  });

  it('hashes the password (bcrypt), and the person signs in with it', async () => {
    const email = uniqueEmail();
    const res = await newSignup({ email });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id }, select: { password: true } });
    expect(stored.password).not.toContain(PASSWORD);
    expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(PASSWORD, stored.password)).toBe(true);
    expect((await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  });

  it('gives two people with the same name their own accounts (the full name is not the username)', async () => {
    const a = await newSignup({ fullName: 'Sam Lee' });
    const b = await newSignup({ fullName: 'Sam Lee' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.user.username).not.toBe(b.body.user.username);
  });

  it('rejects a duplicate e-mail address in any letter case and creates nothing', async () => {
    const email = uniqueEmail();
    expect((await newSignup({ email })).status).toBe(201);
    for (const variant of [email, email.toUpperCase()]) {
      const res = await newSignup({ email: variant, fullName: 'Someone Else' });
      expect(res.status, variant).toBe(400);
      expect(res.body).toEqual({ error: 'An account with this email address already exists.' });
    }
    expect(await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })).toBe(1);
  });

  it('rejects invalid input with a clear message and creates nothing', async () => {
    const email = uniqueEmail();
    const cases: [Record<string, unknown>, string][] = [
      [{ fullName: '', email, password: PASSWORD }, 'Full name, email and password are required.'],
      [{ fullName: 'Nadia', email: '', password: PASSWORD }, 'Full name, email and password are required.'],
      [{ fullName: 'Nadia', email, password: '' }, 'Full name, email and password are required.'],
      [{ email, password: PASSWORD }, 'Full name, email and password are required.'],
      [{ fullName: '   ', email, password: PASSWORD }, 'Enter your full name.'],
      [{ fullName: ['Nadia'], email, password: PASSWORD }, 'Enter your full name.'],
      [{ fullName: 'N'.repeat(81), email, password: PASSWORD }, 'Full name must be at most 80 characters.'],
      [{ fullName: 'Nadia\u0000Khan', email, password: PASSWORD }, 'Full name contains characters that are not allowed.'],
      [{ fullName: 'Nadia', email: 'not-an-email', password: PASSWORD }, 'Invalid email format'],
      [{ fullName: 'Nadia', email: { $ne: null }, password: PASSWORD }, 'Invalid email format'],
      [{ fullName: 'Nadia', email, password: '12345' }, 'Password must be at least 6 characters long.'],
      [{ fullName: 'Nadia', email, password: 'x'.repeat(73) }, 'Password must be at most 72 bytes long.'],
      [{ fullName: 'Nadia', email, password: PASSWORD, confirmPassword: 'Password123?' }, 'Passwords do not match.'],
    ];
    for (const [body, error] of cases) {
      const res = await signup(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body).toEqual({ error });
    }
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('ignores every privilege a sign-up body claims: role, tier, status, ownership, workspace roles', async () => {
    const { workspaceId } = await inviter();
    const res = await newSignup({
      role: 'ADMIN',
      tier: 'TEAM_LEAD',
      accountTier: { tier: 'TEAM_LEAD' },
      hierarchyRole: 'COMPANY_ADMIN',
      status: 'BANNED',
      isAdmin: true,
      workspaceId,
      workspaceRole: 'ADMIN',
      ownerId: 'me',
      permissions: ['workspace.manageInvitations'],
      lastActiveWorkspaceId: workspaceId,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
    const user = await expectPlainCollabMember(res.body.user.id);
    expect(user.workspaces.map((m) => m.workspaceId)).toEqual([collabId]); // never the named private workspace

    // …and the server treats it as a Member everywhere it matters.
    const auth = authHeader(res.body.token);
    expect((await request(app).post('/api/workspaces').set(auth).send({ name: 'Mine' })).status).toBe(403);
    expect((await request(app).get('/api/team-management/team-leads').set(auth)).status).toBe(403);
    expect((await request(app).post('/api/team-management/team-leads').set(auth).send({ email: uniqueEmail() })).status).toBe(403);
    expect((await request(app).post('/api/team-management/team-leads/promote').set(auth).send({ userId: res.body.user.id })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/users/${res.body.user.id}/role`).set(auth)).status).toBe(403);
    expect((await request(app).get(`/api/workspaces/${workspaceId}/channels`).set(auth)).status).toBe(403);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id }, select: { role: true } })).toEqual({ role: 'USER' });
    expect(await prisma.accountTierGrant.findUnique({ where: { userId: res.body.user.id } })).toBeNull();
  });

  it('still accepts the legacy { username } shape, validated exactly as before', async () => {
    const username = uniqueUsername();
    const res = await signup({ username, email: uniqueEmail(), password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    await expectPlainCollabMember(res.body.user.id);
    expect((await signup({ username: '', email: '', password: '' })).body).toEqual({ error: 'username, email and password are required' });
    expect((await signup({ username, email: uniqueEmail(), password: PASSWORD })).body).toEqual({ error: 'A user with this email or username already exists' });
  });

  it('rate-limits sign-up attempts per client', async () => {
    process.env.NODE_ENV = 'development';
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await signup({ fullName: 'Rate Limit', email: 'not-an-email', password: PASSWORD })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('public sign-up with an e-mail invitation link', () => {
  it('a valid invitation also joins exactly that workspace (any letter case), lands there, and is consumed', async () => {
    const { workspaceId, owner } = await inviter();
    const email = uniqueEmail();
    // Issued through the real API, exactly as the Invitations panel does.
    const issued = await request(app).post(`/api/workspaces/${workspaceId}/invites`).set(authHeader(owner.token)).send({ email });
    expect(issued.status).toBe(201);
    const inviteToken = issued.body.token as string;

    const res = await newSignup({ email: email.toUpperCase(), inviteToken });
    expect(res.status).toBe(201);
    expect(res.body.user.lastActiveWorkspaceId).toBe(workspaceId);
    expect(res.body.invitation).toMatchObject({ workspaceId });
    const memberships = await prisma.workspaceMember.findMany({ where: { userId: res.body.user.id }, select: { workspaceId: true, role: true } });
    expect(memberships.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))).toEqual(
      [{ workspaceId: collabId, role: 'MEMBER' }, { workspaceId, role: 'MEMBER' }].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
    );
    expect((await prisma.invitation.findUniqueOrThrow({ where: { token: inviteToken } })).status).toBe('accepted');
    // Confirming from the link afterwards is a harmless no-op for the same person.
    const accepted = await request(app).post(`/api/invitations/accept/${inviteToken}`).set(authHeader(res.body.token));
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspaceId).toBe(workspaceId);

    // A used invitation grants nothing to anyone else (they still get Collab).
    const other = await newSignup({ inviteToken });
    expect(other.status).toBe(201);
    expect(other.body.invitation).toBeNull();
    expect(await prisma.workspaceMember.count({ where: { userId: other.body.user.id, workspaceId } })).toBe(0);
  });

  it('an unusable invitation (unknown, malformed, other address, expired, revoked, declined, used, orphaned) grants nothing beyond Collab', async () => {
    const { workspaceId, invite } = await inviter();
    // An inviter who has since lost the right to invite (demoted workspace admin).
    const formerAdmin = await createTeamLead();
    await prisma.workspaceMember.create({ data: { userId: formerAdmin.user.id, workspaceId, role: 'ADMIN' } });
    const orphanedFor = uniqueEmail();
    const orphaned = (await prisma.invitation.create({ data: { email: orphanedFor, inviterId: formerAdmin.user.id, workspaceId } })).token;
    await prisma.workspaceMember.update({ where: { userId_workspaceId: { userId: formerAdmin.user.id, workspaceId } }, data: { role: 'MEMBER' } });

    const cases: [string, unknown][] = [];
    const add = (email: string, token: unknown) => cases.push([email, token]);
    add(uniqueEmail(), randomUUID());
    add(uniqueEmail(), 'not-a-uuid');
    add(uniqueEmail(), ['x']);
    add(uniqueEmail(), await invite(uniqueEmail())); // valid, but for a different address
    for (const extra of [{ createdAt: new Date(Date.now() - 15 * 24 * 3600_000) }, { status: 'revoked' }, { status: 'declined' }, { status: 'accepted' }]) {
      const email = uniqueEmail();
      add(email, await invite(email, extra));
    }
    add(orphanedFor, orphaned);

    for (const [email, inviteToken] of cases) {
      const res = await newSignup({ email, inviteToken });
      expect(res.status, JSON.stringify(inviteToken)).toBe(201);
      expect(res.body.invitation).toBeNull();
      expect(res.body.user.lastActiveWorkspaceId).toBe(collabId);
      const user = await expectPlainCollabMember(res.body.user.id);
      expect(user.workspaces.map((m) => m.workspaceId)).toEqual([collabId]);
    }
  });

  it('the OTP (verified e-mail) path is public too, joins Collab, and honours an invitation the same way', async () => {
    const { workspaceId, invite } = await inviter();
    const plainEmail = uniqueEmail();
    expect((await signup({ username: uniqueUsername(), email: plainEmail, password: PASSWORD }, '/api/auth/signup-request')).status).toBe(200);
    const plainCode = vi.mocked(sendOtpEmail).mock.calls[0][1];
    const plain = await signup({ email: plainEmail, code: plainCode }, '/api/auth/verify-otp');
    expect(plain.status).toBe(201);
    await expectPlainCollabMember(plain.body.user.id);

    const email = uniqueEmail();
    const inviteToken = await invite(email);
    const username = uniqueUsername();
    expect((await signup({ username, email, password: PASSWORD }, '/api/auth/signup-request')).status).toBe(200);
    const code = vi.mocked(sendOtpEmail).mock.calls[1][1];
    const verified = await signup({ email, code, inviteToken }, '/api/auth/verify-otp');
    expect(verified.status).toBe(201);
    expect(verified.body.user).toMatchObject({ username, email, lastActiveWorkspaceId: workspaceId });
    expect(await prisma.workspaceMember.count({ where: { userId: verified.body.user.id, workspaceId } })).toBe(1);
  });

  it('leaves login, the Company Admin and admin Create User unchanged', async () => {
    const existing = await createAndLoginUser();
    expect((await request(app).post('/api/auth/login').send({ email: existing.user.email, password: PASSWORD })).status).toBe(200);
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const t = randomUUID().slice(0, 8);
    const created = await request(app).post('/api/admin/users').set(authHeader(admin.token)).send({ username: `inv_${t}`, loginId: `inv_${t}@example.com`, password: `pass-${t}` });
    expect(created.status).toBe(201);
    expect((await request(app).post('/api/auth/login').send({ email: `inv_${t}@example.com`, password: `pass-${t}` })).status).toBe(200);
  });
});

describe('public sign-up joins the EXISTING SmartConnect Collab (regression: new Members were offered "Create a workspace")', () => {
  it('creates no workspace and no channel, and never a second membership', async () => {
    const before = {
      workspaces: await prisma.workspace.count(),
      sharedWorkspaces: await prisma.workspace.count({ where: { isDefault: true } }),
      collabChannels: await prisma.channel.count({ where: { workspaceId: collabId } }),
    };
    const res = await newSignup();
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
    expect(res.body.user.lastActiveWorkspaceId).toBe(collabId);
    expect(await prisma.workspace.count()).toBe(before.workspaces);
    expect(await prisma.workspace.count({ where: { isDefault: true } })).toBe(before.sharedWorkspaces);
    expect(await prisma.channel.count({ where: { workspaceId: collabId } })).toBe(before.collabChannels);
    expect(await prisma.workspaceMember.count({ where: { userId: res.body.user.id } })).toBe(1);
    expect(await prisma.channelMember.count({ where: { userId: res.body.user.id } })).toBe(SHARED_CHANNELS.length);

    // Loading the workspace list (what the web app does next) adds nothing either, and lists Collab.
    const listed = await request(app).get('/api/workspaces').set(authHeader(res.body.token));
    expect(listed.body).toEqual([expect.objectContaining({ id: collabId, isDefault: true, myRole: 'MEMBER' })]);
    expect(await prisma.workspaceMember.count({ where: { userId: res.body.user.id } })).toBe(1);
    expect(await prisma.channelMember.count({ where: { userId: res.body.user.id } })).toBe(SHARED_CHANNELS.length);
  });

  it('a missing SmartConnect Collab is a configuration error: 503, no account and nothing created, on both sign-up paths', async () => {
    const email = uniqueEmail();
    const otpEmail = uniqueEmail();
    const workspacesBefore = await prisma.workspace.count();
    expect((await signup({ username: uniqueUsername(), email: otpEmail, password: PASSWORD }, '/api/auth/signup-request')).status).toBe(200);
    const code = vi.mocked(sendOtpEmail).mock.calls[0][1];
    // Test database only: hide Collab by clearing its flag; always restored below.
    await prisma.workspace.update({ where: { id: collabId }, data: { isDefault: false } });
    try {
      const res = await newSignup({ email });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/SmartConnect Collab workspace is not set up/);
      const verified = await signup({ email: otpEmail, code }, '/api/auth/verify-otp');
      expect(verified.status).toBe(503);
      expect(await prisma.user.count({ where: { email: { in: [email, otpEmail] } } })).toBe(0);
      expect(await prisma.workspace.count()).toBe(workspacesBefore); // never "repaired" by creating another one
      expect(await prisma.oTPVerification.count({ where: { email: otpEmail } })).toBe(1); // still completable later
    } finally {
      await prisma.workspace.update({ where: { id: collabId }, data: { isDefault: true } });
    }
    // Once Collab is back, the same people sign up normally and land in it.
    const retried = await newSignup({ email });
    expect(retried.status).toBe(201);
    expect(retried.body.user.lastActiveWorkspaceId).toBe(collabId);
    expect((await signup({ email: otpEmail, code }, '/api/auth/verify-otp')).status).toBe(201);
  });

  it('only Team Leads and Admins can create workspaces — a new Member cannot', async () => {
    const member = await newSignup();
    expect((await request(app).post('/api/workspaces').set(authHeader(member.body.token)).send({ name: 'Not allowed' })).status).toBe(403);
    expect((await request(app).get('/api/me/hierarchy').set(authHeader(member.body.token))).body.canCreateWorkspaces).toBe(false);
    const lead = await createTeamLead();
    expect((await request(app).post('/api/workspaces').set(authHeader(lead.token)).send({ name: 'Lead project' })).status).toBe(201);
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const adminWs = await request(app).post('/api/workspaces').set(authHeader(admin.token)).send({ name: 'Admin project' });
    expect(adminWs.status).toBe(201);
    expect((await request(app).patch(`/api/workspaces/${adminWs.body.workspace.id}`).set(authHeader(admin.token)).send({ name: 'Admin project 2' })).status).toBe(200);
  });
});
