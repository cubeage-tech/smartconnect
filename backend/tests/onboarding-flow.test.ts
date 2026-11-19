import bcrypt from 'bcryptjs';
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
import { APP_URL } from '../config/env';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { sendAccountInvitationEmail, sendInviteEmail } from '../utils/mailer';
import { createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser, createTeamLead } from './helpers';

/**
 * Company Admin → Team Lead → Member onboarding, end to end over the API,
 * with an e-mail provider configured (mailer observed, nothing delivered):
 * who gets which e-mail, what it contains, activation, landing workspaces,
 * existing accounts (never a second account, password or temporary
 * password), several workspaces, and the refusals. Disposable test DB only.
 */

const tag = () => randomUUID().slice(0, 8);
const as = (u: { token: string }) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set(authHeader(u.token)).send(b),
});
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const activate = (body: object) => request(app).post('/api/account-activation').send(body);
const tokenFrom = (activationUrl: string) => new URL(activationUrl).hash.replace(/^#token=/, '');
const workspaceIds = async (u: { token: string }) => ((await as(u).get('/api/workspaces')).body as { id: string }[]).map((w) => w.id).sort();
const ACTIVATION_LINK = new RegExp(`^${APP_URL.replace(/[.]/g, '\\.')}/activate#token=[A-Za-z0-9_-]{43}$`);
const INVITE_LINK = new RegExp(`^${APP_URL.replace(/[.]/g, '\\.')}/invite/[0-9a-f-]{36}$`);

let collabId: string;
const EMAIL_SETTINGS = ['BREVO_API_KEY', 'BREVO_FROM_EMAIL'] as const;
let savedSettings: Record<string, string | undefined> = {};
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
});
beforeEach(() => {
  savedSettings = Object.fromEntries(EMAIL_SETTINGS.map((name) => [name, process.env[name]]));
  // "Configured" — the mailer itself is mocked (and tests/setup.ts refuses real Brevo requests).
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

describe('Company Admin → Team Lead → Member onboarding', () => {
  it('runs the whole flow: e-mails, activation, workspaces, existing accounts, switching and refusals', async () => {
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];

    // 1–2. The Company Admin adds a Team Lead; the Team Lead gets the activation e-mail.
    const leadEmail = `lead-${tag()}@example.com`;
    const created = await as(admin).post('/api/team-management/team-leads', { email: leadEmail, displayName: 'Lena Lead' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.delivery).toEqual({ emailSent: true });
    const leadCredentials = created.body.credentials;
    expect(sendAccountInvitationEmail).toHaveBeenCalledTimes(1);
    expect(sendAccountInvitationEmail).toHaveBeenCalledWith({
      to: leadEmail,
      role: 'TEAM_LEAD',
      loginId: leadEmail,
      temporaryPassword: leadCredentials.temporaryPassword,
      activationUrl: leadCredentials.activationUrl,
      expiresAt: expect.any(Date),
      workspaceName: null,
    });
    expect(leadCredentials.activationUrl).toMatch(ACTIVATION_LINK);

    // 3. Activation: temporary password + new password; the temporary one is then dead.
    expect((await login(leadEmail, leadCredentials.temporaryPassword)).status).toBe(401);
    const leadPassword = 'Lena-permanent-pass-1';
    expect((await activate({ token: tokenFrom(leadCredentials.activationUrl), temporaryPassword: leadCredentials.temporaryPassword, newPassword: leadPassword })).status).toBe(200);
    expect((await activate({ token: tokenFrom(leadCredentials.activationUrl), temporaryPassword: leadCredentials.temporaryPassword, newPassword: `${leadPassword}-2` })).status).toBe(410);
    expect((await login(leadEmail, leadCredentials.temporaryPassword)).status).toBe(401);
    const leadId = created.body.teamLead.id as string;
    expect(await prisma.user.findUniqueOrThrow({ where: { id: leadId }, select: { status: true, role: true, accountTier: { select: { tier: true } } } }))
      .toEqual({ status: 'ACTIVE', role: 'USER', accountTier: { tier: 'TEAM_LEAD' } });

    // 4. The Team Lead signs in with the new password and has SmartConnect Collab.
    const leadLogin = await login(leadEmail, leadPassword);
    expect(leadLogin.status).toBe(200);
    const lead = { token: leadLogin.body.token as string };
    expect(await workspaceIds(lead)).toEqual([collabId]);

    // 5. The Team Lead creates SmartUnifolio and owns it; Collab stays.
    const unifolio = await as(lead).post('/api/workspaces', { name: `SmartUnifolio ${tag()}` });
    expect(unifolio.status).toBe(201);
    const unifolioId = unifolio.body.workspace.id as string;
    const unifolioName = unifolio.body.workspace.name as string;
    expect(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: leadId, workspaceId: unifolioId } }, select: { role: true } })).toEqual({ role: 'ADMIN' });
    expect(await workspaceIds(lead)).toEqual([collabId, unifolioId].sort());

    // 6–7. People → Add members: a new address gets a Member account and a workspace-specific activation e-mail.
    vi.mocked(sendAccountInvitationEmail).mockClear();
    const memberEmail = `member-${tag()}@example.com`;
    const member = await as(lead).post(`/api/workspaces/${unifolioId}/member-invitations`, { email: memberEmail });
    expect(member.status, JSON.stringify(member.body)).toBe(201);
    expect(member.body.delivery).toEqual({ emailSent: true });
    expect(sendAccountInvitationEmail).toHaveBeenCalledWith({
      to: memberEmail,
      role: 'MEMBER',
      loginId: memberEmail,
      temporaryPassword: member.body.credentials.temporaryPassword,
      activationUrl: member.body.credentials.activationUrl,
      expiresAt: expect.any(Date),
      workspaceName: unifolioName,
    });

    // 8. The member activates, signs in, and has exactly Collab + SmartUnifolio.
    const memberPassword = 'Mia-permanent-pass-1';
    expect((await activate({ token: tokenFrom(member.body.credentials.activationUrl), temporaryPassword: member.body.credentials.temporaryPassword, newPassword: memberPassword })).status).toBe(200);
    const memberLogin = await login(memberEmail, memberPassword);
    expect(memberLogin.status).toBe(200);
    expect(await workspaceIds(memberLogin.body)).toEqual([collabId, unifolioId].sort());

    // 9. An already-registered account (in Collab + SmartUnifolio) is added to another lead's Project Alpha:
    //    never a second account, a password change or a temporary password — a workspace invitation instead.
    const alphaLead = await createTeamLead();
    const alpha = await createWorkspace(alphaLead, `Project Alpha ${tag()}`);
    const passwordBefore = (await prisma.user.findUniqueOrThrow({ where: { email: memberEmail }, select: { password: true } })).password;
    vi.mocked(sendAccountInvitationEmail).mockClear();
    const provision = await as(alphaLead).post(`/api/workspaces/${alpha.workspaceId}/member-invitations`, { email: memberEmail.toUpperCase() });
    expect(provision.status).toBe(409);
    expect(provision.body.existingAccount).toBe(true);
    expect(provision.body.credentials).toBeUndefined();
    const invited = await as(alphaLead).post(`/api/workspaces/${alpha.workspaceId}/invites`, { email: memberEmail.toUpperCase() });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    expect(invited.body).toMatchObject({ existingAccount: true, emailSent: true });
    expect(invited.body.inviteLink).toMatch(INVITE_LINK);
    expect(sendInviteEmail).toHaveBeenCalledWith(memberEmail, invited.body.inviteLink, expect.stringMatching(/^Project Alpha/));
    expect(sendAccountInvitationEmail).not.toHaveBeenCalled();
    expect(await prisma.user.count({ where: { email: { equals: memberEmail, mode: 'insensitive' } } })).toBe(1);

    // 10. They accept in the app and keep everything they had.
    const received = (await as(memberLogin.body).get('/api/invitations/received')).body as { id: string; workspace: { id: string } }[];
    expect(received.map((r) => r.workspace.id)).toEqual([alpha.workspaceId]);
    expect((await as(memberLogin.body).post(`/api/invitations/received/${received[0].id}/accept`)).status).toBe(200);
    expect(await workspaceIds(memberLogin.body)).toEqual([collabId, unifolioId, alpha.workspaceId].sort());

    // 11. A third invitation is declined: nothing is joined.
    const betaLead = await createTeamLead();
    const beta = await createWorkspace(betaLead, `Project Beta ${tag()}`);
    const toBeta = await as(betaLead).post(`/api/workspaces/${beta.workspaceId}/invites`, { email: memberEmail });
    expect((await as(memberLogin.body).post(`/api/invitations/received/${toBeta.body.id}/decline`)).status).toBe(200);
    expect(await workspaceIds(memberLogin.body)).toEqual([collabId, unifolioId, alpha.workspaceId].sort());

    // 12. Their password never changed; they still sign in with it.
    expect((await prisma.user.findUniqueOrThrow({ where: { email: memberEmail }, select: { password: true } })).password).toBe(passwordBefore);
    expect((await login(memberEmail, memberPassword)).status).toBe(200);

    // 13. Switching between every accepted workspace.
    for (const id of [collabId, unifolioId, alpha.workspaceId]) {
      expect((await as(memberLogin.body).patch('/api/users/me/active-workspace', { workspaceId: id })).status, id).toBe(204);
    }

    // 14. Refusals: the declined and other people's workspaces stay closed; only Company Admins add Team Leads;
    //     only a Team Lead who manages the workspace adds members to it.
    expect((await as(memberLogin.body).get(`/api/workspaces/${beta.workspaceId}/channels`)).status).toBe(403);
    expect((await as(memberLogin.body).patch('/api/users/me/active-workspace', { workspaceId: beta.workspaceId })).status).toBe(403);
    expect((await as(lead).post('/api/team-management/team-leads', { email: `nope-${tag()}@example.com` })).status).toBe(403);
    expect((await as(memberLogin.body).post(`/api/workspaces/${unifolioId}/member-invitations`, { email: `nope-${tag()}@example.com` })).status).toBe(403);
    expect((await as(alphaLead).post(`/api/workspaces/${unifolioId}/member-invitations`, { email: `nope-${tag()}@example.com` })).status).toBe(403);
    expect((await as(alphaLead).post(`/api/workspaces/${unifolioId}/invites`, { email: `nope-${tag()}@example.com` })).status).toBe(403);

    // No temporary password or link token was ever written to the logs.
    const logged = logs.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
    for (const secret of [leadCredentials.temporaryPassword, tokenFrom(leadCredentials.activationUrl), member.body.credentials.temporaryPassword, tokenFrom(member.body.credentials.activationUrl)]) {
      expect(logged).not.toContain(secret);
    }
    logs.forEach((spy) => spy.mockRestore());
  }, 60_000);

  it('15. account invitations: reused, expired and revoked activations are refused; a second add for the same address creates nothing', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Team ${tag()}`);
    const newMember = async () => {
      const res = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: `m-${tag()}@example.com` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body as { invitation: { id: string }; credentials: { activationUrl: string; temporaryPassword: string; loginId: string } };
    };

    const used = await newMember();
    const body = (c: typeof used.credentials, newPassword = 'Fresh-permanent-pass-1') => ({ token: tokenFrom(c.activationUrl), temporaryPassword: c.temporaryPassword, newPassword });
    expect((await activate(body(used.credentials))).status).toBe(200);
    expect((await activate(body(used.credentials, 'Other-permanent-pass-1'))).status).toBe(410); // reused

    const expired = await newMember();
    await prisma.accountInvitation.update({ where: { id: expired.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await activate(body(expired.credentials))).status).toBe(410);

    const revoked = await newMember();
    expect((await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations/${revoked.invitation.id}/revoke`)).status).toBe(200);
    expect((await activate(body(revoked.credentials))).status).toBe(410);

    const pending = await newMember();
    const again = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: pending.credentials.loginId });
    expect(again.status).toBe(409);
    expect(again.body.pendingActivation).toBe(true);
    expect(await prisma.user.count({ where: { email: pending.credentials.loginId } })).toBe(1);
  });
});

