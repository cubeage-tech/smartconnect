import { prisma } from '../../lib/prisma';
import { notifyUser } from '../../sockets/registry';
import { pushWorkNotifications } from '../tasks/tasks.realtime';
import { sendMeetingEmails } from './meetings.delivery';
import { createNotices, formatWhen } from './meetings.service';

/**
 * Meeting reminders — durable, server-side, sent once.
 *
 *  - The schedule is the MeetingReminder table (one row per meeting and
 *    offset, remindAt in UTC), written when a meeting is created and rebuilt
 *    when it is rescheduled or its reminders change; cancelling or ending a
 *    meeting deletes its unsent rows. Nothing lives in memory, so a restart
 *    loses nothing: the next run picks up every row that came due meanwhile.
 *  - A row is CLAIMED with a conditional update (sentAt IS NULL → now) before
 *    anything is sent, so two overlapping runs, or several instances, send
 *    it once.
 *  - At send time the meeting is re-read: a cancelled or ended meeting, or one
 *    that has already started (a reminder that came due while the server was
 *    down, too late to be useful), is claimed and skipped.
 *  - Recipients are re-read too: everyone who has not declined, still active
 *    and still in the workspace, the organizer included.
 *  - Each reminder is an in-app notification (live via work:notification, plus
 *    a meeting:reminder event the app shows as a toast). It is e-mailed only
 *    for the meeting's earliest reminder, so one meeting never sends several
 *    reminder e-mails to the same person.
 *  - Times are UTC instants, so time zones only affect how the time is shown.
 */
export const runMeetingReminders = async (now = new Date()) => {
  const due = await prisma.meetingReminder.findMany({
    where: { sentAt: null, remindAt: { lte: now } },
    select: { id: true, meetingId: true, minutesBefore: true },
    orderBy: { remindAt: 'asc' },
    take: 200,
  });
  const sent: { meetingId: string; notified: number }[] = [];
  for (const reminder of due) {
    const claimed = await prisma.meetingReminder.updateMany({ where: { id: reminder.id, sentAt: null }, data: { sentAt: now } });
    if (claimed.count !== 1) continue;

    const meeting = await prisma.meeting.findUnique({
      where: { id: reminder.meetingId },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        startsAt: true,
        timezone: true,
        status: true,
        reminderMinutes: true,
        participants: {
          where: { response: { not: 'DECLINED' }, user: { status: 'ACTIVE' } },
          select: { userId: true },
        },
      },
    });
    if (!meeting || meeting.status !== 'SCHEDULED' || meeting.startsAt.getTime() <= now.getTime()) continue;

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: meeting.workspaceId, userId: { in: meeting.participants.map((p) => p.userId) } },
      select: { userId: true },
    });
    const recipients = members.map((m) => m.userId);
    if (recipients.length === 0) continue;

    const minutesLeft = Math.max(1, Math.round((meeting.startsAt.getTime() - now.getTime()) / 60_000));
    const notifications = await createNotices(meeting, null, recipients, 'meeting_reminder', `Starts in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} · ${formatWhen(meeting.startsAt, meeting.timezone)}`);
    pushWorkNotifications(notifications);
    for (const userId of recipients) {
      notifyUser(userId, 'meeting:reminder', { meetingId: meeting.id, workspaceId: meeting.workspaceId, title: meeting.title, startsAt: meeting.startsAt, minutesLeft });
    }
    if (reminder.minutesBefore === Math.max(...meeting.reminderMinutes)) {
      sendMeetingEmails(meeting.id, recipients.map((userId) => ({ userId, kind: 'reminder' as const, minutesBefore: minutesLeft }))).catch((err) =>
        console.error('Meeting reminder e-mails failed:', err instanceof Error ? err.message : 'unknown error')
      );
    }
    sent.push({ meetingId: meeting.id, notified: recipients.length });
  }
  return sent;
};
