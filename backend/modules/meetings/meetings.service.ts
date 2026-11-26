import { MeetingResponse, MeetingType, Prisma } from '@prisma/client';
import { APP_URL } from '../../config/env';
import { HttpError } from '../../lib/httpError';
import { isUuid } from '../../lib/messageInput';
import { prisma } from '../../lib/prisma';
import { workNotificationSelect, workNotificationView } from '../tasks/tasks.service';
import { userRef, userRefSelect } from '../tasks/tasks.views';

/**
 * Meeting scheduler — rules and data access.
 *
 * Who sees what:
 *  - A meeting is visible only to the people who have a participant row
 *    (the organizer has one too, role ORGANIZER) AND are still members of the
 *    meeting's workspace. Everyone else gets 404, never a hint it exists.
 *  - Only the organizer edits, reschedules, cancels, ends, invites or
 *    removes people. Only attendees respond.
 *  - Participants are only ever shown as {id, username, displayName}: no
 *    e-mail addresses.
 *
 * Times are UTC instants; `timezone` (IANA) is the organizer's zone, used for
 * display and e-mails. Reminders are MeetingReminder rows (see
 * meetings.reminders.ts), rebuilt on every reschedule.
 */

export const REMINDER_CHOICES = [5, 10, 15, 30, 60] as const;
export const MAX_PARTICIPANTS = 50;
export const MIN_DURATION_MS = 5 * 60_000;
export const MAX_DURATION_MS = 24 * 60 * 60_000;
export const MAX_LEAD_MS = 366 * 24 * 60 * 60_000; // schedule at most ~1 year ahead
const PAST_TOLERANCE_MS = 5 * 60_000; // "start now" from a slow form still counts
// The call room opens this long before the start and stays open this long
// after the scheduled end (meetings overrun), unless the organizer ends it.
export const JOIN_EARLY_MS = 15 * 60_000;
export const JOIN_LATE_MS = 60 * 60_000;

const MEETING_TYPES: MeetingType[] = ['VIDEO', 'AUDIO'];
const RESPONSES: Record<string, MeetingResponse> = { accepted: 'ACCEPTED', declined: 'DECLINED', tentative: 'TENTATIVE' };

// ── validation ─────────────────────────────────────────────────────────────

export const isValidTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const parseInstant = (value: unknown, field: string): Date => {
  if (typeof value !== 'string' || value.length > 40) throw new HttpError(400, `${field} must be a date and time.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${field} must be a date and time.`);
  return date;
};

/** Start/end/time zone, validated together. */
export const parseSchedule = (body: Record<string, unknown>, now = new Date()) => {
  const startsAt = parseInstant(body.startsAt, 'Start time');
  const endsAt = parseInstant(body.endsAt, 'End time');
  if (!isValidTimeZone(body.timezone)) throw new HttpError(400, 'Choose a valid time zone.');
  if (startsAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) throw new HttpError(400, 'The start time is in the past.');
  if (startsAt.getTime() > now.getTime() + MAX_LEAD_MS) throw new HttpError(400, 'Meetings can be scheduled up to a year ahead.');
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration < MIN_DURATION_MS) throw new HttpError(400, 'A meeting must end at least 5 minutes after it starts.');
  if (duration > MAX_DURATION_MS) throw new HttpError(400, 'A meeting can last at most 24 hours.');
  return { startsAt, endsAt, timezone: body.timezone as string };
};

const parseTitle = (value: unknown) => {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!title) throw new HttpError(400, 'Give the meeting a title.');
  if (title.length > 200) throw new HttpError(400, 'The title can be at most 200 characters.');
  return title;
};

const parseDescription = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'The description must be text.');
  const description = value.trim();
  if (description.length > 5000) throw new HttpError(400, 'The description can be at most 5,000 characters.');
  return description || null;
};

const parseType = (value: unknown): MeetingType => {
  if (value === undefined) return 'VIDEO';
  const type = typeof value === 'string' ? (value.toUpperCase() as MeetingType) : null;
  if (!type || !MEETING_TYPES.includes(type)) throw new HttpError(400, 'Meeting type must be video or audio.');
  return type;
};