describe('e-mail delivery is reported, never assumed', () => {
  it('no e-mail provider: the account and its one-time credentials are still created, and the response says no e-mail was sent', async () => {
    delete process.env.BREVO_API_KEY;
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const res = await as(admin).post('/api/team-management/team-leads', { email: `lead-${tag()}@example.com` });
    expect(res.status).toBe(201);
    expect(res.body.delivery).toEqual({ emailSent: false, emailUnavailable: true });
    expect(res.body.credentials.temporaryPassword).toEqual(expect.any(String)); // still handed to the admin to share
    expect(sendAccountInvitationEmail).not.toHaveBeenCalled();
  });

  it('a failed e-mail is reported (not silent); the account stays activatable with the credentials the creator still holds', async () => {
    vi.mocked(sendAccountInvitationEmail).mockRejectedValueOnce(new Error('provider unavailable'));
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Team ${tag()}`);
    const res = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: `m-${tag()}@example.com` });
    expect(res.status).toBe(201);
    expect(res.body.delivery).toEqual({ emailSent: false });
    const { credentials } = res.body;
    expect((await activate({ token: tokenFrom(credentials.activationUrl), temporaryPassword: credentials.temporaryPassword, newPassword: 'Recovered-pass-123' })).status).toBe(200);
    expect((await login(credentials.loginId, 'Recovered-pass-123')).status).toBe(200);
  });

  it('a reissued invitation is e-mailed with the new credentials', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Team ${tag()}`);
    const first = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: `m-${tag()}@example.com` });
    expect((await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations/${first.body.invitation.id}/revoke`)).status).toBe(200);
    vi.mocked(sendAccountInvitationEmail).mockClear();
    const reissued = await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations/${first.body.invitation.id}/reissue`);
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(201);
    expect(reissued.body.delivery).toEqual({ emailSent: true });
    expect(sendAccountInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ role: 'MEMBER', temporaryPassword: reissued.body.credentials.temporaryPassword }));
    expect(reissued.body.credentials.temporaryPassword).not.toBe(first.body.credentials.temporaryPassword);
  });

  it('Settings → Members → Add people: an existing account gets the same invitation (e-mailed when its login is an address), never a direct add', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Team ${tag()}`);
    const existing = await createAndLoginUser();
    const res = await as(lead).post(`/api/workspaces/${workspaceId}/members`, { userId: existing.user.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ invited: true, duplicate: false, emailSent: true });
    expect(sendInviteEmail).toHaveBeenCalledWith(existing.user.email.toLowerCase(), expect.stringMatching(INVITE_LINK), expect.stringMatching(/^Team /));
    expect(sendAccountInvitationEmail).not.toHaveBeenCalled();
    expect(await prisma.workspaceMember.count({ where: { userId: existing.user.id, workspaceId } })).toBe(0);
    const received = (await as(existing).get('/api/invitations/received')).body as { id: string }[];
    expect(received.map((r) => r.id)).toEqual([res.body.invitationId]);
  });

  it('existing accounts never get a temporary password or a reset, whichever way they are invited', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Team ${tag()}`);
    const existing: TestUser = await createAndLoginUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id }, select: { password: true, status: true } });
    await as(lead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: existing.user.email });
    await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.user.email });
    expect(sendAccountInvitationEmail).not.toHaveBeenCalled();
    expect(await prisma.accountInvitation.count({ where: { userId: existing.user.id } })).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id }, select: { password: true, status: true } })).toEqual(before);
    expect(await bcrypt.compare('Password123!', before.password)).toBe(true);
  });
});

