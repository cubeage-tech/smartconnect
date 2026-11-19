import { randomUUID } from 'crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue({ success: true }),
}));
// Live updates are asserted on, not delivered (no Socket.IO server in these tests).
vi.mock('../sockets/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sockets/registry')>();
  return { ...real, emitToRooms: vi.fn() };
});

import { app } from '../app';
import { APP_URL } from '../config/env';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { emitToRooms } from '../sockets/registry';
import { createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser, createTeamLead } from './helpers';

/**
 * Team Lead → invitation → workspace membership, for brand-new and existing
 * accounts (one person, several workspaces). Disposable test database only.
 *
 *  - New people sign up from the invitation link; the sign-up itself accepts
 *    that invitation, so they land in exactly that workspace (plus
 *    SmartConnect Collab) with no second step that could be skipped.
 *  - Existing accounts get an in-app invitation (GET /api/invitations/received)
 *    they accept or decline; nothing is granted by opening a link.
 *  - One pending invitation per workspace and address; tokens are single-use,
 *    expire and can be revoked; only the invited account can act on one.
 */

const tag = () => randomUUID().slice(0, 8);
const DAY = 24 * 60 * 60 * 1000;
const as = (u: { token: string }) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set(authHeader(u.token)).send(b),
  delete: (p: string) => request(app).delete(p).set(authHeader(u.token)),
});
const tokenOf = (inviteLink: string) => new URL(inviteLink).pathname.split('/').pop()!;
const invite = (lead: TestUser, workspaceId: string, email: string) => as(lead).post(`/api/workspaces/${workspaceId}/invites`, { email });
const signUp = (email: string, inviteToken: string) =>
  request(app).post('/api/auth/signup').send({ username: `new_${tag()}`, email, password: 'Invited-password-123!', inviteToken });
const workspaceIdsOf = async (u: { token: string }) => ((await as(u).get('/api/workspaces')).body as { id: string }[]).map((w) => w.id).sort();
const membership = (userId: string, workspaceId: string) =>
  prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { role: true } });

/** A Team Lead with their own workspace. */
const leadWithWorkspace = async () => {
  const lead = await createTeamLead();
  const { workspaceId, generalChannelId } = await createWorkspace(lead, `Team ${tag()}`);
  return { lead, workspaceId, generalChannelId };
};

let collabId: string;
beforeAll(async () => {
  collabId = (await ensureSharedWorkspace()).workspaceId;
});

describe('new people: sign-up through a workspace invitation', () => {
  it('the inviter gets a shareable invitation link; sign-up from it joins exactly that workspace — no separate accept step', async () => {
    const { lead, workspaceId, generalChannelId } = await leadWithWorkspace();
    const unrelated = await leadWithWorkspace();
    const email = `new-${tag()}@example.com`;

    const created = await invite(lead, workspaceId, email);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.existingAccount).toBe(false);
    expect(created.body.inviteLink).toMatch(new RegExp(`^${APP_URL.replace(/[.]/g, '\\.')}/invite/[0-9a-f-]{36}$`));

    const res = await signUp(email, tokenOf(created.body.inviteLink));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invitation).toEqual({ workspaceId, generalChannelId });
    expect(res.body.user.lastActiveWorkspaceId).toBe(workspaceId); // lands in the invited workspace

    const userId = res.body.user.id as string;
    expect(await membership(userId, workspaceId)).toEqual({ role: 'MEMBER' });
    expect(await prisma.channelMember.count({ where: { userId, channelId: generalChannelId } })).toBe(1);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('accepted');

    // SmartConnect Collab and the invited workspace — nothing else.
    expect(await workspaceIdsOf(res.body)).toEqual([collabId, workspaceId].sort());
    expect((await as(res.body).get(`/api/workspaces/${unrelated.workspaceId}/channels`)).status).toBe(403);

    // The web client's follow-up accept call stays harmless (same person, already joined).
    const again = await as(res.body).post(`/api/invitations/accept/${tokenOf(created.body.inviteLink)}`);
    expect(again.status).toBe(200);
    expect(await prisma.workspaceMember.count({ where: { userId, workspaceId } })).toBe(1);
  });

  it('a revoked, expired or other-address invitation grants no workspace (sign-up is public: Collab only)', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();

    const revokedEmail = `revoked-${tag()}@example.com`;
    const revoked = await invite(lead, workspaceId, revokedEmail);
    expect((await as(lead).delete(`/api/workspaces/${workspaceId}/invitations/${revoked.body.id}`)).status).toBe(200);

    const expiredEmail = `expired-${tag()}@example.com`;
    const expired = await invite(lead, workspaceId, expiredEmail);
    await prisma.invitation.update({ where: { id: expired.body.id }, data: { createdAt: new Date(Date.now() - 15 * DAY) } });

    const theirs = await invite(lead, workspaceId, `someone-${tag()}@example.com`);

    for (const [email, link] of [
      [revokedEmail, revoked.body.inviteLink],
      [expiredEmail, expired.body.inviteLink],
      [`intruder-${tag()}@example.com`, theirs.body.inviteLink],
    ] as const) {
      const res = await signUp(email, tokenOf(link));
      expect(res.status, email).toBe(201);
      expect(res.body.invitation, email).toBeNull();
      expect(await workspaceIdsOf(res.body), email).toEqual([collabId]);
    }
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: theirs.body.id } })).status).toBe('pending'); // untouched
  });
});

