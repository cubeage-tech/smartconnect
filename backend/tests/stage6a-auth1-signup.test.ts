import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { createWorkspace } from './collab-helpers';
import { authHeader, createTeamLead, uniqueEmail, uniqueUsername } from './helpers';

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));
import { sendOtpEmail } from '../utils/mailer';

/**
 * Stage 6A (T.25) — AUTH-1: one e-mail address opens at most one account,
 * whatever its letter case. An invitation matches the invited address in any
 * letter case, so every sign-up path must also treat "Alice@X.com" and
 * "alice@x.com" as the same, existing account — including when several
 * requests race with one invitation. Sign-up is public now (it was
 * invitation-only from T.21): an unusable invitation no longer refuses the
 * sign-up, it just grants nothing beyond SmartConnect Collab.
 * Disposable test database only.
 */
const PASSWORD = 'Password123!';
const DUPLICATE = 'A user with this email or username already exists';
const post = (path: string, body: Record<string, unknown>) => request(app).post(path).send(body);
const signup = (body: Record<string, unknown>) => post('/api/auth/signup', body);

/** Accounts holding this address in any letter case, compared the way PostgreSQL compares it. */
const accountsFor = async (email: string) => {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "User" WHERE lower(email) = lower(${email}::text)`;
  return Number(row.n);
};
const invitationStatus = async (token: string) => (await prisma.invitation.findUniqueOrThrow({ where: { token } })).status;

/** A Team Lead's workspace whose owner issues real pending e-mail invitations. */
const inviter = async () => {
  const owner = await createTeamLead();
  const { workspaceId } = await createWorkspace(owner);
  const invite = async (email: string, extra: Record<string, unknown> = {}) =>
    (await prisma.invitation.create({ data: { email, inviterId: owner.user.id, workspaceId, ...extra } })).token;
  return { owner, workspaceId, invite };
};

/** "test-<uuid>@example.com" → "Test-<UUID>@example.com" etc.: same mailbox, other letter case. */
const variants = (email: string) => {
  const [local, domain] = email.split('@');
  return [email.toUpperCase(), `${local}@${domain.toUpperCase()}`, `${local[0].toUpperCase()}${local.slice(1)}@${domain}`];
};

// Sign-up joins SmartConnect Collab inside the account-creation transaction.
let collabId = '';
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
});
beforeEach(() => vi.mocked(sendOtpEmail).mockClear());

describe('Stage 6A — AUTH-1: one invitation, at most one account', () => {
  it('1. a valid invitation creates exactly one ACTIVE account, stored as typed (login unchanged)', async () => {
    const { invite, workspaceId } = await inviter();
    const email = uniqueEmail();
    const inviteToken = await invite(email);
    const typed = variants(email)[2]; // the invitee types their address with a capital letter
    const res = await signup({ username: uniqueUsername(), email: typed, password: PASSWORD, inviteToken });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(typed);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(account.status).toBe('ACTIVE');
    expect(await accountsFor(email)).toBe(1);
    expect((await post('/api/auth/login', { email: typed, password: PASSWORD })).status).toBe(200);
    // Sign-up through an invitation also accepts it, in the same transaction:
    // the new account joins exactly the invited workspace at once.
    expect(await invitationStatus(inviteToken)).toBe('accepted');
    expect(await prisma.workspaceMember.count({ where: { userId: res.body.user.id, workspaceId } })).toBe(1);
  });

  it('2. letter-case variants of the invited address cannot open a second account', async () => {
    const { invite } = await inviter();
    const email = uniqueEmail();
    const inviteToken = await invite(email);
    expect((await signup({ username: uniqueUsername(), email, password: PASSWORD, inviteToken })).status).toBe(201);
    // A fresh, live invitation for the same address: only the existing account can refuse these.
    const another = await invite(email);
    for (const variant of variants(email)) {
      const res = await signup({ username: uniqueUsername(), email: variant, password: PASSWORD, inviteToken: another });
      expect(res.status, variant).toBe(400);
      expect(res.body.error, variant).toMatch(/already exists/);
      // The invitation the account signed up with was accepted and opens nothing more.
      expect((await signup({ username: uniqueUsername(), email: variant, password: PASSWORD, inviteToken })).status, variant).toBe(400);
    }
    expect(await accountsFor(email)).toBe(1);
  });

  it('3. an existing account in another letter case blocks every sign-up path', async () => {
    const { invite } = await inviter();
    const email = uniqueEmail();
    await prisma.user.create({ data: { email: email.toUpperCase(), username: uniqueUsername(), password: await bcrypt.hash(PASSWORD, 4) } });
    const inviteToken = await invite(email);

    const direct = await signup({ username: uniqueUsername(), email, password: PASSWORD, inviteToken });
    expect(direct.status).toBe(400);
    expect(direct.body.error).toMatch(/already exists/);
    const otp = await post('/api/auth/signup-request', { username: uniqueUsername(), email, password: PASSWORD, inviteToken });
    expect(otp.status).toBe(400);
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(await accountsFor(email)).toBe(1);
  });

  it('4. a consumed invitation opens no second account: reusing it in any letter case is refused as a duplicate', async () => {
    const { invite, workspaceId } = await inviter();
    const email = uniqueEmail();
    const inviteToken = await invite(email);
    const first = await signup({ username: uniqueUsername(), email, password: PASSWORD, inviteToken });
    expect(first.status).toBe(201);
    // Account creation and acceptance are one step now: the token is spent and the workspace joined.
    expect(first.body.invitation.workspaceId).toBe(workspaceId);
    expect(await invitationStatus(inviteToken)).toBe('accepted');

    // The web client's follow-up accept stays harmless for the same account.
    const accepted = await request(app).post(`/api/invitations/accept/${inviteToken}`).set(authHeader(first.body.token));
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspaceId).toBe(workspaceId);
    expect(await invitationStatus(inviteToken)).toBe('accepted');
    for (const address of [email, ...variants(email)]) {
      const res = await signup({ username: uniqueUsername(), email: address, password: PASSWORD, inviteToken });
      expect(res.status, address).toBe(400);
      expect(res.body.error).toBe(DUPLICATE);
    }
    expect(await accountsFor(email)).toBe(1);
  });

  it('5–7. expired, revoked and mismatched invitations grant nothing: the account gets Collab only and the invitation is untouched', async () => {
    const { invite, workspaceId } = await inviter();
    const cases: [string, string, string][] = [];
    for (const [why, extra] of [['expired', { createdAt: new Date(Date.now() - 15 * 24 * 3600_000) }], ['revoked', { status: 'revoked' }]] as const) {
      const email = uniqueEmail();
      cases.push([why, email, await invite(email, extra)]);
    }
    cases.push(['mismatched', uniqueEmail(), await invite(uniqueEmail())]);
    for (const [why, email, inviteToken] of cases) {
      const before = await invitationStatus(inviteToken);
      const res = await signup({ username: uniqueUsername(), email, password: PASSWORD, inviteToken });
      expect(res.status, why).toBe(201);
      expect(res.body.invitation, why).toBeNull();
      expect(res.body.user.lastActiveWorkspaceId, why).toBe(collabId);
      expect(await prisma.workspaceMember.count({ where: { userId: res.body.user.id, workspaceId } }), why).toBe(0);
      expect(await invitationStatus(inviteToken), why).toBe(before);
      expect(await accountsFor(email), why).toBe(1);
    }
  });

  it('8. concurrent sign-ups with one invitation (direct and OTP paths, exact and case variants) create exactly one account', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { invite } = await inviter();
      const email = uniqueEmail();
      const inviteToken = await invite(email);
      // A pending OTP sign-up for one variant, completed in the same burst.
      const otpEmail = variants(email)[0];
      expect((await post('/api/auth/signup-request', { username: uniqueUsername(), email: otpEmail, password: PASSWORD, inviteToken })).status).toBe(200);
      const code = vi.mocked(sendOtpEmail).mock.calls.at(-1)![1];

      const burst = await Promise.all([
        ...[email, email, ...variants(email)].map((address) => signup({ username: uniqueUsername(), email: address, password: PASSWORD, inviteToken })),
        post('/api/auth/verify-otp', { email: otpEmail, code, inviteToken }),
      ]);
      const statuses = burst.map((r) => r.status).sort();
      expect(statuses, `round ${round}`).toEqual([201, 400, 400, 400, 400, 400]);
      for (const res of burst.filter((r) => r.status === 400)) expect(res.body.error).toMatch(/already exists/);
      expect(await accountsFor(email)).toBe(1);
    }
  });

  it('9. a failure while creating the account rolls everything back and leaves the invitation usable', async () => {
    const { invite } = await inviter();
    const email = uniqueEmail();
    const inviteToken = await invite(email);
    const marker = `s6afail_${randomUUID().slice(0, 8)}`;
    // Test database only: fail the transaction AFTER the User row is inserted
    // (when the new account joins SmartConnect Collab), proving the rollback.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s6a_fail_signup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "User" WHERE id = NEW."userId" AND username = '${marker}') THEN
          RAISE EXCEPTION 'simulated failure during account creation';
        END IF;
        RETURN NEW;
      END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER s6a_fail_signup BEFORE INSERT ON "WorkspaceMember" FOR EACH ROW EXECUTE FUNCTION s6a_fail_signup()');
    try {
      const failed = await signup({ username: marker, email, password: PASSWORD, inviteToken });
      expect(failed.status).toBe(500);
      expect(await accountsFor(email)).toBe(0);
      expect(await prisma.user.count({ where: { username: marker } })).toBe(0);
      expect(await invitationStatus(inviteToken)).toBe('pending');

      const retry = await signup({ username: uniqueUsername(), email, password: PASSWORD, inviteToken });
      expect(retry.status).toBe(201);
      expect(await accountsFor(email)).toBe(1);
      expect(await prisma.workspaceMember.count({ where: { userId: retry.body.user.id, workspaceId: collabId } })).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS s6a_fail_signup ON "WorkspaceMember"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS s6a_fail_signup()');
    }
  });

  it('10. the workspace invitation flow is unchanged: sign-up (OTP path, other case) then accept joins the invited workspace', async () => {
    const { invite, workspaceId } = await inviter();
    const email = uniqueEmail();
    const inviteToken = await invite(email);
    const typed = variants(email)[1];
    const username = uniqueUsername();
    expect((await post('/api/auth/signup-request', { username, email: typed, password: PASSWORD, inviteToken })).status).toBe(200);
    const code = vi.mocked(sendOtpEmail).mock.calls[0][1];
    const verified = await post('/api/auth/verify-otp', { email: typed, code, inviteToken });
    expect(verified.status).toBe(201);
    expect(verified.body.user).toMatchObject({ username, email: typed });
    const accepted = await request(app).post(`/api/invitations/accept/${inviteToken}`).set(authHeader(verified.body.token));
    expect(accepted.status).toBe(200);
    expect(await prisma.workspaceMember.count({ where: { userId: verified.body.user.id, workspaceId } })).toBe(1);
  });

  it('11. invitation matching and the account check use one comparison: an address PostgreSQL does not fold to the invited one gets nothing from it', async () => {
    const { invite, workspaceId } = await inviter();
    // JavaScript lower-cases a word-final "Σ" to "ς"; PostgreSQL's lower() gives "σ".
    const local = `sigma${randomUUID().slice(0, 8)}a`;
    const invited = `${local}ς@example.com`;
    const inviteToken = await invite(invited);
    const first = await signup({ username: uniqueUsername(), email: invited, password: PASSWORD, inviteToken });
    expect(first.status).toBe(201);
    const capital = `${local}Σ@example.com`;
    expect(capital.toLowerCase()).toBe(invited); // a JavaScript check alone would call it the same address
    // PostgreSQL (the one definition of "same address") says it is another
    // address, so public sign-up may create it — but the invitation is never
    // applied to it, and it never reaches the invited workspace.
    const second = await signup({ username: uniqueUsername(), email: capital, password: PASSWORD, inviteToken });
    expect(second.status).toBe(201);
    expect(second.body.invitation).toBeNull();
    expect(await prisma.workspaceMember.count({ where: { userId: second.body.user.id, workspaceId } })).toBe(0);
    expect(await prisma.workspaceMember.count({ where: { userId: first.body.user.id, workspaceId } })).toBe(1);
  });
});
