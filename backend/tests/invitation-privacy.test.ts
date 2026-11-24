import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { reconcileSharedWorkspace } from '../lib/sharedWorkspace';
import { createWorkspace } from './collab-helpers';
import { authHeader, createAndLoginUser, createTeamLead, withFakeEmailSettings } from './helpers';

/**
 * AUD-PII-1: an invited person's e-mail address never appears in a failure
 * log or in an error answer sent to someone else. Disposable test database
 * only; Brevo is a stub (tests/setup.ts refuses the real API anyway).
 *
 *  - Opening someone else's invitation link: a useful 403 that does not say
 *    who it was sent to (the invitation page shows that to the visitor from
 *    the token lookup; the error is also written to the request log).
 *  - An account-invitation or workspace-invitation e-mail that fails: still
 *    logged and reported to the sender, without the recipient's address, even
 *    when the provider's rejection repeats it.
 */

const tag = () => randomUUID().slice(0, 8);
const as = (u: { token: string }) => ({
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
});
const tokenOf = (inviteLink: string) => new URL(inviteLink).pathname.split('/').pop()!;

/** Everything written through console.log / console.error while `fn` runs, as one string. */
const captureLogs = async (fn: () => Promise<void>) => {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spies = (['log', 'error', 'warn', 'info'] as const).map((level) => vi.spyOn(console, level).mockImplementation(record));
  try {
    await fn();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return lines.join('\n');
};

/** Brevo rejects the message, repeating the recipient's address (in upper case) in its reason. */
const brevoRejects = (address: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'invalid_parameter', message: `Recipient ${address.toUpperCase()} is blocked` }),
    })
  );

beforeAll(async () => {
  // Team Lead provisioning and sign-in touch SmartConnect Collab; don't depend on another file having created it.
  await reconcileSharedWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AUD-PII-1: invitation errors and failure logs do not carry the invited address', () => {
  it('another account opening an invitation link gets a useful 403 without the invited address, in the answer or the log', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Privacy ${tag()}`);
    const invitee = `invitee-${tag()}@example.com`;
    const created = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: invitee });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const token = tokenOf(created.body.inviteLink);
    const intruder = await createAndLoginUser();

    const answers: request.Response[] = [];
    const logs = await captureLogs(async () => {
      answers.push(await as(intruder).post(`/api/invitations/accept/${token}`));
      answers.push(await as(intruder).post(`/api/invitations/decline/${token}`));
    });

    for (const res of answers) {
      expect(res.status).toBe(403);
      // Still says what went wrong and what to do about it.
      expect(res.body.error).toMatch(/sent to a different account/i);
      expect(res.body.error).toMatch(/sign in with the invited e-mail address/i);
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain(invitee);
    }
    expect(logs).toMatch(/\[403\]/); // the refusal is still logged…
    expect(logs.toLowerCase()).not.toContain(invitee); // …without the address
    // Nothing changed hands.
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('pending');
    expect(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: intruder.user.id, workspaceId } } })).toBeNull();
  });

  it('a failed account-invitation e-mail (new Team Lead) is logged and reported without the recipient address', async () => {
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const email = `lead-${tag()}@example.com`;

    let res: request.Response | undefined;
    const logs = await withFakeEmailSettings(() =>
      captureLogs(async () => {
        brevoRejects(email);
        res = await as(admin).post('/api/team-management/team-leads', { email, displayName: 'Priya Lead', teamLabel: 'Design' });
      })
    );

    // The account still exists and its creator is told the e-mail did not go out.
    expect(res!.status, JSON.stringify(res!.body)).toBe(201);
    expect(res!.body.delivery).toEqual({ emailSent: false });
    expect(res!.body.credentials.loginId).toBe(email);
    // The failure is logged, with the provider's reason, but never the address.
    expect(logs).toMatch(/Account invitation e-mail \(TEAM_LEAD\) failed/);
    expect(logs).toMatch(/Brevo API error \(HTTP 400 invalid_parameter\): Recipient \[recipient\] is blocked/);
    expect(logs.toLowerCase()).not.toContain(email);
  });

  it('a failed workspace-invitation e-mail is logged without the invitee address', async () => {
    const lead = await createTeamLead();
    const { workspaceId } = await createWorkspace(lead, `Privacy ${tag()}`);
    const invitee = `invitee-${tag()}@example.com`;

    let res: request.Response | undefined;
    const logs = await withFakeEmailSettings(() =>
      captureLogs(async () => {
        brevoRejects(invitee);
        res = await as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email: invitee });
      })
    );

    // The invitation is saved and the inviter learns the e-mail failed.
    expect(res!.status, JSON.stringify(res!.body)).toBe(201);
    expect(res!.body).toMatchObject({ emailSent: false, message: 'Invitation created but email failed to send' });
    expect(res!.body.emailError).toMatch(/Brevo API error \(HTTP 400 invalid_parameter\)/);
    expect(logs).toMatch(/Email sending failed/);
    expect(logs.toLowerCase()).not.toContain(invitee);
  });
});
