import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CI regression (stage 6A #8 / 6C #8 failed on GitHub Actions only): simultaneous
 * sign-ups for one invitation — exact case and case variants, direct and OTP —
 * with FEWER pooled database connections than simultaneous requests, as on a
 * small CI runner (Prisma's default pool is 2 × CPUs + 1; 5 on a 2-core runner).
 *
 * Sign-up serializes on a per-address advisory lock; every waiting request
 * holds a pooled connection. The invitation's "inviter still manages this
 * workspace" check ran on the global client — a second connection — while the
 * winner held the lock, so with the pool full of waiters every transaction
 * expired: 500/503 for all. On a developer machine (large pool) it never showed.
 *
 * The app's Prisma client is created for this file with a 3-connection pool;
 * the client other files share is set aside and restored afterwards.
 */
const POOL = 3;
const saved = vi.hoisted(() => {
  const g = globalThis as { prisma?: unknown };
  const before = { client: g.prisma, limit: process.env.DATABASE_CONNECTION_LIMIT };
  delete g.prisma; // lib/prisma creates a fresh client for this file…
  process.env.DATABASE_CONNECTION_LIMIT = '3'; // …with a small pool (unless the URL sets connection_limit itself)
  return before;
});

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { sendOtpEmail } from '../utils/mailer';
import { createWorkspace, TestUser } from './collab-helpers';
import { createTeamLead, uniqueEmail, uniqueUsername } from './helpers';

const PASSWORD = 'Password123!';
const DUPLICATE = /^(A user with this email or username already exists|An account with this email address already exists\.)$/;

const post = (path: string, body: Record<string, unknown>) => request(app).post(path).send(body);
const upper = (email: string) => email.toUpperCase();
const capitalised = (email: string) => `${email[0].toUpperCase()}${email.slice(1)}`;
const upperDomain = (email: string) => email.replace('@example.com', '@EXAMPLE.COM');
const mixed = (email: string) => [...email].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');

let lead: TestUser;
let workspaceId = '';
let collabId = '';
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
  lead = await createTeamLead();
  ({ workspaceId } = await createWorkspace(lead));
});
beforeEach(() => vi.mocked(sendOtpEmail).mockClear());
afterAll(async () => {
  await prisma.$disconnect();
  const g = globalThis as { prisma?: unknown };
  if (saved.client) g.prisma = saved.client;
  else delete g.prisma;
  if (saved.limit === undefined) delete process.env.DATABASE_CONNECTION_LIMIT;
  else process.env.DATABASE_CONNECTION_LIMIT = saved.limit;
});

const invite = async (email: string) =>
  prisma.invitation.create({ data: { email: email.toLowerCase(), inviterId: lead.user.id, workspaceId }, select: { id: true, token: true } });

/**
 * Every invariant after a burst: one 201, every other request the controlled
 * duplicate 400 (never a 500/503 or a database message), exactly one account in
 * any letter case, no account for any losing request, the invitation consumed
 * once, and exactly one membership each in the invited workspace and in Collab.
 */
const expectOneWinner = async (
  label: string,
  email: string,
  invitationId: string,
  burst: { status: number; body: { error?: string; user?: { id: string } } }[],
  loserUsernames: string[]
) => {
  expect(burst.map((r) => r.status).sort(), label).toEqual([201, ...Array(burst.length - 1).fill(400)]);
  for (const res of burst.filter((r) => r.status === 400)) expect(res.body.error, label).toMatch(DUPLICATE);

  const accounts = await prisma.$queryRaw<{ id: string; username: string }[]>`SELECT id, username FROM "User" WHERE lower(email) = lower(${email}::text)`;
  expect(accounts, label).toHaveLength(1);
  const [account] = accounts;
  expect(burst.find((r) => r.status === 201)!.body.user!.id, label).toBe(account.id);
  // No orphaned account from a losing request (each request used its own username).
  expect(await prisma.user.count({ where: { username: { in: loserUsernames.filter((u) => u !== account.username) } } }), label).toBe(0);

  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } })).status, label).toBe('accepted');
  expect(await prisma.workspaceMember.count({ where: { userId: account.id, workspaceId } }), label).toBe(1);
  expect(await prisma.workspaceMember.count({ where: { userId: account.id, workspaceId: collabId } }), label).toBe(1);
};

describe(`simultaneous sign-ups for one invitation with a ${POOL}-connection pool`, () => {
  it('exact case: five identical addresses at once — one account, four controlled 400s', async () => {
    for (let round = 0; round < 2; round += 1) {
      const email = uniqueEmail();
      const invitation = await invite(email);
      const usernames = Array.from({ length: 5 }, () => uniqueUsername());
      const burst = await Promise.all(usernames.map((username) => post('/api/auth/signup', { username, email, password: PASSWORD, inviteToken: invitation.token })));
      await expectOneWinner(`exact, round ${round}`, email, invitation.id, burst, usernames);
    }
  }, 60_000);

  it('case variants: lower, UPPER, Capitalised, upper-case domain and mixed case at once — one account', async () => {
    for (let round = 0; round < 2; round += 1) {
      const email = uniqueEmail();
      const invitation = await invite(email);
      const forms = [email, upper(email), capitalised(email), upperDomain(email), mixed(email)];
      const usernames = forms.map(() => uniqueUsername());
      // The current sign-up form sends a full name (generated username); the legacy one a username. Both race here.
      const burst = await Promise.all(
        forms.map((form, i) =>
          post('/api/auth/signup', i % 2 ? { fullName: `Racer ${i}`, email: form, password: PASSWORD, confirmPassword: PASSWORD, inviteToken: invitation.token } : { username: usernames[i], email: form, password: PASSWORD, inviteToken: invitation.token })
        )
      );
      await expectOneWinner(`variants, round ${round}`, email, invitation.id, burst, usernames.filter((_, i) => i % 2 === 0));
    }
  }, 60_000);

  it('direct and OTP paths in one burst, exact and case variants — one account', async () => {
    for (let round = 0; round < 2; round += 1) {
      const email = uniqueEmail();
      const invitation = await invite(email);
      const otpEmail = upper(email);
      const otpUsername = uniqueUsername();
      expect((await post('/api/auth/signup-request', { username: otpUsername, email: otpEmail, password: PASSWORD, inviteToken: invitation.token })).status).toBe(200);
      const code = vi.mocked(sendOtpEmail).mock.calls.at(-1)![1];
      const usernames = Array.from({ length: 4 }, () => uniqueUsername());
      const forms = [email, email, capitalised(email), upperDomain(email)];
      const burst = await Promise.all([
        ...forms.map((form, i) => post('/api/auth/signup', { username: usernames[i], email: form, password: PASSWORD, inviteToken: invitation.token })),
        post('/api/auth/verify-otp', { email: otpEmail, code, inviteToken: invitation.token }),
      ]);
      await expectOneWinner(`direct+otp, round ${round}`, email, invitation.id, burst, [...usernames, otpUsername]);
    }
  }, 60_000);
});