export const parseReminders = (value: unknown): number[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > REMINDER_CHOICES.length) throw new HttpError(400, 'Choose reminders from 5, 10, 15, 30 or 60 minutes before.');
  const minutes = new Set<number>();
  for (const m of value) {
    if (!REMINDER_CHOICES.includes(m as (typeof REMINDER_CHOICES)[number])) throw new HttpError(400, 'Choose reminders from 5, 10, 15, 30 or 60 minutes before.');
    minutes.add(m as number);
  }
  return [...minutes].sort((a, b) => b - a);
};

const parseUserIds = (value: unknown, field = 'participantIds'): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isUuid)) throw new HttpError(400, `${field} must be a list of people.`);
  const ids = [...new Set(value as string[])];
  if (ids.length > MAX_PARTICIPANTS) throw new HttpError(400, `A meeting can have at most ${MAX_PARTICIPANTS} people.`);
  return ids;
};

// ── access ─────────────────────────────────────────────────────────────────

/** The caller must be an active member of the workspace (else 404, as elsewhere). */
const requireWorkspaceMember = async (userId: string, workspaceId: unknown) => {
  if (!isUuid(workspaceId)) throw new HttpError(404, 'Workspace not found.');
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { user: { select: { status: true } } },
  });
  if (!member || member.user.status !== 'ACTIVE') throw new HttpError(404, 'Workspace not found.');
  return workspaceId;
};

/** Every id must be an ACTIVE member of the workspace. Reveals no names. */
const requireInvitable = async (workspaceId: string, userIds: string[]) => {
  if (userIds.length === 0) return;
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: userIds }, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  if (members.length !== userIds.length) {
    throw new HttpError(400, 'Only active members of this workspace can be invited.');
  }
};

/** The optional channel: a channel (not a DM) of this workspace, not archived, and the organizer is in it. */
const requireUsableChannel = async (userId: string, workspaceId: string, channelId: unknown) => {
  if (channelId === undefined || channelId === null || channelId === '') return null;
  if (!isUuid(channelId)) throw new HttpError(400, 'Choose a valid channel.');
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, workspaceId, isDM: false, archivedAt: null, members: { some: { userId } } },
    select: { id: true },
  });
  if (!channel) throw new HttpError(400, 'You can only link a channel of this workspace that you are in.');
  return channel.id;
};

const meetingSelect = {
  id: true,
  workspaceId: true,
  workspace: { select: { name: true } },
  channelId: true,
  channel: { select: { id: true, name: true, isDM: true, members: { select: { userId: true } } } },
  organizerId: true,
  organizer: { select: userRefSelect },
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  type: true,
  status: true,
  reminderMinutes: true,
  cancelledAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  participants: { select: { userId: true, role: true, response: true } },
} satisfies Prisma.MeetingSelect;

type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>;

/**
 * The meeting, if `userId` may see it: they have a participant row and are
 * still an active member of its workspace. 404 otherwise.
 */
export const loadVisibleMeeting = async (userId: string, meetingId: unknown): Promise<MeetingRow> => {
  if (!isUuid(meetingId)) throw new HttpError(404, 'Meeting not found.');
  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      participants: { some: { userId } },
      workspace: { members: { some: { userId, user: { status: 'ACTIVE' } } } },
    },
    select: meetingSelect,
  });
  if (!meeting) throw new HttpError(404, 'Meeting not found.');
  return meeting;
};

const requireOrganizer = (meeting: MeetingRow, userId: string) => {
  if (meeting.organizerId !== userId) throw new HttpError(403, 'Only the organizer can change this meeting.');
};

const requireOpen = (meeting: MeetingRow, now = new Date()) => {
  if (meeting.status === 'CANCELLED') throw new HttpError(409, 'This meeting was cancelled.');
  if (meeting.status === 'ENDED' || meeting.endsAt.getTime() <= now.getTime()) throw new HttpError(409, 'This meeting has already ended.');
};

// ── views ──────────────────────────────────────────────────────────────────

export const meetingUrl = (workspaceId: string, meetingId: string) => `${APP_URL}/${workspaceId}/meetings/${meetingId}`;

