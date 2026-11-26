import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Meeting e-mails are asserted on, never sent (the rest of the mailer is real).
vi.mock('../utils/mailer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/mailer')>();
  return { ...real, sendMeetingEmail: vi.fn().mockResolvedValue({ sent: true }) };
});

import { app } from '../app';
import { prisma } from '../lib/prisma';
import { reconcileSharedWorkspace } from '../lib/sharedWorkspace';
import { JOIN_EARLY_MS, JOIN_LATE_MS, meetingRoomAccess } from '../modules/meetings/meetings.service';
import { formatMeetingTime, sendMeetingEmail } from '../utils/mailer';
import { addToWorkspace, createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/**
 * Meeting scheduler — REST rules (Phase 1/3): validation, who may see and
 * change what, workspace isolation, invitations and responses, rescheduling
 * and cancellation, duplicate prevention, privacy, and the call-room rule.
 * Disposable test database only.
 */

const HOUR = 60 * 60_000;
const as = (u: { token: string }) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  post: (p: string, b: object = {}) => request(app).post(p).set(authHeader(u.token)).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set(authHeader(u.token)).send(b),
  delete: (p: string) => request(app).delete(p).set(authHeader(u.token)),
});
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

let organizer: TestUser;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser; // same workspace, never invited
let outsider: TestUser; // another workspace
let workspaceId: string;
let generalChannelId: string;
let otherWorkspaceId: string;

const schedule = (overrides: Record<string, unknown> = {}) =>
  as(organizer).post(`/api/workspaces/${workspaceId}/meetings`, {
    title: 'Sprint planning',
    description: 'Plan the next sprint.',
    startsAt: inHours(2),
    endsAt: inHours(3),
    timezone: 'Asia/Kolkata',
    type: 'video',
    reminderMinutes: [10, 60],
    participantIds: [alice.user.id, bob.user.id],
    ...overrides,
  });

beforeAll(async () => {
  await reconcileSharedWorkspace();
  organizer = await createAndLoginUser();
  [alice, bob, carol, outsider] = await Promise.all([createAndLoginUser(), createAndLoginUser(), createAndLoginUser(), createAndLoginUser()]);
  ({ workspaceId, generalChannelId } = await createWorkspace(organizer, `Meetings ${Date.now()}`));
  for (const u of [alice, bob, carol]) await addToWorkspace(u, workspaceId);
  ({ workspaceId: otherWorkspaceId } = await createWorkspace(outsider, `Elsewhere ${Date.now()}`));
});

afterAll(() => {
  vi.mocked(sendMeetingEmail).mockClear();
});

