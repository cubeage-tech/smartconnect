import { http, seg } from './http';

/** Meeting scheduler API (backend/modules/meetings). */

export type MeetingType = 'VIDEO' | 'AUDIO';
export type MeetingStatus = 'SCHEDULED' | 'CANCELLED' | 'ENDED';
export type MeetingResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
export type MeetingRole = 'ORGANIZER' | 'ATTENDEE';
export const REMINDER_CHOICES = [5, 10, 15, 30, 60] as const;

export interface PersonRef {
  id: string;
  username: string;
  displayName: string | null;
}

export interface Meeting {
  id: string;
  workspaceId: string;
  workspaceName: string;
  /** Only when the viewer is in the linked channel. */
  channel: { id: string; name: string | null } | null;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  type: MeetingType;
  status: MeetingStatus;
  reminderMinutes: number[];
  cancelledAt: string | null;
  endedAt: string | null;
  organizer: PersonRef;
  myRole: MeetingRole | null;
  myResponse: MeetingResponse | null;
  participantCount: number;
  responseCounts: { accepted: number; declined: number; tentative: number; pending: number };
  canJoin: boolean;
  joinUnavailableReason: string | null;
  joinOpensAt: string;
  meetingUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingParticipant {
  user: PersonRef;
  role: MeetingRole;
  response: MeetingResponse;
  respondedAt: string | null;
  invitedAt: string;
}

export type MeetingScope = 'upcoming' | 'past' | 'invitations' | 'organized';

export interface MeetingInput {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  type: MeetingType;
  reminderMinutes: number[];
  participantIds?: string[];
  channelId?: string | null;
}

export const listMeetings = (workspaceId: string, scope: MeetingScope, params: { before?: string; limit?: number } = {}) =>
  http.get<{ meetings: Meeting[] }>(`/api/workspaces/${seg(workspaceId)}/meetings`, { scope, ...params });

/** Meetings overlapping [from, to) — the calendar and "Today". */
export const listMeetingsInRange = (workspaceId: string, from: Date, to: Date) =>
  http.get<{ meetings: Meeting[] }>(`/api/workspaces/${seg(workspaceId)}/meetings`, { scope: 'range', from: from.toISOString(), to: to.toISOString(), limit: 100 });

export const createMeeting = (workspaceId: string, input: MeetingInput) => http.post<{ meeting: Meeting }>(`/api/workspaces/${seg(workspaceId)}/meetings`, input);

export const getMeeting = (meetingId: string) => http.get<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}`);

export const updateMeeting = (meetingId: string, changes: Partial<Pick<MeetingInput, 'title' | 'description' | 'type' | 'reminderMinutes' | 'channelId'>>) =>
  http.patch<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}`, changes);

export const rescheduleMeeting = (meetingId: string, schedule: Pick<MeetingInput, 'startsAt' | 'endsAt' | 'timezone'>) =>
  http.post<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}/reschedule`, schedule);

export const cancelMeeting = (meetingId: string) => http.post<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}/cancel`);

export const endMeeting = (meetingId: string) => http.post<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}/end`);

export const respondToMeeting = (meetingId: string, response: 'accepted' | 'declined' | 'tentative') =>
  http.post<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}/respond`, { response });

export const listMeetingParticipants = (meetingId: string) => http.get<{ participants: MeetingParticipant[] }>(`/api/meetings/${seg(meetingId)}/participants`);

export const inviteToMeeting = (meetingId: string, userIds: string[]) =>
  http.post<{ meeting: Meeting; invited: number; alreadyInvited: number }>(`/api/meetings/${seg(meetingId)}/participants`, { userIds });

export const removeFromMeeting = (meetingId: string, userId: string) => http.delete<{ meeting: Meeting }>(`/api/meetings/${seg(meetingId)}/participants/${seg(userId)}`);