/** Whether the call room accepts this person now, and why not. */
export const roomState = (meeting: { status: string; startsAt: Date; endsAt: Date }, response: MeetingResponse | null, now = new Date()) => {
  if (response === null) return { canJoin: false, reason: 'You are not invited to this meeting.' } as const;
  if (meeting.status === 'CANCELLED') return { canJoin: false, reason: 'This meeting was cancelled.' } as const;
  if (meeting.status === 'ENDED') return { canJoin: false, reason: 'This meeting has ended.' } as const;
  if (response === 'DECLINED') return { canJoin: false, reason: 'You declined this meeting. Accept it to join.' } as const;
  const t = now.getTime();
  if (t < meeting.startsAt.getTime() - JOIN_EARLY_MS) return { canJoin: false, reason: 'The meeting room opens 15 minutes before the start.' } as const;
  if (t > meeting.endsAt.getTime() + JOIN_LATE_MS) return { canJoin: false, reason: 'This meeting has ended.' } as const;
  return { canJoin: true, reason: null } as const;
};

export const meetingView = (meeting: MeetingRow, viewerId: string, now = new Date()) => {
  const mine = meeting.participants.find((p) => p.userId === viewerId) ?? null;
  const counts = { accepted: 0, declined: 0, tentative: 0, pending: 0 };
  for (const p of meeting.participants) counts[p.response.toLowerCase() as keyof typeof counts] += 1;
  // A linked channel is shown only to people who are in it (its name could be private).
  const channel = meeting.channel && !meeting.channel.isDM && meeting.channel.members.some((m) => m.userId === viewerId) ? { id: meeting.channel.id, name: meeting.channel.name } : null;
  const room = roomState(meeting, mine?.response ?? null, now);
  return {
    id: meeting.id,
    workspaceId: meeting.workspaceId,
    workspaceName: meeting.workspace.name,
    channel,
    title: meeting.title,
    description: meeting.description,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    timezone: meeting.timezone,
    type: meeting.type,
    status: meeting.status,
    reminderMinutes: meeting.reminderMinutes,
    cancelledAt: meeting.cancelledAt,
    endedAt: meeting.endedAt,
    organizer: userRef(meeting.organizer)!,
    myRole: mine?.role ?? null,
    myResponse: mine?.response ?? null,
    participantCount: meeting.participants.length,
    responseCounts: counts,
    canJoin: room.canJoin,
    joinUnavailableReason: room.reason,
    joinOpensAt: new Date(meeting.startsAt.getTime() - JOIN_EARLY_MS),
    meetingUrl: meetingUrl(meeting.workspaceId, meeting.id),
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
  };
};
export type MeetingView = ReturnType<typeof meetingView>;

const participantSelect = {
  userId: true,
  role: true,
  response: true,
  respondedAt: true,
  invitedAt: true,
  user: { select: userRefSelect },
} satisfies Prisma.MeetingParticipantSelect;

const participantView = (p: Prisma.MeetingParticipantGetPayload<{ select: typeof participantSelect }>) => ({
  user: userRef(p.user)!,
  role: p.role,
  response: p.response,
  respondedAt: p.respondedAt,
  invitedAt: p.invitedAt,
});

// ── reminders schedule ─────────────────────────────────────────────────────

/** Reminder rows for a (new) start time: only offsets still in the future. */
const reminderRows = (meetingId: string, startsAt: Date, minutes: number[], now = new Date()) =>
  minutes
    .map((m) => ({ meetingId, minutesBefore: m, remindAt: new Date(startsAt.getTime() - m * 60_000) }))
    .filter((r) => r.remindAt.getTime() > now.getTime());

/** Replaces the meeting's UNSENT reminders (sent ones stay as the record). */
const rebuildReminders = async (tx: Prisma.TransactionClient, meetingId: string, startsAt: Date, minutes: number[], now = new Date()) => {
  await tx.meetingReminder.deleteMany({ where: { meetingId, sentAt: null } });
  const rows = reminderRows(meetingId, startsAt, minutes, now);
  if (rows.length > 0) await tx.meetingReminder.createMany({ data: rows, skipDuplicates: true });
};

// ── notifications (rows; the routes push them live and send e-mails) ──────

export type MeetingNotice = 'meeting_invited' | 'meeting_updated' | 'meeting_rescheduled' | 'meeting_cancelled' | 'meeting_removed' | 'meeting_response' | 'meeting_reminder';

