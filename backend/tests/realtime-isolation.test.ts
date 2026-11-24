import { randomUUID } from 'crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { addToWorkspace, createDM, createWorkspace, seedMessage, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';
import { collect, emitAck, nextEvent, useSocketHarness } from './socket-harness';

/**
 * Production incident 2026-11-23 — cross-user / cross-workspace security
 * matrix for messaging and the People directory, with independent sessions
 * (one login per user, tokens never shared):
 *   A, B — members of workspace W (A owns it); D — another member of W;
 *   C    — not in W (owns workspace W2).
 * Real HTTP + Socket.IO server, real Postgres (a throwaway local database).
 */
const { connect } = useSocketHarness();

const world = async () => {
  const [a, b, c, d] = await Promise.all([createAndLoginUser(), createAndLoginUser(), createAndLoginUser(), createAndLoginUser()]);
  const w = await createWorkspace(a);
  await addToWorkspace(b, w.workspaceId, [w.generalChannelId]);
  await addToWorkspace(d, w.workspaceId, [w.generalChannelId]);
  const w2 = await createWorkspace(c);
  const dm = await createDM(a, b, w.workspaceId);
  return { a, b, c, d, w, w2, dm };
};

const html = (text: string) => `<p>${text}</p>`;
const receivedIn = (events: { channelId?: string }[], channelId: string) => events.filter((e) => e.channelId === channelId);