describe('creating a meeting', () => {
  it('creates the meeting, the organizer and invitees, and the reminder schedule; invitees are notified and e-mailed one by one', async () => {
    vi.mocked(sendMeetingEmail).mockClear();
    const res = await schedule();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = res.body.meeting;
    expect(m).toMatchObject({ title: 'Sprint planning', timezone: 'Asia/Kolkata', type: 'VIDEO', status: 'SCHEDULED', myRole: 'ORGANIZER', myResponse: 'ACCEPTED', participantCount: 3 });
    expect(m.responseCounts).toEqual({ accepted: 1, declined: 0, tentative: 0, pending: 2 });
    expect(m.meetingUrl).toMatch(new RegExp(`/${workspaceId}/meetings/${m.id}$`));
    expect(m.reminderMinutes).toEqual([60, 10]);

    const reminders = await prisma.meetingReminder.findMany({ where: { meetingId: m.id }, orderBy: { minutesBefore: 'asc' } });
    expect(reminders.map((r) => r.minutesBefore)).toEqual([10, 60]);
    expect(reminders[0].remindAt.getTime()).toBe(new Date(m.startsAt).getTime() - 10 * 60_000);

    const notices = await prisma.workNotification.findMany({ where: { meetingId: m.id }, select: { userId: true, type: true, actorId: true } });
    expect(notices.map((n) => n.userId).sort()).toEqual([alice.user.id, bob.user.id].sort());
    expect(notices.every((n) => n.type === 'meeting_invited' && n.actorId === organizer.user.id)).toBe(true);

    await vi.waitFor(() => expect(vi.mocked(sendMeetingEmail)).toHaveBeenCalledTimes(2));
    const recipients = vi.mocked(sendMeetingEmail).mock.calls.map(([e]) => e.to).sort();
    expect(recipients).toEqual([alice.user.email, bob.user.email].sort());
    expect(vi.mocked(sendMeetingEmail).mock.calls.every(([e]) => e.kind === 'invited' && e.title === 'Sprint planning')).toBe(true);
  });

  it.each([
    [{ title: '   ' }, /title/i],
    [{ startsAt: inHours(-2), endsAt: inHours(-1) }, /in the past/i],
    [{ startsAt: inHours(3), endsAt: inHours(2) }, /at least 5 minutes/i],
    [{ startsAt: inHours(2), endsAt: inHours(27) }, /at most 24 hours/i],
    [{ timezone: 'Mars/Olympus' }, /time zone/i],
    [{ reminderMinutes: [7] }, /reminders/i],
    [{ type: 'hologram' }, /video or audio/i],
    [{ participantIds: ['not-a-uuid'] }, /list of people/i],
    [{ startsAt: 'tomorrow-ish' }, /date and time/i],
  ])('refuses invalid input %j', async (overrides, message) => {
    const res = await schedule(overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('only invites active members of the same workspace, and links only a channel the organizer is in', async () => {
    const res = await schedule({ participantIds: [outsider.user.id] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only active members of this workspace/i);
    expect(JSON.stringify(res.body)).not.toContain(outsider.user.username);

    const linked = await schedule({ channelId: generalChannelId });
    expect(linked.status).toBe(201);
    expect(linked.body.meeting.channel).toMatchObject({ id: generalChannelId });
  });

  it('someone outside the workspace cannot schedule in it or list its meetings', async () => {
    expect((await as(outsider).post(`/api/workspaces/${workspaceId}/meetings`, { title: 'x', startsAt: inHours(1), endsAt: inHours(2), timezone: 'UTC' })).status).toBe(404);
    expect((await as(outsider).get(`/api/workspaces/${workspaceId}/meetings`)).status).toBe(404);
  });
});

describe('who can see a meeting', () => {
  it('the organizer and invitees see it; a workspace member who was not invited and an outsider get 404', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    expect((await as(organizer).get(`/api/meetings/${id}`)).status).toBe(200);
    const asAlice = await as(alice).get(`/api/meetings/${id}`);
    expect(asAlice.status).toBe(200);
    expect(asAlice.body.meeting).toMatchObject({ myRole: 'ATTENDEE', myResponse: 'PENDING' });
    for (const u of [carol, outsider]) {
      expect((await as(u).get(`/api/meetings/${id}`)).status).toBe(404);
      expect((await as(u).get(`/api/meetings/${id}/participants`)).status).toBe(404);
      expect((await as(u).post(`/api/meetings/${id}/respond`, { response: 'accepted' })).status).toBe(404);
    }
    const carolList = await as(carol).get(`/api/workspaces/${workspaceId}/meetings?scope=upcoming`);
    expect(carolList.body.meetings.map((m: { id: string }) => m.id)).not.toContain(id);
  });

  it('participants are listed without e-mail addresses, and no response carries one', async () => {
    const { body } = await schedule();
    const res = await as(alice).get(`/api/meetings/${body.meeting.id}/participants`);
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(3);
    expect(res.body.participants[0]).toMatchObject({ role: 'ORGANIZER', response: 'ACCEPTED', user: { id: organizer.user.id, username: organizer.user.username } });
    const all = JSON.stringify([res.body, body, (await as(alice).get(`/api/meetings/${body.meeting.id}`)).body]);
    for (const u of [organizer, alice, bob]) expect(all).not.toContain(u.user.email);
  });

  it('a meeting stays inside its workspace, and leaving the workspace removes access', async () => {
    const { body } = await schedule();
    const otherList = await as(outsider).get(`/api/workspaces/${otherWorkspaceId}/meetings?scope=upcoming`);
    expect(otherList.body.meetings.map((m: { id: string }) => m.id)).not.toContain(body.meeting.id);

    const leaver = await createAndLoginUser();
    await addToWorkspace(leaver, workspaceId);
    const invited = await schedule({ participantIds: [leaver.user.id] });
    expect((await as(leaver).get(`/api/meetings/${invited.body.meeting.id}`)).status).toBe(200);
    await prisma.workspaceMember.delete({ where: { userId_workspaceId: { userId: leaver.user.id, workspaceId } } });
    expect((await as(leaver).get(`/api/meetings/${invited.body.meeting.id}`)).status).toBe(404);
    expect((await meetingRoomAccess(leaver.user.id, invited.body.meeting.id))?.canJoin).toBe(false);
  });

  it('lists: upcoming, invitations, organized, range and past', async () => {
    const soon = (await schedule({ title: 'Soon', startsAt: inHours(1), endsAt: inHours(2) })).body.meeting;
    const later = (await schedule({ title: 'Later', startsAt: inHours(30), endsAt: inHours(31) })).body.meeting;
    const done = (await schedule({ title: 'Done' })).body.meeting;
    await prisma.meeting.update({ where: { id: done.id }, data: { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - 2 * HOUR) } });

    const ids = async (u: TestUser, q: string) => ((await as(u).get(`/api/workspaces/${workspaceId}/meetings?${q}`)).body.meetings as { id: string }[]).map((m) => m.id);
    const upcoming = await ids(alice, 'scope=upcoming');
    expect(upcoming).toEqual(expect.arrayContaining([soon.id, later.id]));
    expect(upcoming).not.toContain(done.id);
    expect(upcoming.indexOf(soon.id)).toBeLessThan(upcoming.indexOf(later.id));
    expect(await ids(alice, 'scope=invitations')).toEqual(expect.arrayContaining([soon.id, later.id]));
    expect(await ids(alice, 'scope=organized')).toHaveLength(0);
    expect(await ids(organizer, 'scope=organized')).toEqual(expect.arrayContaining([soon.id, later.id]));
    expect(await ids(alice, 'scope=past')).toContain(done.id);
    const today = await ids(alice, `scope=range&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(inHours(12))}`);
    expect(today).toContain(soon.id);
    expect(today).not.toContain(later.id);
    expect((await as(alice).get(`/api/workspaces/${workspaceId}/meetings?scope=everything`)).status).toBe(400);
  });
});

describe('invitation responses', () => {
  it('attendees accept, decline or answer tentatively; the organizer is notified; decliners drop out of Upcoming', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    expect((await as(alice).post(`/api/meetings/${id}/respond`, { response: 'accepted' })).body.meeting.myResponse).toBe('ACCEPTED');
    expect((await as(bob).post(`/api/meetings/${id}/respond`, { response: 'tentative' })).body.meeting.myResponse).toBe('TENTATIVE');
    expect((await as(bob).post(`/api/meetings/${id}/respond`, { response: 'maybe' })).status).toBe(400);
    expect((await as(organizer).post(`/api/meetings/${id}/respond`, { response: 'declined' })).status).toBe(400);

    const notices = await prisma.workNotification.findMany({ where: { meetingId: id, type: 'meeting_response' }, select: { userId: true, body: true } });
    expect(notices).toHaveLength(2);
    expect(notices.every((n) => n.userId === organizer.user.id)).toBe(true);

    expect((await as(alice).post(`/api/meetings/${id}/respond`, { response: 'declined' })).body.meeting.myResponse).toBe('DECLINED');
    const upcoming = (await as(alice).get(`/api/workspaces/${workspaceId}/meetings?scope=upcoming`)).body.meetings.map((m: { id: string }) => m.id);
    expect(upcoming).not.toContain(id);
    expect((await as(organizer).get(`/api/meetings/${id}`)).body.meeting.responseCounts).toEqual({ accepted: 1, declined: 1, tentative: 1, pending: 0 });
  });
});

describe('changing a meeting', () => {
  it('only the organizer edits; times only change through reschedule; reminder changes rebuild the schedule', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    expect((await as(alice).patch(`/api/meetings/${id}`, { title: 'Mine now' })).status).toBe(403);
    expect((await as(organizer).patch(`/api/meetings/${id}`, { startsAt: inHours(5) })).status).toBe(400);
    const edited = await as(organizer).patch(`/api/meetings/${id}`, { title: 'Sprint planning (v2)', reminderMinutes: [5] });
    expect(edited.status).toBe(200);
    expect(edited.body.meeting).toMatchObject({ title: 'Sprint planning (v2)', reminderMinutes: [5] });
    expect((await prisma.meetingReminder.findMany({ where: { meetingId: id } })).map((r) => r.minutesBefore)).toEqual([5]);
    expect(await prisma.workNotification.count({ where: { meetingId: id, type: 'meeting_updated' } })).toBe(2);
  });

  it('rescheduling asks attendees again, moves the reminders and e-mails the new time', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    await as(alice).post(`/api/meetings/${id}/respond`, { response: 'accepted' });
    vi.mocked(sendMeetingEmail).mockClear();
    const startsAt = inHours(26);
    const endsAt = inHours(27);
    const res = await as(organizer).post(`/api/meetings/${id}/reschedule`, { startsAt, endsAt, timezone: 'Europe/London' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meeting).toMatchObject({ startsAt, timezone: 'Europe/London' });
    expect((await as(alice).get(`/api/meetings/${id}`)).body.meeting.myResponse).toBe('PENDING');
    const reminders = await prisma.meetingReminder.findMany({ where: { meetingId: id }, orderBy: { minutesBefore: 'asc' } });
    expect(reminders.map((r) => r.remindAt.toISOString())).toEqual([new Date(Date.parse(startsAt) - 10 * 60_000).toISOString(), new Date(Date.parse(startsAt) - 60 * 60_000).toISOString()]);
    await vi.waitFor(() => expect(vi.mocked(sendMeetingEmail)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendMeetingEmail).mock.calls.every(([e]) => e.kind === 'rescheduled')).toBe(true);
    expect((await as(alice).post(`/api/meetings/${id}/reschedule`, { startsAt, endsAt, timezone: 'UTC' })).status).toBe(403);
    // The same time again is refused (nothing would change).
    expect((await as(organizer).post(`/api/meetings/${id}/reschedule`, { startsAt, endsAt, timezone: 'Europe/London' })).status).toBe(400);
  });

  it('cancelling notifies attendees, drops the unsent reminders, happens once, and freezes the meeting', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    expect((await as(bob).post(`/api/meetings/${id}/cancel`)).status).toBe(403);
    const [a, b] = await Promise.all([as(organizer).post(`/api/meetings/${id}/cancel`), as(organizer).post(`/api/meetings/${id}/cancel`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.meetingReminder.count({ where: { meetingId: id } })).toBe(0);
    expect(await prisma.workNotification.count({ where: { meetingId: id, type: 'meeting_cancelled' } })).toBe(2);
    expect((await as(alice).post(`/api/meetings/${id}/respond`, { response: 'accepted' })).status).toBe(409);
    expect((await as(organizer).patch(`/api/meetings/${id}`, { title: 'Back?' })).status).toBe(409);
    expect((await as(alice).get(`/api/workspaces/${workspaceId}/meetings?scope=past`)).body.meetings.map((m: { id: string }) => m.id)).toContain(id);
    expect((await meetingRoomAccess(alice.user.id, id))?.canJoin).toBe(false);
  });
});

describe('invitations', () => {
  it('inviting is organizer-only, never duplicates a person (even concurrently), and checks membership', async () => {
    const { body } = await schedule({ participantIds: [alice.user.id] });
    const id = body.meeting.id;
    expect((await as(alice).post(`/api/meetings/${id}/participants`, { userIds: [carol.user.id] })).status).toBe(403);
    const [one, two] = await Promise.all([
      as(organizer).post(`/api/meetings/${id}/participants`, { userIds: [carol.user.id, alice.user.id] }),
      as(organizer).post(`/api/meetings/${id}/participants`, { userIds: [carol.user.id] }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(await prisma.meetingParticipant.count({ where: { meetingId: id, userId: carol.user.id } })).toBe(1);
    expect(one.body.alreadyInvited).toBeGreaterThanOrEqual(1);
    expect((await as(carol).get(`/api/meetings/${id}`)).status).toBe(200);
    expect((await as(organizer).post(`/api/meetings/${id}/participants`, { userIds: [outsider.user.id] })).status).toBe(400);
  });

  it('the organizer removes an attendee, who then loses access; the organizer cannot be removed', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    expect((await as(alice).delete(`/api/meetings/${id}/participants/${bob.user.id}`)).status).toBe(403);
    expect((await as(organizer).delete(`/api/meetings/${id}/participants/${organizer.user.id}`)).status).toBe(400);
    expect((await as(organizer).delete(`/api/meetings/${id}/participants/${bob.user.id}`)).status).toBe(200);
    expect((await as(bob).get(`/api/meetings/${id}`)).status).toBe(404);
    expect(await prisma.workNotification.count({ where: { meetingId: id, userId: bob.user.id, type: 'meeting_removed' } })).toBe(1);
  });
});

describe('meeting room access (the call layer uses this)', () => {
  it('opens 15 minutes early, closes an hour after the end, and only for participants who did not decline', async () => {
    const { body } = await schedule();
    const id = body.meeting.id;
    const start = new Date(body.meeting.startsAt).getTime();
    const end = new Date(body.meeting.endsAt).getTime();
    const at = (t: number) => new Date(t);

    expect(await meetingRoomAccess(alice.user.id, id, at(start - JOIN_EARLY_MS - 60_000))).toMatchObject({ canJoin: false, reason: expect.stringMatching(/opens 15 minutes/) });
    expect(await meetingRoomAccess(alice.user.id, id, at(start - JOIN_EARLY_MS + 60_000))).toMatchObject({ canJoin: true });
    expect(await meetingRoomAccess(alice.user.id, id, at(end + JOIN_LATE_MS - 60_000))).toMatchObject({ canJoin: true });
    expect(await meetingRoomAccess(alice.user.id, id, at(end + JOIN_LATE_MS + 60_000))).toMatchObject({ canJoin: false });
    expect(await meetingRoomAccess(carol.user.id, id, at(start))).toMatchObject({ canJoin: false, reason: 'You are not invited to this meeting.' });
    expect(await meetingRoomAccess(outsider.user.id, id, at(start))).toMatchObject({ canJoin: false });
    expect(await meetingRoomAccess(alice.user.id, generalChannelId)).toBeNull(); // not a meeting

    await as(alice).post(`/api/meetings/${id}/respond`, { response: 'declined' });
    expect(await meetingRoomAccess(alice.user.id, id, at(start))).toMatchObject({ canJoin: false, reason: expect.stringMatching(/declined/) });
  });

  it('the organizer can end a meeting once it is open, not before', async () => {
    const early = (await schedule({ startsAt: inHours(5), endsAt: inHours(6) })).body.meeting;
    expect((await as(organizer).post(`/api/meetings/${early.id}/end`)).status).toBe(409);
    const now = (await schedule({ startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: inHours(1) })).body.meeting;
    expect((await as(alice).post(`/api/meetings/${now.id}/end`)).status).toBe(403);
    const ended = await as(organizer).post(`/api/meetings/${now.id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.meeting.status).toBe('ENDED');
    expect((await meetingRoomAccess(alice.user.id, now.id))?.canJoin).toBe(false);
  });
});

describe('time zones', () => {
  it('e-mails show the meeting in the recipient time zone', () => {
    const start = new Date('2026-12-01T09:30:00Z');
    const end = new Date('2026-12-01T10:00:00Z');
    expect(formatMeetingTime(start, end, 'Asia/Kolkata')).toBe('Tuesday, December 1, 2026, 3:00 PM – 3:30 PM (Asia/Kolkata)');
    expect(formatMeetingTime(start, end, 'America/New_York')).toBe('Tuesday, December 1, 2026, 4:30 AM – 5:00 AM (America/New_York)');
  });
});
