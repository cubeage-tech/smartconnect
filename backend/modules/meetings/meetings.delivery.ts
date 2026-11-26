import { prisma } from '../../lib/prisma';
import { notifyUser } from '../../sockets/registry';
import { sendMeetingEmail } from '../../utils/mailer';
import { pushWorkNotifications } from '../tasks/tasks.realtime';
import { isValidTimeZone, MeetingChange, meetingUrl } from './meetings.service';

/**
 * After a meeting change has committed: push its notifications live (the
 * existing `work:notification` event the Activity view already handles),
 * tell everyone affected to refresh (`meeting:changed`, ids only — each
 * client reloads what it may see over REST), and send e-mails in the
 * background. Nothing here can fail the request that caused it.
 */
export const deliverMeetingChange = (meetingId: string, workspaceId: string, change: MeetingChange) => {
  pushWorkNotifications(change.notifications);
  for (const userId of new Set(change.audience)) notifyUser(userId, 'meeting:changed', { meetingId, workspaceId });
  if (change.emails.length > 0) {
    sendMeetingEmails(meetingId, change.emails).catch((err) => console.error('Meeting e-mails failed:', err instanceof Error ? err.message : 'unknown error'));
  }
};

/**
 * One e-mail per recipient, in their own time zone (their profile's, else the
 * meeting's). Recipients are re-read here, so someone removed meanwhile is
 * not e-mailed. Addresses are never logged.
 */
export const sendMeetingEmails = async (meetingId: string, emails: MeetingChange['emails'] | { userId: string; kind: 'reminder'; minutesBefore: number }[]) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      workspace: { select: { name: true } },
      organizer: { select: { username: true, profile: { select: { displayName: true } } } },
      participants: { where: { userId: { in: emails.map((e) => e.userId) } }, select: { userId: true } },
    },
  });
  if (!meeting) return;
  const stillInvited = new Set(meeting.participants.map((p) => p.userId));
  // Still invited, active, AND still in the meeting's workspace (a former
  // member is never e-mailed about its meetings).
  const users = await prisma.user.findMany({
    where: { id: { in: [...stillInvited] }, status: 'ACTIVE', workspaces: { some: { workspaceId: meeting.workspaceId } } },
    select: { id: true, email: true, profile: { select: { timezone: true } } },
  });
  const organizerName = meeting.organizer.profile?.displayName || meeting.organizer.username;
  let failed = 0;
  for (const email of emails) {
    const user = users.find((u) => u.id === email.userId);
    if (!user) continue;
    const zone = isValidTimeZone(user.profile?.timezone) ? user.profile!.timezone! : meeting.timezone;
    try {
      await sendMeetingEmail({
        to: user.email,
        kind: email.kind,
        title: meeting.title,
        organizerName,
        workspaceName: meeting.workspace.name,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        timeZone: zone,
        meetingUrl: meetingUrl(meeting.workspaceId, meeting.id),
        minutesBefore: 'minutesBefore' in email ? email.minutesBefore : undefined,
      });
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) console.error(`Meeting e-mails: ${failed} of ${emails.length} could not be sent (meeting ${meeting.id}).`);
};