export interface MeetingChange {
  /** Work notifications created (push each to its recipient). */
  notifications: (Parameters<typeof workNotificationView>[0] & { userId: string })[];
  /** People whose meeting lists changed (live refresh). */
  audience: string[];
  /** E-mails to send after the response, one per recipient. */
  emails: { userId: string; kind: 'invited' | 'updated' | 'rescheduled' | 'cancelled' }[];
}

export const createNotices = async (
  meeting: { id: string; workspaceId: string; title: string },
  actorId: string | null,
  recipients: string[],
  type: MeetingNotice,
  body: string
) => {
  const candidates = [...new Set(recipients)].filter((id) => id !== actorId);
  if (candidates.length === 0) return [];
  // Only people still active in the workspace: a participant row outlives
  // leaving the workspace, and a former member must learn nothing new about
  // its meetings (title, organizer, time).
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: meeting.workspaceId, userId: { in: candidates }, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  const unique = members.map((m) => m.userId);
  if (unique.length === 0) return [];
  return prisma.$transaction(
    unique.map((userId) =>
      prisma.workNotification.create({
        data: { userId, workspaceId: meeting.workspaceId, meetingId: meeting.id, actorId, type, title: meeting.title.slice(0, 300), body: body.slice(0, 500) },
        select: workNotificationSelect,
      })
    )
  );
};