/**
 * The same onboarding through the real mailer and its Brevo transport, with
 * Brevo's HTTP API stubbed (fetch replaced): nothing leaves this machine.
 */
describe('onboarding e-mails go through Brevo', () => {
  const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
  const brevoRequests: { url: string; headers: Record<string, string>; body: { to: { email: string }[]; subject: string; htmlContent: string; textContent?: string } }[] = [];
  let respond: () => Response;
  const accepted = () => new Response(JSON.stringify({ messageId: '<m1@smtp-relay.mailin.fr>' }), { status: 201 });

  beforeEach(async () => {
    const real = await vi.importActual<typeof import('../utils/mailer')>('../utils/mailer');
    vi.mocked(sendAccountInvitationEmail).mockImplementation(real.sendAccountInvitationEmail);
    vi.mocked(sendInviteEmail).mockImplementation(real.sendInviteEmail);
    brevoRequests.length = 0;
    respond = accepted;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        brevoRequests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return respond();
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Admin → Team Lead and Team Lead → Member: Brevo gets each activation e-mail; a Brevo error is reported and the account stays activatable', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];

    // Company Admin → Team Lead.
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const leadEmail = `lead-${tag()}@example.com`;
    const lead = await as(admin).post('/api/team-management/team-leads', { email: leadEmail });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    expect(lead.body.delivery).toEqual({ emailSent: true });
    expect(brevoRequests).toHaveLength(1);
    expect(brevoRequests[0].url).toBe(BREVO_URL);
    expect(brevoRequests[0].headers['api-key']).toBe('test-provider-key');
    expect(brevoRequests[0].body.to).toEqual([{ email: leadEmail }]);
    expect(brevoRequests[0].body.subject).toBe('Activate your SmartConnect Team Lead account');
    expect(brevoRequests[0].body.textContent).toContain(lead.body.credentials.temporaryPassword);
    expect(brevoRequests[0].body.htmlContent).toContain(`href="${lead.body.credentials.activationUrl}"`);

    // Team Lead → Member.
    const teamLead = await createTeamLead();
    const { workspaceId } = await createWorkspace(teamLead, `Team ${tag()}`);
    const memberEmail = `m-${tag()}@example.com`;
    const member = await as(teamLead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: memberEmail });
    expect(member.status, JSON.stringify(member.body)).toBe(201);
    expect(member.body.delivery).toEqual({ emailSent: true });
    expect(brevoRequests).toHaveLength(2);
    expect(brevoRequests[1].body.to).toEqual([{ email: memberEmail }]);
    expect(brevoRequests[1].body.textContent).toContain(member.body.credentials.temporaryPassword);

    // Brevo refuses the next one: reported as not sent; the creator still holds working credentials.
    respond = () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 });
    const failed = await as(teamLead).post(`/api/workspaces/${workspaceId}/member-invitations`, { email: `m-${tag()}@example.com` });
    expect(failed.status).toBe(201);
    expect(failed.body.delivery).toEqual({ emailSent: false });
    const { credentials } = failed.body;
    expect((await activate({ token: tokenFrom(credentials.activationUrl), temporaryPassword: credentials.temporaryPassword, newPassword: 'Recovered-pass-123' })).status).toBe(200);
    expect((await login(credentials.loginId, 'Recovered-pass-123')).status).toBe(200);

    // Nothing secret reached the logs or a response body.
    const logged = logs.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
    expect(logged).toContain('HTTP 401');
    for (const body of [lead.body, member.body, failed.body]) {
      expect(logged).not.toContain(body.credentials.temporaryPassword);
      expect(logged).not.toContain(tokenFrom(body.credentials.activationUrl));
      expect(JSON.stringify(body)).not.toContain('test-provider-key');
    }
    expect(logged).not.toContain('test-provider-key');
  });

  it('Team Lead → existing account: the workspace invitation goes through Brevo, without a password', async () => {
    const teamLead = await createTeamLead();
    const { workspaceId } = await createWorkspace(teamLead, `Team ${tag()}`);
    const existing = await createAndLoginUser();
    const res = await as(teamLead).post(`/api/workspaces/${workspaceId}/invites`, { email: existing.user.email });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(brevoRequests).toHaveLength(1);
    expect(brevoRequests[0].body.to).toEqual([{ email: existing.user.email }]);
    expect(brevoRequests[0].body.htmlContent).toMatch(new RegExp(INVITE_LINK.source.replace(/^\^|\$$/g, '')));
    expect(brevoRequests[0].body.htmlContent).not.toMatch(/password/i);
  });
});