describe('existing accounts: in-app invitations', () => {
  it('creates no second account, notifies the person live, and lists the invitation only for them — without its token', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const existing = await createAndLoginUser();
    const other = await createAndLoginUser();
    vi.mocked(emitToRooms).mockClear();

    const created = await invite(lead, workspaceId, existing.user.email.toUpperCase()); // any letter case
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.existingAccount).toBe(true);
    expect(await prisma.user.count({ where: { email: { equals: existing.user.email, mode: 'insensitive' } } })).toBe(1);
    expect(emitToRooms).toHaveBeenCalledWith([], [existing.user.id], 'invitations:changed', expect.anything());

    const received = await as(existing).get('/api/invitations/received');
    expect(received.status).toBe(200);
    expect(received.body).toHaveLength(1);
    expect(received.body[0]).toMatchObject({ id: created.body.id, workspace: { id: workspaceId }, inviter: { id: lead.user.id, username: lead.user.username } });
    expect(JSON.stringify(received.body)).not.toContain(tokenOf(created.body.inviteLink));
    expect((await as(other).get('/api/invitations/received')).body).toEqual([]);

    // Being invited (or opening the link) grants nothing until accepted.
    expect((await request(app).get(`/api/invitations/${tokenOf(created.body.inviteLink)}`)).status).toBe(200);
    expect((await as(existing).get(`/api/workspaces/${workspaceId}/channels`)).status).toBe(403);
    expect(await membership(existing.user.id, workspaceId)).toBeNull();
  });

  it('accepting adds exactly that workspace and keeps every other membership; the person switches between all of them', async () => {
    const a = await leadWithWorkspace();
    const b = await leadWithWorkspace();
    const notInvited = await leadWithWorkspace();
    const person = await createAndLoginUser();

    const toA = await invite(a.lead, a.workspaceId, person.user.email);
    const toB = await invite(b.lead, b.workspaceId, person.user.email);
    expect((await as(person).get('/api/invitations/received')).body.map((i: { id: string }) => i.id).sort()).toEqual([toA.body.id, toB.body.id].sort());

    const acceptA = await as(person).post(`/api/invitations/received/${toA.body.id}/accept`);
    expect(acceptA.status, JSON.stringify(acceptA.body)).toBe(200);
    expect(acceptA.body).toEqual({ workspaceId: a.workspaceId, generalChannelId: a.generalChannelId });
    expect(await workspaceIdsOf(person)).toEqual([collabId, a.workspaceId].sort());

    const acceptB = await as(person).post(`/api/invitations/received/${toB.body.id}/accept`);
    expect(acceptB.status, JSON.stringify(acceptB.body)).toBe(200);
    expect(await workspaceIdsOf(person)).toEqual([collabId, a.workspaceId, b.workspaceId].sort());
    expect(await membership(person.user.id, a.workspaceId)).toEqual({ role: 'MEMBER' }); // A kept
    expect(await membership(person.user.id, b.workspaceId)).toEqual({ role: 'MEMBER' });
    expect((await as(person).get('/api/invitations/received')).body).toEqual([]);

    // Switching: every accepted workspace, never one they were not invited to.
    for (const id of [a.workspaceId, b.workspaceId, collabId]) {
      expect((await as(person).patch('/api/users/me/active-workspace', { workspaceId: id })).status, id).toBe(204);
      expect((await as(person).get(`/api/workspaces/${id}/channels`)).status, id).toBe(200);
    }
    expect((await as(person).patch('/api/users/me/active-workspace', { workspaceId: notInvited.workspaceId })).status).toBe(403);
    expect((await as(person).get(`/api/workspaces/${notInvited.workspaceId}/channels`)).status).toBe(403);

    // A repeated accept never duplicates the membership.
    expect((await as(person).post(`/api/invitations/received/${toA.body.id}/accept`)).status).toBe(200);
    expect(await prisma.workspaceMember.count({ where: { userId: person.user.id, workspaceId: a.workspaceId } })).toBe(1);
  });

  it('declining changes no membership, removes it from the list, shows Declined to managers and can never be accepted afterwards', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const person = await createAndLoginUser();
    const created = await invite(lead, workspaceId, person.user.email);

    const declined = await as(person).post(`/api/invitations/received/${created.body.id}/decline`);
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body).toEqual({ id: created.body.id, state: 'declined' });
    expect((await as(person).get('/api/invitations/received')).body).toEqual([]);
    expect(await membership(person.user.id, workspaceId)).toBeNull();
    expect(await workspaceIdsOf(person)).toEqual([collabId]);

    const managerView = (await as(lead).get(`/api/workspaces/${workspaceId}/invitations`)).body.find((i: { id: string }) => i.id === created.body.id);
    expect(managerView.state).toBe('declined');

    expect((await as(person).post(`/api/invitations/received/${created.body.id}/accept`)).status).toBe(400);
    expect((await as(person).post(`/api/invitations/accept/${tokenOf(created.body.inviteLink)}`)).status).toBe(400);
    expect((await as(person).post(`/api/invitations/received/${created.body.id}/decline`)).status).toBe(400);
    expect(await membership(person.user.id, workspaceId)).toBeNull();

    // The Team Lead may invite them again later.
    const again = await invite(lead, workspaceId, person.user.email);
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(created.body.id);
  });

  it('from the invitation link, a signed-in invitee can decline by token', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const person = await createAndLoginUser();
    const created = await invite(lead, workspaceId, person.user.email);
    const res = await as(person).post(`/api/invitations/decline/${tokenOf(created.body.inviteLink)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ id: created.body.id, state: 'declined' });
  });

  it('only the invited account can accept or decline', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const person = await createAndLoginUser();
    const intruder = await createAndLoginUser();
    const created = await invite(lead, workspaceId, person.user.email);
    const token = tokenOf(created.body.inviteLink);

    expect((await as(intruder).post(`/api/invitations/received/${created.body.id}/accept`)).status).toBe(404);
    expect((await as(intruder).post(`/api/invitations/received/${created.body.id}/decline`)).status).toBe(404);
    expect((await as(intruder).post(`/api/invitations/accept/${token}`)).status).toBe(403);
    expect((await as(intruder).post(`/api/invitations/decline/${token}`)).status).toBe(403);
    expect((await as(intruder).post('/api/invitations/received/not-a-uuid/accept')).status).toBe(404);
    expect(await membership(intruder.user.id, workspaceId)).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('pending');
  });

  it('expired and revoked invitations are never listed and cannot be accepted or declined', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const person = await createAndLoginUser();
    const expired = await invite(lead, workspaceId, person.user.email);
    await prisma.invitation.update({ where: { id: expired.body.id }, data: { createdAt: new Date(Date.now() - 15 * DAY) } });
    expect((await as(person).get('/api/invitations/received')).body).toEqual([]);
    expect((await as(person).post(`/api/invitations/received/${expired.body.id}/accept`)).status).toBe(400);
    expect((await as(person).post(`/api/invitations/received/${expired.body.id}/decline`)).status).toBe(400);

    const revoked = await invite(lead, workspaceId, person.user.email); // the expired one is no longer pending
    expect(revoked.status).toBe(201);
    expect((await as(lead).delete(`/api/workspaces/${workspaceId}/invitations/${revoked.body.id}`)).status).toBe(200);
    expect((await as(person).get('/api/invitations/received')).body).toEqual([]);
    expect((await as(person).post(`/api/invitations/received/${revoked.body.id}/accept`)).status).toBe(400);
    expect(await membership(person.user.id, workspaceId)).toBeNull();
  });
});

describe('who may invite, and duplicate invitations', () => {
  it('only a Team Lead who manages the workspace invites into it — not its Members, not another lead, not into SmartConnect Collab', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const otherLead = await createTeamLead();
    const member = await createAndLoginUser();
    const joined = await invite(lead, workspaceId, member.user.email);
    expect((await as(member).post(`/api/invitations/received/${joined.body.id}/accept`)).status).toBe(200);

    const target = `target-${tag()}@example.com`;
    expect((await invite(member, workspaceId, target)).status).toBe(403);
    expect((await invite(otherLead, workspaceId, target)).status).toBe(403);
    expect((await invite(lead, collabId, target)).status).toBe(403);
    expect(await prisma.invitation.count({ where: { email: target } })).toBe(0);
    // An existing member is not invited again.
    expect((await invite(lead, workspaceId, member.user.email)).status).toBe(400);
  });

  it('a second invitation to the same address (any letter case) returns the pending one; concurrent requests create one; after revocation a new one is allowed', async () => {
    const { lead, workspaceId } = await leadWithWorkspace();
    const email = `dup-${tag()}@example.com`;
    const first = await invite(lead, workspaceId, email);
    expect(first.status).toBe(201);

    const second = await invite(lead, workspaceId, email.toUpperCase());
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true, id: first.body.id, inviteLink: first.body.inviteLink });

    const raceEmail = `race-${tag()}@example.com`;
    const raced = await Promise.all([invite(lead, workspaceId, raceEmail), invite(lead, workspaceId, raceEmail.toUpperCase()), invite(lead, workspaceId, raceEmail)]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await prisma.invitation.count({ where: { workspaceId, email: raceEmail, status: 'pending' } })).toBe(1);

    expect((await as(lead).delete(`/api/workspaces/${workspaceId}/invitations/${first.body.id}`)).status).toBe(200);
    const fresh = await invite(lead, workspaceId, email);
    expect(fresh.status).toBe(201);
    expect(fresh.body.id).not.toBe(first.body.id);
  });
});
