import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/mailer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/mailer')>();
  return { ...real, sendMeetingEmail: vi.fn().mockResolvedValue({ sent: true }) };
});

import { app } from '../app';
import { prisma } from '../lib/prisma';
import { reconcileSharedWorkspace } from '../lib/sharedWorkspace';
import { runMeetingReminders } from '../modules/meetings/meetings.reminders';
import { sendMeetingEmail } from '../utils/mailer';
import { addToWorkspace, createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/**
 * Phase 4 — durable meeting reminders: sent once (also by concurrent runs),
 * caught up after downtime, skipped once useless (cancelled, ended, already
 * started), rebuilt on reschedule, only to people who did not decline, one
 * reminder e-mail per meeting, and independent of time zones. The worker is
 * driven directly with an explicit "now". Disposable test database only.
 */

const MIN = 60_000;
let organizer: TestUser;
let alice: TestUser;
let bob: TestUser;
let workspaceId: string;

const post = (u: TestUser, path: string, body: object = {}) => request(app).post(path).set(authHeader(u.token)).send(body);
const create = async (startsInMin: number, overrides: Record<string, unknown> = {}) => {
  const startsAt = new Date(Date.now() + startsInMin * MIN);
  const res = await post(organizer, `/api/workspaces/${workspaceId}/meetings`, {
    title: 'Design review',
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    timezone: 'Asia/Kolkata',
    reminderMinutes: [10, 30],
    participantIds: [alice.user.id, bob.user.id],
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.meeting as { id: string; startsAt: string };
};
const reminderNotices = (meetingId: string) => prisma.workNotification.findMany({ where: { meetingId, type: 'meeting_reminder' }, select: { userId: true, body: true } });

beforeAll(async () => {
  await reconcileSharedWorkspace();
  organizer = await createAndLoginUser();
  [alice, bob] = await Promise.all([createAndLoginUser(), createAndLoginUser()]);
  ({ workspaceId } = await createWorkspace(organizer, `Reminders ${Date.now()}`));
  for (const u of [alice, bob]) await addToWorkspace(u, workspaceId);
});

beforeEach(() => {
  vi.mocked(sendMeetingEmail).mockClear();
});

describe('meeting reminders', () => {
  it('sends a due reminder once to everyone who has not declined (organizer included), even with concurrent runs', async () => {
    const m = await create(60);
    await post(bob, `/api/meetings/${m.id}/respond`, { response: 'declined' });
    const start = Date.parse(m.startsAt);

    expect(await runMeetingReminders(new Date(start - 31 * MIN))).toEqual([]); // nothing due yet
    const at30 = new Date(start - 30 * MIN + 1000);
    const [a, b] = await Promise.all([runMeetingReminders(at30), runMeetingReminders(at30)]);
    expect([...a, ...b].filter((r) => r.meetingId === m.id)).toHaveLength(1);
    await runMeetingReminders(at30); // and again: still once

    const notices = await reminderNotices(m.id);
    expect(notices.map((n) => n.userId).sort()).toEqual([organizer.user.id, alice.user.id].sort());
    expect(notices[0].body).toMatch(/^Starts in 30 minutes · /);
    const row = await prisma.meetingReminder.findUnique({ where: { meetingId_minutesBefore: { meetingId: m.id, minutesBefore: 30 } } });
    expect(row?.sentAt).not.toBeNull();
  });

  it('e-mails only the earliest reminder, once per person', async () => {
    const m = await create(60);
    const start = Date.parse(m.startsAt);
    // (Creating the meeting also e-mails the invitations; only reminders are counted here.)
    // Scoped to this meeting: other meetings' reminders may come due at the same simulated time.
    const reminderEmails = () => vi.mocked(sendMeetingEmail).mock.calls.map(([e]) => e).filter((e) => e.kind === 'reminder' && e.meetingUrl.endsWith(m.id));
    await runMeetingReminders(new Date(start - 30 * MIN + 1000));
    await vi.waitFor(() => expect(reminderEmails()).toHaveLength(3));
    expect(reminderEmails().every((e) => e.minutesBefore === 30)).toBe(true);
    await runMeetingReminders(new Date(start - 10 * MIN + 1000));
    expect(await reminderNotices(m.id)).toHaveLength(6); // 3 people × 2 reminders, in the app
    await new Promise((r) => setTimeout(r, 50));
    expect(reminderEmails()).toHaveLength(3); // but no second reminder e-mail
  });

  it('catches up after downtime: a reminder that came due while the server was down is still sent before the start', async () => {
    const m = await create(60);
    const start = Date.parse(m.startsAt);
    // The server was down through both reminder times; it comes back 5 minutes before the start.
    const sent = await runMeetingReminders(new Date(start - 5 * MIN));
    expect(sent.filter((r) => r.meetingId === m.id)).toHaveLength(2);
    const bodies = (await reminderNotices(m.id)).map((n) => n.body);
    expect(bodies.every((b) => b?.startsWith('Starts in 5 minutes'))).toBe(true);
  });

  it('skips reminders that are useless: after the start, or for a cancelled or ended meeting', async () => {
    const late = await create(60);
    expect((await runMeetingReminders(new Date(Date.parse(late.startsAt) + MIN))).filter((r) => r.meetingId === late.id)).toEqual([]);
    expect(await reminderNotices(late.id)).toHaveLength(0);
    expect(await prisma.meetingReminder.count({ where: { meetingId: late.id, sentAt: null } })).toBe(0); // claimed, so never retried

    const cancelled = await create(60);
    expect((await post(organizer, `/api/meetings/${cancelled.id}/cancel`)).status).toBe(200);
    expect(await prisma.meetingReminder.count({ where: { meetingId: cancelled.id } })).toBe(0);
    // Even a row that survived (e.g. a cancel racing the worker) is skipped.
    await prisma.meetingReminder.create({ data: { meetingId: cancelled.id, minutesBefore: 5, remindAt: new Date(Date.now() - MIN) } });
    await runMeetingReminders(new Date());
    expect(await reminderNotices(cancelled.id)).toHaveLength(0);
  });

  it('rescheduling moves the reminders: the old times no longer fire, the new ones do', async () => {
    const m = await create(60);
    const oldStart = Date.parse(m.startsAt);
    const newStart = new Date(oldStart + 3 * 60 * MIN);
    const res = await post(organizer, `/api/meetings/${m.id}/reschedule`, { startsAt: newStart.toISOString(), endsAt: new Date(newStart.getTime() + 30 * MIN).toISOString(), timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(await runMeetingReminders(new Date(oldStart - 10 * MIN + 1000))).toEqual(expect.not.arrayContaining([expect.objectContaining({ meetingId: m.id })]));
    expect(await reminderNotices(m.id)).toHaveLength(0);
    await runMeetingReminders(new Date(newStart.getTime() - 10 * MIN + 1000));
    expect((await reminderNotices(m.id)).length).toBeGreaterThan(0);
  });

  it('time zones only change how the time is shown, never when the reminder fires', async () => {
    const start = new Date(Date.now() + 60 * MIN);
    const asia = await create(60, { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * MIN).toISOString(), timezone: 'Asia/Kolkata' });
    const usa = await create(60, { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * MIN).toISOString(), timezone: 'America/Los_Angeles' });
    const rows = await prisma.meetingReminder.findMany({ where: { meetingId: { in: [asia.id, usa.id] }, minutesBefore: 10 }, select: { remindAt: true } });
    expect(rows).toHaveLength(2);
    expect(rows[0].remindAt.getTime()).toBe(rows[1].remindAt.getTime());
    expect(rows[0].remindAt.getTime()).toBe(start.getTime() - 10 * MIN);
    await runMeetingReminders(new Date(start.getTime() - 10 * MIN + 1000));
    const [a] = await reminderNotices(asia.id);
    const [u] = await reminderNotices(usa.id);
    expect(a.body).toMatch(/GMT\+5:30/);
    expect(u.body).toMatch(/PST|PDT/);
  });
});
