import { afterAll, describe, expect, it, vi } from 'vitest';

// A distinct frontend URL (with a trailing slash, as people often paste it), set
// before the app's config is loaded, so the tests prove APP_URL is what the
// backend uses — not a hard-coded localhost.
const configured = vi.hoisted(() => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'https://smartconnect-frontend.example.test/';
  return { previous, origin: 'https://smartconnect-frontend.example.test' };
});

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { APP_URL, TRUST_PROXY } from '../config/env';
import { prisma } from '../lib/prisma';
import { sendResetPasswordEmail } from '../utils/mailer';
import { authHeader, createAndLoginUser, withFakeEmailSettings } from './helpers';

/**
 * Render deployment behaviour over HTTP: CORS origins, trust proxy and the
 * password-reset link. Disposable test database only (forgot-password looks
 * the account up).
 */
afterAll(() => {
  if (configured.previous === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = configured.previous;
});

const preflight = (origin: string) =>
  request(app).options('/api/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');

describe('Render deployment configuration over HTTP', () => {
  it('APP_URL comes from the environment, normalised (no trailing slash)', () => {
    expect(APP_URL).toBe(configured.origin);
  });

  it('CORS: APP_URL and the local dev origins are allowed; any other browser origin is refused', async () => {
    const fromApp = await preflight(configured.origin);
    expect(fromApp.status).toBe(204);
    expect(fromApp.headers['access-control-allow-origin']).toBe(configured.origin);
    expect(fromApp.headers['access-control-allow-credentials']).toBe('true');

    const fromViteDev = await preflight('http://localhost:5174'); // NODE_ENV=test is not production
    expect(fromViteDev.status).toBe(204);
    expect(fromViteDev.headers['access-control-allow-origin']).toBe('http://localhost:5174');

    const fromElsewhere = await preflight('https://evil.example');
    expect(fromElsewhere.status).toBe(403);
    expect(fromElsewhere.headers['access-control-allow-origin']).toBeUndefined();

    // No Origin header (server-to-server, health checks): unaffected.
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  });

  it('trust proxy is off outside production, so X-Forwarded-For cannot spoof the client address', async () => {
    expect(TRUST_PROXY).toBe(false);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('the password-reset link points at the configured frontend', async () => {
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockClear();
    const res = await withFakeEmailSettings(async () => request(app).post('/api/auth/forgot-password').send({ email: user.email }));
    expect(res.status).toBe(200);
    expect(sendResetPasswordEmail).toHaveBeenCalledTimes(1);
    const [to, link] = vi.mocked(sendResetPasswordEmail).mock.calls[0];
    expect(to).toBe(user.email);
    expect(link).toMatch(new RegExp(`^${configured.origin.replace(/[.]/g, '\\.')}/reset-password\\?token=[^&]+&id=${user.id}$`));
    expect(link).not.toContain('localhost');
  });

  // The production report: a Team Lead's activation link opened a 404 page and
  // the temporary password (correctly) did not sign in. The link must point at
  // the configured frontend's /activate page (served by frontend/vercel.json,
  // see frontend/src/routes/staticHosting.test.ts), and the flow must work end
  // to end from exactly the URL the admin hands over.
  it('Team Lead and Member activation links point at the configured frontend, and activation works end to end from them', async () => {
    const activationLink = new RegExp(`^${configured.origin.replace(/[.]/g, '\\.')}/activate#token=[A-Za-z0-9_-]{43}$`);
    const tokenFrom = (url: string) => new URL(url).hash.replace(/^#token=/, '');
    const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
    const activate = (body: object) => request(app).post('/api/account-activation').send(body);
    const tag = randomUUID().slice(0, 8);

    // 1. Company Admin adds a Team Lead: credentials once, link on the live frontend.
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const leadEmail = `lead-${tag}@example.com`;
    const lead = await request(app).post('/api/team-management/team-leads').set(authHeader(admin.token)).send({ email: leadEmail, displayName: 'Hosting Lead' });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    const leadId = lead.body.teamLead.id as string;
    const { loginId, temporaryPassword, activationUrl } = lead.body.credentials;
    expect(loginId).toBe(leadEmail);
    expect(activationUrl).toMatch(activationLink);
    expect(activationUrl).not.toContain('localhost');

    // 2. The temporary password only works through activation, never at sign-in.
    expect((await login(loginId, temporaryPassword)).status).toBe(401);

    // 3. Activation with the link's token and the temporary password sets a permanent password.
    const leadPassword = 'Hosting-lead-permanent-1';
    const activated = await activate({ token: tokenFrom(activationUrl), temporaryPassword, newPassword: leadPassword });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body).toEqual({ activated: true, loginId: leadEmail });
    expect(activated.body.token).toBeUndefined(); // activation issues no session

    // 4. Invitation consumed, account active, Team Lead tier kept, never a platform admin.
    expect(await prisma.accountInvitation.findUniqueOrThrow({ where: { id: lead.body.teamLead.invitation.id }, select: { status: true } })).toEqual({ status: 'ACCEPTED' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: leadId }, select: { status: true, role: true, accountTier: { select: { tier: true } } } }))
      .toEqual({ status: 'ACTIVE', role: 'USER', accountTier: { tier: 'TEAM_LEAD' } });

    // 5. Normal sign-in with the new password; the temporary one stays dead; the link cannot be replayed.
    const signedIn = await login(loginId, leadPassword);
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect((await login(loginId, temporaryPassword)).status).toBe(401);
    expect((await activate({ token: tokenFrom(activationUrl), temporaryPassword, newPassword: `${leadPassword}-again` })).status).toBe(410);

    // 6. The new Team Lead provisions a Member, whose link is on the live frontend too and activates into the lead's workspace.
    const leadAuth = authHeader(signedIn.body.token);
    const workspace = await request(app).post('/api/workspaces').set(leadAuth).send({ name: `Hosting ${tag}` });
    expect(workspace.status, JSON.stringify(workspace.body)).toBe(201);
    const workspaceId = workspace.body.workspace.id as string;
    const member = await request(app).post(`/api/workspaces/${workspaceId}/member-invitations`).set(leadAuth).send({ email: `member-${tag}@example.com`, displayName: 'Hosting Member' });
    expect(member.status, JSON.stringify(member.body)).toBe(201);
    const memberCredentials = member.body.credentials;
    expect(memberCredentials.activationUrl).toMatch(activationLink);
    const memberPassword = 'Hosting-member-permanent-1';
    const memberActivated = await activate({ token: tokenFrom(memberCredentials.activationUrl), temporaryPassword: memberCredentials.temporaryPassword, newPassword: memberPassword });
    expect(memberActivated.status, JSON.stringify(memberActivated.body)).toBe(200);
    expect((await login(memberCredentials.loginId, memberPassword)).status).toBe(200);
    const memberId = member.body.invitation.account.id as string;
    expect(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: memberId, workspaceId } }, select: { role: true } })).toEqual({ role: 'MEMBER' });
    expect(await prisma.accountTierGrant.findUnique({ where: { userId: memberId } })).toBeNull(); // a Member holds no tier
  });
});
