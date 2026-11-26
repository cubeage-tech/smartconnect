import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/mailer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/mailer')>();
  return { ...real, sendMeetingEmail: vi.fn().mockResolvedValue({ sent: true }) };
});

import { app } from '../app';
import { prisma } from '../lib/prisma';
import { reconcileSharedWorkspace } from '../lib/sharedWorkspace';
import { sendMeetingEmail } from '../utils/mailer';
import { addToWorkspace, createDM, createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';
import { collect, nextEvent, useSocketHarness } from './socket-harness';

/**
 * Meeting room access through the REAL call layer (Socket.IO webrtc:join and
 * friends, keyed by the meeting id): who gets in, who is refused and with
 * what message, and who is thrown out when — cancel, removal from the meeting,
 * and losing the workspace while in the room. Plus: a former member gets no
 * notice or e-mail about the workspace's meetings, and a DM cannot be linked.
 * Disposable test database only.
 */

const harness = useSocketHarness();
const HOUR = 60 * 60_000;
const as = (u: { token: string }) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
  delete: (p: string) => request(app).delete(p).set(authHeader(u.token)),
});

let organizer: TestUser;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser; // in the workspace, never invited
let workspaceId: string;

beforeAll(async () => {
  await reconcileSharedWorkspace();
  organizer = await createAndLoginUser();
  [alice, bob, carol] = await Promise.all([createAndLoginUser(), createAndLoginUser(), createAndLoginUser()]);
  ({ workspaceId } = await createWorkspace(organizer, `Rooms ${Date.now()}`));
  for (const u of [alice, bob, carol]) await addToWorkspace(u, workspaceId);
});