export const formatWhen = (startsAt: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(startsAt);

const displayName = (u: { username: string; profile: { displayName: string | null } | null }) => u.profile?.displayName || u.username;

// ── queries ────────────────────────────────────────────────────────────────

const LIST_SCOPES = ['upcoming', 'past', 'invitations', 'organized', 'range'] as const;
type ListScope = (typeof LIST_SCOPES)[number];

/**
 * Meetings of the caller in a workspace.
 *  - upcoming:    not ended, not cancelled, not declined; soonest first
 *  - past:        ended (by time or by the organizer) or cancelled; newest first
 *  - invitations: awaiting the caller's answer (PENDING), not ended
 *  - organized:   meetings the caller organizes, not ended
 *  - range:       overlapping [from, to) (calendar, "today"), not cancelled
 */
export const listMeetings = async (userId: string, workspaceIdParam: unknown, query: Record<string, unknown>, now = new Date()) => {
  const workspaceId = await requireWorkspaceMember(userId, workspaceIdParam);
  const scope = (typeof query.scope === 'string' ? query.scope : 'upcoming') as ListScope;
  if (!LIST_SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of ${LIST_SCOPES.join(', ')}.`);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);

  const mine: Prisma.MeetingWhereInput = { workspaceId, participants: { some: { userId } } };
  let where: Prisma.MeetingWhereInput;
  let orderBy: Prisma.MeetingOrderByWithRelationInput = { startsAt: 'asc' };
  switch (scope) {
    case 'upcoming':
      where = { ...mine, status: 'SCHEDULED', endsAt: { gt: now }, participants: { some: { userId, response: { not: 'DECLINED' } } } };
      break;
    case 'invitations':
      where = { ...mine, status: 'SCHEDULED', endsAt: { gt: now }, participants: { some: { userId, role: 'ATTENDEE', response: 'PENDING' } } };
      break;
    case 'organized':
      where = { ...mine, organizerId: userId, status: 'SCHEDULED', endsAt: { gt: now } };
      break;
    case 'past': {
      const before = query.before === undefined ? null : parseInstant(query.before, 'before');
      where = {
        ...mine,
        OR: [{ endsAt: { lte: now } }, { status: { in: ['ENDED', 'CANCELLED'] } }],
        ...(before ? { startsAt: { lt: before } } : {}),
      };
      orderBy = { startsAt: 'desc' };
      break;
    }
    case 'range': {
      const from = parseInstant(query.from, 'from');
      const to = parseInstant(query.to, 'to');
      if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > 62 * 24 * 60 * 60_000) {
        throw new HttpError(400, 'The range must be positive and at most 62 days.');
      }
      where = { ...mine, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } };
      break;
    }
  }
  const rows = await prisma.meeting.findMany({ where, select: meetingSelect, orderBy, take: limit });
  return { meetings: rows.map((m) => meetingView(m, userId, now)) };
};

export const getMeeting = async (userId: string, meetingId: unknown, now = new Date()) => meetingView(await loadVisibleMeeting(userId, meetingId), userId, now);

export const listParticipants = async (userId: string, meetingId: unknown) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  const rows = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id },
    select: participantSelect,
    orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
  });
  return { participants: rows.map(participantView) };
};

// ── commands ───────────────────────────────────────────────────────────────

export const createMeeting = async (userId: string, workspaceIdParam: unknown, body: Record<string, unknown> = {}, now = new Date()) => {
  const workspaceId = await requireWorkspaceMember(userId, workspaceIdParam);
  const title = parseTitle(body.title);
  const description = parseDescription(body.description);
  const schedule = parseSchedule(body, now);
  const type = parseType(body.type);
  const reminderMinutes = parseReminders(body.reminderMinutes);
  const inviteeIds = parseUserIds(body.participantIds).filter((id) => id !== userId);
  if (inviteeIds.length + 1 > MAX_PARTICIPANTS) throw new HttpError(400, `A meeting can have at most ${MAX_PARTICIPANTS} people.`);
  await requireInvitable(workspaceId, inviteeIds);
  const channelId = await requireUsableChannel(userId, workspaceId, body.channelId);

  const id = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({
      data: { workspaceId, channelId, organizerId: userId, title, description, ...schedule, type, reminderMinutes },
      select: { id: true },
    });
    await tx.meetingParticipant.createMany({
      data: [
        { meetingId: meeting.id, userId, role: 'ORGANIZER', response: 'ACCEPTED', respondedAt: now },
        ...inviteeIds.map((u) => ({ meetingId: meeting.id, userId: u })),
      ],
    });
    const reminders = reminderRows(meeting.id, schedule.startsAt, reminderMinutes, now);
    if (reminders.length > 0) await tx.meetingReminder.createMany({ data: reminders });
    return meeting.id;
  });

  const meeting = await loadVisibleMeeting(userId, id);
  const notifications = await createNotices(meeting, userId, inviteeIds, 'meeting_invited', `${displayName(meeting.organizer)} invited you · ${formatWhen(meeting.startsAt, meeting.timezone)}`);
  const change: MeetingChange = {
    notifications,
    audience: [userId, ...inviteeIds],
    emails: inviteeIds.map((u) => ({ userId: u, kind: 'invited' as const })),
  };
  return { meeting: meetingView(meeting, userId, now), change };
};

/** Title, description, type, reminders, linked channel; times go through reschedule. */
export const updateMeeting = async (userId: string, meetingId: unknown, body: Record<string, unknown> = {}, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  requireOpen(meeting, now);
  if (body.startsAt !== undefined || body.endsAt !== undefined || body.timezone !== undefined) {
    throw new HttpError(400, 'Use reschedule to change the time.');
  }
  const data: Prisma.MeetingUpdateInput = {};
  if (body.title !== undefined) data.title = parseTitle(body.title);
  if (body.description !== undefined) data.description = parseDescription(body.description);
  if (body.type !== undefined) data.type = parseType(body.type);
  const reminders = body.reminderMinutes !== undefined ? parseReminders(body.reminderMinutes) : null;
  if (reminders) data.reminderMinutes = reminders;
  if (body.channelId !== undefined) {
    const channelId = await requireUsableChannel(userId, meeting.workspaceId, body.channelId);
    data.channel = channelId ? { connect: { id: channelId } } : { disconnect: true };
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, 'Nothing to change.');

  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: meeting.id }, data });
    if (reminders) await rebuildReminders(tx, meeting.id, meeting.startsAt, reminders, now);
  });
  const updated = await loadVisibleMeeting(userId, meeting.id);
  // Only a change people would act on is announced (not a reminder tweak).
  const material = data.title !== undefined || data.type !== undefined || data.description !== undefined;
  const others = updated.participants.map((p) => p.userId).filter((u) => u !== userId);
  const notifications = material ? await createNotices(updated, userId, others, 'meeting_updated', `${displayName(updated.organizer)} updated the meeting details`) : [];
  return {
    meeting: meetingView(updated, userId, now),
    change: { notifications, audience: updated.participants.map((p) => p.userId), emails: [] } satisfies MeetingChange,
  };
};

/** New time: attendees are asked again (responses reset), reminders rebuilt. */
export const rescheduleMeeting = async (userId: string, meetingId: unknown, body: Record<string, unknown> = {}, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  if (meeting.status !== 'SCHEDULED') throw new HttpError(409, meeting.status === 'CANCELLED' ? 'This meeting was cancelled.' : 'This meeting has already ended.');
  const schedule = parseSchedule(body, now);
  if (schedule.startsAt.getTime() === meeting.startsAt.getTime() && schedule.endsAt.getTime() === meeting.endsAt.getTime() && schedule.timezone === meeting.timezone) {
    throw new HttpError(400, 'That is the current time.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: meeting.id }, data: schedule });
    await tx.meetingParticipant.updateMany({ where: { meetingId: meeting.id, role: 'ATTENDEE' }, data: { response: 'PENDING', respondedAt: null } });
    await rebuildReminders(tx, meeting.id, schedule.startsAt, meeting.reminderMinutes, now);
  });
  const updated = await loadVisibleMeeting(userId, meeting.id);
  const others = updated.participants.map((p) => p.userId).filter((u) => u !== userId);
  const notifications = await createNotices(updated, userId, others, 'meeting_rescheduled', `New time: ${formatWhen(updated.startsAt, updated.timezone)}. Please respond again.`);
  return {
    meeting: meetingView(updated, userId, now),
    change: { notifications, audience: updated.participants.map((p) => p.userId), emails: others.map((u) => ({ userId: u, kind: 'rescheduled' as const })) } satisfies MeetingChange,
  };
};

export const cancelMeeting = async (userId: string, meetingId: unknown, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  if (meeting.status !== 'SCHEDULED') throw new HttpError(409, meeting.status === 'CANCELLED' ? 'This meeting is already cancelled.' : 'This meeting has already ended.');
  // Conditional: two cancels at once produce one cancellation.
  const result = await prisma.$transaction(async (tx) => {
    const flipped = await tx.meeting.updateMany({ where: { id: meeting.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', cancelledAt: now } });
    if (flipped.count === 1) await tx.meetingReminder.deleteMany({ where: { meetingId: meeting.id, sentAt: null } });
    return flipped.count;
  });
  if (result !== 1) throw new HttpError(409, 'This meeting is already cancelled.');
  const updated = await loadVisibleMeeting(userId, meeting.id);
  // Everyone who had not declined is told; e-mail too unless it was already over.
  const others = updated.participants.filter((p) => p.userId !== userId && p.response !== 'DECLINED').map((p) => p.userId);
  const notifications = await createNotices(updated, userId, others, 'meeting_cancelled', `${displayName(updated.organizer)} cancelled the meeting`);
  return {
    meeting: meetingView(updated, userId, now),
    change: { notifications, audience: updated.participants.map((p) => p.userId), emails: others.map((u) => ({ userId: u, kind: 'cancelled' as const })) } satisfies MeetingChange,
  };
};

/** Organizer closes the room for everyone (and the meeting moves to Past). */
export const endMeeting = async (userId: string, meetingId: unknown, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  if (meeting.status !== 'SCHEDULED') throw new HttpError(409, 'This meeting is not in progress.');
  if (now.getTime() < meeting.startsAt.getTime() - JOIN_EARLY_MS) throw new HttpError(409, 'This meeting has not started yet. Cancel it instead.');
  const flipped = await prisma.$transaction(async (tx) => {
    const r = await tx.meeting.updateMany({ where: { id: meeting.id, status: 'SCHEDULED' }, data: { status: 'ENDED', endedAt: now } });
    if (r.count === 1) await tx.meetingReminder.deleteMany({ where: { meetingId: meeting.id, sentAt: null } });
    return r.count;
  });
  if (flipped !== 1) throw new HttpError(409, 'This meeting is not in progress.');
  const updated = await loadVisibleMeeting(userId, meeting.id);
  return { meeting: meetingView(updated, userId, now), change: { notifications: [], audience: updated.participants.map((p) => p.userId), emails: [] } satisfies MeetingChange };
};

export const inviteParticipants = async (userId: string, meetingId: unknown, body: Record<string, unknown> = {}, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  requireOpen(meeting, now);
  const requested = parseUserIds(body.userIds, 'userIds');
  if (requested.length === 0) throw new HttpError(400, 'Choose at least one person to invite.');
  const existing = new Set(meeting.participants.map((p) => p.userId));
  const fresh = requested.filter((id) => !existing.has(id));
  if (existing.size + fresh.length > MAX_PARTICIPANTS) throw new HttpError(400, `A meeting can have at most ${MAX_PARTICIPANTS} people.`);
  await requireInvitable(meeting.workspaceId, fresh);
  // skipDuplicates + the (meetingId, userId) unique key: a concurrent
  // invitation of the same person cannot create a second row.
  const created = fresh.length > 0 ? await prisma.meetingParticipant.createMany({ data: fresh.map((u) => ({ meetingId: meeting.id, userId: u })), skipDuplicates: true }) : { count: 0 };
  const updated = await loadVisibleMeeting(userId, meeting.id);
  const notifications = await createNotices(updated, userId, fresh, 'meeting_invited', `${displayName(updated.organizer)} invited you · ${formatWhen(updated.startsAt, updated.timezone)}`);
  return {
    meeting: meetingView(updated, userId, now),
    invited: created.count,
    alreadyInvited: requested.length - fresh.length,
    change: { notifications, audience: [userId, ...fresh], emails: fresh.map((u) => ({ userId: u, kind: 'invited' as const })) } satisfies MeetingChange,
  };
};

export const removeParticipant = async (userId: string, meetingId: unknown, targetId: unknown, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  requireOrganizer(meeting, userId);
  if (!isUuid(targetId) || !meeting.participants.some((p) => p.userId === targetId)) throw new HttpError(404, 'That person is not in this meeting.');
  if (targetId === meeting.organizerId) throw new HttpError(400, 'The organizer cannot be removed.');
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: meeting.id, userId: targetId } });
  const updated = await loadVisibleMeeting(userId, meeting.id);
  const notifications = meeting.status === 'SCHEDULED' && meeting.endsAt > now ? await createNotices(updated, userId, [targetId], 'meeting_removed', `${displayName(updated.organizer)} removed you from the meeting`) : [];
  return {
    meeting: meetingView(updated, userId, now),
    removedUserId: targetId,
    change: { notifications, audience: [...updated.participants.map((p) => p.userId), targetId], emails: [] } satisfies MeetingChange,
  };
};

export const respondToMeeting = async (userId: string, meetingId: unknown, body: Record<string, unknown> = {}, now = new Date()) => {
  const meeting = await loadVisibleMeeting(userId, meetingId);
  const response = typeof body.response === 'string' ? RESPONSES[body.response.toLowerCase()] : undefined;
  if (!response) throw new HttpError(400, 'Respond with accepted, declined or tentative.');
  if (meeting.organizerId === userId) throw new HttpError(400, 'The organizer does not respond to their own meeting.');
  requireOpen(meeting, now);
  await prisma.meetingParticipant.update({ where: { meetingId_userId: { meetingId: meeting.id, userId } }, data: { response, respondedAt: now } });
  const updated = await loadVisibleMeeting(userId, meeting.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: userRefSelect });
  const verb = response === 'ACCEPTED' ? 'accepted' : response === 'DECLINED' ? 'declined' : 'tentatively accepted';
  const notifications = await createNotices(updated, userId, [updated.organizerId], 'meeting_response', `${me ? displayName(me) : 'Someone'} ${verb}`);
  return {
    meeting: meetingView(updated, userId, now),
    change: { notifications, audience: [userId, updated.organizerId], emails: [] } satisfies MeetingChange,
  };
};

// ── call room (sockets/calls.handlers.ts) ──────────────────────────────────

/**
 * Whether `userId` may be in the call room of meeting `meetingId` right now:
 * a participant who has not declined, still an active workspace member, the
 * meeting neither cancelled nor ended, and the time inside the join window.
 * `null` when `meetingId` is not a meeting (the id is then a channel's).
 */
export const meetingRoomAccess = async (userId: string, meetingId: string, now = new Date()) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
      workspaceId: true,
      organizerId: true,
      participants: { where: { userId }, select: { response: true } },
      workspace: { select: { members: { where: { userId, user: { status: 'ACTIVE' } }, select: { id: true } } } },
    },
  });
  if (!meeting) return null;
  const isMember = meeting.workspace.members.length > 0;
  const response = isMember ? (meeting.participants[0]?.response ?? null) : null;
  const state = roomState(meeting, response, now);
  return { ...state, organizerId: meeting.organizerId, workspaceId: meeting.workspaceId };
};