describe('real-time delivery and isolation (A, B in W; C outside; D in W but not in the DM)', () => {
  it('a channel message reaches A and B live; C (another workspace) receives nothing', async () => {
    const { a, b, c, w } = await world();
    const [connA, connB, connC] = await Promise.all([connect(a), connect(b), connect(c)]);
    expect(connB.channelIds).toContain(w.generalChannelId);
    expect(connC.channelIds).not.toContain(w.generalChannelId);

    const text = `general ${randomUUID()}`;
    const toB = nextEvent<{ channelId: string; content: string }>(connB.socket, 'message:received', (m) => m.content === html(text));
    const toC = collect<{ channelId: string }>(connC.socket, 'message:received', 800);
    const ack = await emitAck(connA.socket, 'message:send', { channelId: w.generalChannelId, content: html(text) });
    expect(ack.ok).toBe(true);
    expect((await toB).channelId).toBe(w.generalChannelId);
    expect(await toC).toEqual([]);
  });

  it('a DM reaches only its two participants — not another member of the workspace, not an outsider', async () => {
    const { a, b, c, d, dm } = await world();
    const [connA, connB, connC, connD] = await Promise.all([connect(a), connect(b), connect(c), connect(d)]);
    expect(connB.channelIds).toContain(dm.id);
    expect(connD.channelIds).not.toContain(dm.id);
    const text = `dm ${randomUUID()}`;
    const toB = nextEvent<{ channelId: string; content: string }>(connB.socket, 'message:received', (m) => m.content === html(text));
    const toD = collect<{ channelId: string }>(connD.socket, 'message:received', 800);
    const toC = collect<{ channelId: string }>(connC.socket, 'message:received', 800);
    expect((await emitAck(connA.socket, 'message:send', { channelId: dm.id, content: html(text) })).ok).toBe(true);
    expect((await toB).channelId).toBe(dm.id);
    expect(receivedIn(await toD, dm.id)).toEqual([]);
    expect(receivedIn(await toC, dm.id)).toEqual([]);
  });

  it('an outsider cannot subscribe to a channel, a DM, a thread or an internal room by naming it', async () => {
    const { a, b, c, w, dm } = await world();
    const [connA, connC] = await Promise.all([connect(a), connect(c)]);
    for (const room of [w.generalChannelId, dm.id, `user:${b.user.id}`, `user:${a.user.id}`, `ws:${w.workspaceId}`]) {
      const res = await emitAck(connC.socket, 'channel:join', room);
      expect(res.ok, `channel:join ${room}`).toBe(false);
    }
    const parent = await emitAck(connA.socket, 'message:send', { channelId: dm.id, content: html('thread parent') });
    expect((await emitAck(connC.socket, 'thread:join', { messageId: parent.message!.id })).ok).toBe(false);

    // …and still receives nothing from any of them.
    const toC = collect<{ channelId?: string }>(connC.socket, 'message:received', 800);
    const typingToC = collect(connC.socket, 'typing:started', 800);
    await emitAck(connA.socket, 'message:send', { channelId: w.generalChannelId, content: html('after the attempts') });
    await emitAck(connA.socket, 'message:send', { channelId: dm.id, content: html('dm after the attempts') });
    connA.socket.emit('typing:start', { channelId: dm.id });
    expect(await toC).toEqual([]);
    expect(await typingToC).toEqual([]);
  });

  it('an outsider cannot post into a channel or DM it does not belong to; nothing is stored', async () => {
    const { c, w, dm } = await world();
    const connC = await connect(c);
    const marker = `intrusion ${randomUUID()}`;
    for (const channelId of [w.generalChannelId, dm.id]) {
      const res = await emitAck(connC.socket, 'message:send', { channelId, content: html(marker) });
      expect(res.ok).toBe(false);
    }
    expect(await prisma.message.count({ where: { content: { contains: marker } } })).toBe(0);
  });

  it('a reconnect restores exactly the authorized subscriptions (a revoked one is not restored)', async () => {
    const { a, b, w, dm } = await world();
    const priv = await prisma.channel.create({
      data: {
        name: `private-${randomUUID().slice(0, 8)}`,
        workspaceId: w.workspaceId,
        createdBy: a.user.id,
        visibility: 'PRIVATE',
        members: { create: [{ userId: a.user.id, role: 'admin' }, { userId: b.user.id, role: 'member' }] },
      },
    });
    const first = await connect(b);
    expect(first.channelIds).toEqual(expect.arrayContaining([w.generalChannelId, dm.id, priv.id]));
    first.socket.disconnect();

    await prisma.channelMember.delete({ where: { userId_channelId: { userId: b.user.id, channelId: priv.id } } });
    const again = await connect(b);
    expect(again.channelIds).toEqual(expect.arrayContaining([w.generalChannelId, dm.id]));
    expect(again.channelIds).not.toContain(priv.id);
    // Every restored subscription is one the database still authorizes.
    const authorized = await prisma.channelMember.findMany({ where: { userId: b.user.id }, select: { channelId: true } });
    expect(again.channelIds.every((id) => authorized.some((m) => m.channelId === id))).toBe(true);

    const connA = await connect(a);
    const toB = collect<{ channelId: string }>(again.socket, 'message:received', 800);
    await emitAck(connA.socket, 'message:send', { channelId: priv.id, content: html('after removal') });
    expect(receivedIn(await toB, priv.id)).toEqual([]);
  });

  it('a retried send (same clientId) is stored and delivered once', async () => {
    const { a, b, w } = await world();
    const [connA, connB] = await Promise.all([connect(a), connect(b)]);
    const clientId = randomUUID();
    const toB = collect<{ clientId?: string }>(connB.socket, 'message:received', 1200);
    const first = await emitAck(connA.socket, 'message:send', { channelId: w.generalChannelId, content: html('once'), clientId });
    const retry = await emitAck(connA.socket, 'message:send', { channelId: w.generalChannelId, content: html('once'), clientId });
    expect(first.ok && retry.ok).toBe(true);
    expect(retry.message!.id).toBe(first.message!.id);
    expect((await toB).filter((m) => m.clientId === clientId)).toHaveLength(1);
    expect(await prisma.message.count({ where: { senderId: a.user.id, clientId } })).toBe(1);
  });
});