/** A meeting that is open now (starts in 2 minutes; the room opens 15 minutes early). */
const openMeeting = async (participants: TestUser[] = [alice, bob], startsInMs = 2 * 60_000) => {
  const res = await as(organizer).post(`/api/workspaces/${workspaceId}/meetings`, {
    title: 'Room check',
    startsAt: new Date(Date.now() + startsInMs).toISOString(),
    endsAt: new Date(Date.now() + startsInMs + HOUR).toISOString(),
    timezone: 'UTC',
    participantIds: participants.map((p) => p.user.id),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.meeting.id as string;
};

const join = async (user: TestUser, meetingId: string) => {
  const conn = await harness.connect(user);
  const joined = nextEvent<{ participants: { userId: string }[] }>(conn.socket, 'webrtc:existing-participants');
  conn.socket.emit('webrtc:join', { channelId: meetingId });
  return { ...conn, joined };
};

const refusal = async (user: TestUser, meetingId: string) => {
  const conn = await harness.connect(user);
  const error = nextEvent<{ message: string }>(conn.socket, 'webrtc:error');
  conn.socket.emit('webrtc:join', { channelId: meetingId });
  return (await error).message;
};

describe('who gets into a meeting room', () => {
  it('invited people meet in the room; the organizer sees them arrive', async () => {
    const id = await openMeeting();
    const org = await join(organizer, id);
    expect((await org.joined).participants).toEqual([]);
    const arrived = nextEvent<{ userId: string }>(org.socket, 'webrtc:peer-joined');
    const a = await join(alice, id);
    expect((await a.joined).participants.map((p) => p.userId)).toEqual([organizer.user.id]);
    expect((await arrived).userId).toBe(alice.user.id);
  });

  it('refuses the uninvited (with the generic message: the id reveals nothing), the declined and the too-early', async () => {
    const id = await openMeeting();
    const org = await join(organizer, id);
    await org.joined;
    const joins = collect(org.socket, 'webrtc:peer-joined', 1500);

    expect(await refusal(carol, id)).toBe('You are not authorized to join this call.');
    const outsider = await createAndLoginUser();
    expect(await refusal(outsider, id)).toBe('You are not authorized to join this call.');

    await as(bob).post(`/api/meetings/${id}/respond`, { response: 'declined' });
    expect(await refusal(bob, id)).toMatch(/declined/);

    const later = await openMeeting([alice], 3 * HOUR);
    expect(await refusal(alice, later)).toMatch(/opens 15 minutes before the start/);

    expect(await joins).toEqual([]); // nobody got in
  });
});

describe('who is put out of a meeting room, and when', () => {
  it('cancelling closes the room for everyone in it', async () => {
    const id = await openMeeting();
    const org = await join(organizer, id);
    await org.joined;
    const a = await join(alice, id);
    await a.joined;
    const closed = nextEvent<{ meetingId: string; reason: string }>(a.socket, 'meeting:room-closed');
    expect((await as(organizer).post(`/api/meetings/${id}/cancel`)).status).toBe(200);
    expect(await closed).toEqual({ meetingId: id, reason: 'The organizer cancelled this meeting.' });
    expect(await refusal(alice, id)).toMatch(/cancelled/);
  });

  it('removing someone from the meeting puts only them out', async () => {
    const id = await openMeeting();
    const org = await join(organizer, id);
    await org.joined;
    const a = await join(alice, id);
    await a.joined;
    const b = await join(bob, id);
    await b.joined;
    const aliceClosed = nextEvent<{ reason: string }>(a.socket, 'meeting:room-closed');
    const left = nextEvent<{ socketId: string }>(org.socket, 'webrtc:peer-left');
    const bobEvents = collect(b.socket, 'meeting:room-closed', 1500);
    expect((await as(organizer).delete(`/api/meetings/${id}/participants/${alice.user.id}`)).status).toBe(200);
    expect((await aliceClosed).reason).toMatch(/removed you/);
    expect((await left).socketId).toBe(a.socket.id);
    expect(await bobEvents).toEqual([]);
  });

  it('losing the workspace while in the room puts them out at once (not only at the next peer pairing)', async () => {
    const leaver = await createAndLoginUser();
    await addToWorkspace(leaver, workspaceId);
    const id = await openMeeting([leaver]);
    const org = await join(organizer, id);
    await org.joined;
    const l = await join(leaver, id);
    await l.joined;
    const left = nextEvent<{ socketId: string }>(org.socket, 'webrtc:peer-left');
    const removed = await as(organizer).delete(`/api/workspaces/${workspaceId}/members/${leaver.user.id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect((await left).socketId).toBe(l.socket.id);
  });
});

describe('former members and channel links', () => {
  it('a former member gets no notice or e-mail about the meeting any more', async () => {
    const former = await createAndLoginUser();
    await addToWorkspace(former, workspaceId);
    const id = await openMeeting([former, alice], 5 * HOUR);
    await prisma.workspaceMember.delete({ where: { userId_workspaceId: { userId: former.user.id, workspaceId } } });
    vi.mocked(sendMeetingEmail).mockClear();
    const res = await as(organizer).post(`/api/meetings/${id}/reschedule`, {
      startsAt: new Date(Date.now() + 6 * HOUR).toISOString(),
      endsAt: new Date(Date.now() + 7 * HOUR).toISOString(),
      timezone: 'UTC',
    });
    expect(res.status).toBe(200);
    const notices = await prisma.workNotification.findMany({ where: { meetingId: id, type: 'meeting_rescheduled' }, select: { userId: true } });
    expect(notices.map((n) => n.userId)).toEqual([alice.user.id]);
    await vi.waitFor(() => expect(vi.mocked(sendMeetingEmail)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendMeetingEmail).mock.calls[0][0].to).toBe(alice.user.email);
  });

  it('a DM or group DM cannot be linked as the meeting channel', async () => {
    const dm = await createDM(organizer, alice, workspaceId);
    const res = await as(organizer).post(`/api/workspaces/${workspaceId}/meetings`, {
      title: 'Linked to a DM',
      startsAt: new Date(Date.now() + HOUR).toISOString(),
      endsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      timezone: 'UTC',
      channelId: dm.id,
    });
    expect(res.status).toBe(400);
  });
});