describe('message history API (REST) — authorization and pagination', () => {
  it('participants read their conversations; an outsider gets 403; pages never mix conversations', async () => {
    const { a, b, c, d, w, dm } = await world();
    const base = Date.now() - 10 * 60_000;
    for (let i = 0; i < 60; i++) {
      await seedMessage(dm.id, w.workspaceId, i % 2 ? a.user.id : b.user.id, `dm-${i}`, { createdAt: new Date(base + i * 2000) });
      await seedMessage(w.generalChannelId, w.workspaceId, a.user.id, `general-${i}`, { createdAt: new Date(base + i * 2000 + 1000) });
    }

    const seen: { id: string; channelId: string; content: string }[] = [];
    let cursor: string | undefined;
    do {
      const res = await request(app).get(`/api/channels/${dm.id}/messages`).query(cursor ? { cursor } : {}).set(authHeader(b.token));
      expect(res.status).toBe(200);
      seen.push(...res.body.messages);
      cursor = res.body.hasMore ? res.body.nextCursor : undefined;
    } while (cursor);
    expect(seen).toHaveLength(60);
    expect(new Set(seen.map((m) => m.channelId))).toEqual(new Set([dm.id]));
    expect(new Set(seen.map((m) => m.id)).size).toBe(60);

    for (const viewer of [c, d] as TestUser[]) {
      expect((await request(app).get(`/api/channels/${dm.id}/messages`).set(authHeader(viewer.token))).status).toBe(403);
    }
    expect((await request(app).get(`/api/channels/${w.generalChannelId}/messages`).set(authHeader(c.token))).status).toBe(403);
    expect((await request(app).get(`/api/channels/${w.generalChannelId}/search`).query({ q: 'general' }).set(authHeader(c.token))).status).toBe(403);
    expect((await request(app).get(`/api/channels/${dm.id}/pinned`).set(authHeader(c.token))).status).toBe(403);

    // A cursor taken from another conversation is refused, never used as a position in this one.
    const general = await request(app).get(`/api/channels/${w.generalChannelId}/messages`).set(authHeader(a.token));
    const foreign = general.body.messages[0].id as string;
    expect((await request(app).get(`/api/channels/${dm.id}/messages`).query({ cursor: foreign }).set(authHeader(a.token))).status).toBe(400);
    expect((await request(app).get(`/api/channels/${dm.id}/messages`).query({ after: foreign }).set(authHeader(a.token))).status).toBe(400);
  });

  it('a thread of a conversation is not readable by an outsider', async () => {
    const { a, c, w, dm } = await world();
    const parent = await seedMessage(dm.id, w.workspaceId, a.user.id, 'secret parent');
    await seedMessage(dm.id, w.workspaceId, a.user.id, 'secret reply', { parentId: parent.id });
    const res = await request(app).get(`/api/messages/${parent.id}/thread`).set(authHeader(c.token));
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('People directory → profile → conversation', () => {
  it('members load the directory and open profiles; an outsider is refused', async () => {
    const { a, b, c, w } = await world();
    const list = await request(app).get(`/api/workspaces/${w.workspaceId}/members`).set(authHeader(a.token));
    expect(list.status).toBe(200);
    expect(list.body.members.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining([a.user.id, b.user.id]));

    await prisma.userProfile.create({ data: { userId: b.user.id, displayName: 'Bea B', title: 'Engineer', bio: 'Builds things', timezone: 'Asia/Kolkata' } });
    const full = await request(app).get(`/api/workspaces/${w.workspaceId}/members/${b.user.id}`).set(authHeader(a.token));
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ id: b.user.id, displayName: 'Bea B', title: 'Engineer', bio: 'Builds things', timezone: 'Asia/Kolkata' });
    expect(full.body.sharedChannels.map((ch: { id: string }) => ch.id)).toContain(w.generalChannelId);
    // Only what the card shows — no internal profile columns.
    expect(full.body).not.toHaveProperty('avatarAttachmentId');
    expect(full.body).not.toHaveProperty('readReceiptsEnabled');

    // No profile row at all (optional fields missing): still a profile, with nulls.
    const bare = await request(app).get(`/api/workspaces/${w.workspaceId}/members/${a.user.id}`).set(authHeader(b.token));
    expect(bare.status).toBe(200);
    expect(bare.body).toMatchObject({ id: a.user.id, displayName: null, title: null, bio: null, timezone: null, isOwner: true });

    expect((await request(app).get(`/api/workspaces/${w.workspaceId}/members`).set(authHeader(c.token))).status).toBe(403);
    expect((await request(app).get(`/api/workspaces/${w.workspaceId}/members/${b.user.id}`).set(authHeader(c.token))).status).toBe(403);
  });

  it('a profile does not depend on profile columns it does not show (a database missing one keeps working)', async () => {
    // Reproduces the reported failure mode: with UserProfile.avatarAttachmentId
    // absent (e.g. a pending migration), the directory list loaded but every
    // profile answered 500 because the whole profile row was selected.
    // Throwaway test database only; the column is restored in `finally`.
    const { a, b, w } = await world();
    await prisma.userProfile.create({ data: { userId: b.user.id, displayName: 'Bea B', title: 'Engineer' } });
    await prisma.$executeRawUnsafe('ALTER TABLE "UserProfile" RENAME COLUMN "avatarAttachmentId" TO "avatarAttachmentId_hidden"');
    try {
      const list = await request(app).get(`/api/workspaces/${w.workspaceId}/members`).set(authHeader(a.token));
      expect(list.status).toBe(200);
      const res = await request(app).get(`/api/workspaces/${w.workspaceId}/members/${b.user.id}`).set(authHeader(a.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: b.user.id, displayName: 'Bea B', title: 'Engineer' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "UserProfile" RENAME COLUMN "avatarAttachmentId_hidden" TO "avatarAttachmentId"');
    }
  });

  it('invalid and non-member ids get controlled errors', async () => {
    const { a, c, w } = await world();
    const invalid = await request(app).get(`/api/workspaces/${w.workspaceId}/members/not-a-uuid`).set(authHeader(a.token));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBeTruthy();
    const outsider = await request(app).get(`/api/workspaces/${w.workspaceId}/members/${c.user.id}`).set(authHeader(a.token));
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual({ error: 'This person is not a member of this workspace.' });
    const unknown = await request(app).get(`/api/workspaces/${w.workspaceId}/members/${randomUUID()}`).set(authHeader(a.token));
    expect(unknown.status).toBe(404);
  });

  it('Message opens the existing DM, creates one when there is none, and concurrent opens create exactly one', async () => {
    const { a, b, d, w, dm } = await world();
    const reopen = await request(app).post('/api/channels/dm').set(authHeader(a.token)).send({ targetUserId: b.user.id, workspaceId: w.workspaceId });
    expect(reopen.status).toBe(200);
    expect(reopen.body.id).toBe(dm.id);
    const fromOtherSide = await request(app).post('/api/channels/dm').set(authHeader(b.token)).send({ targetUserId: a.user.id, workspaceId: w.workspaceId });
    expect(fromOtherSide.body.id).toBe(dm.id);

    // No DM between B and D yet: five simultaneous opens from both sides.
    const opens = await Promise.all([
      ...Array.from({ length: 3 }, () => request(app).post('/api/channels/dm').set(authHeader(b.token)).send({ targetUserId: d.user.id, workspaceId: w.workspaceId })),
      ...Array.from({ length: 2 }, () => request(app).post('/api/channels/dm').set(authHeader(d.token)).send({ targetUserId: b.user.id, workspaceId: w.workspaceId })),
    ]);
    expect(opens.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(opens.map((r) => r.body.id)).size).toBe(1);
    const rows = await prisma.channel.count({
      where: { workspaceId: w.workspaceId, isDM: true, isGroupDM: false, AND: [{ members: { some: { userId: b.user.id } } }, { members: { some: { userId: d.user.id } } }] },
    });
    expect(rows).toBe(1);
  });

  it('a DM cannot be opened with someone outside the workspace, with oneself, or with an invalid id', async () => {
    const { a, c, w } = await world();
    const outside = await request(app).post('/api/channels/dm').set(authHeader(a.token)).send({ targetUserId: c.user.id, workspaceId: w.workspaceId });
    expect(outside.status).toBe(403);
    const self = await request(app).post('/api/channels/dm').set(authHeader(a.token)).send({ targetUserId: a.user.id, workspaceId: w.workspaceId });
    expect(self.status).toBe(400);
    const invalid = await request(app).post('/api/channels/dm').set(authHeader(a.token)).send({ targetUserId: 'nope', workspaceId: w.workspaceId });
    expect(invalid.status).toBe(400);
    // C cannot open a DM inside W either (not a member).
    const intruder = await request(app).post('/api/channels/dm').set(authHeader(c.token)).send({ targetUserId: a.user.id, workspaceId: w.workspaceId });
    expect(intruder.status).toBe(403);
  });
});
