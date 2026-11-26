import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meeting, MeetingParticipant } from '../../lib/api/meetings';

/**
 * Meeting scheduler UI: the schedule form (validation, the payload it sends,
 * edit vs reschedule), list rows (Join only when open, inline answers) and the
 * meeting page (organizer vs attendee controls, joining through the existing
 * call lobby).
 */

const api = vi.hoisted(() => ({
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  rescheduleMeeting: vi.fn(),
  getMeeting: vi.fn(),
  listMeetingParticipants: vi.fn(),
  respondToMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
  endMeeting: vi.fn(),
  inviteToMeeting: vi.fn(),
  removeFromMeeting: vi.fn(),
  listMeetings: vi.fn(),
  listMeetingsInRange: vi.fn(),
}));
vi.mock('../../lib/api/meetings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/meetings')>()), ...api }));
vi.mock('../../lib/api/workspaces', () => ({
  listWorkspaceMembers: vi.fn().mockResolvedValue({
    items: [
      { id: 'u-alice', username: 'alice', title: 'Designer', role: 'MEMBER', isOwner: false, joinedAt: '', presence: null },
      { id: 'u-bob', username: 'bob', title: null, role: 'MEMBER', isOwner: false, joinedAt: '', presence: null },
    ],
    nextCursor: null,
  }),
}));
const joinMeeting = vi.fn();
const socket = { on: vi.fn(), off: vi.fn() };
vi.mock('../../pages/workspace/WorkspaceContext', () => ({ useWorkspace: () => ({ workspaceId: 'ws1', socket, channels: [], joinMeeting }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-me', username: 'me' } }) }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { MeetingDetailPage } from '../../pages/workspace/MeetingDetailPage';
import { MeetingRow } from './MeetingBits';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';

const HOUR = 60 * 60_000;
const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'm1',
  workspaceId: 'ws1',
  workspaceName: 'Team',
  channel: null,
  title: 'Sprint planning',
  description: 'Agenda: scope.',
  startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
  endsAt: new Date(Date.now() + 3 * HOUR).toISOString(),
  timezone: 'UTC',
  type: 'VIDEO',
  status: 'SCHEDULED',
  reminderMinutes: [10],
  cancelledAt: null,
  endedAt: null,
  organizer: { id: 'u-org', username: 'olivia', displayName: 'Olivia' },
  myRole: 'ATTENDEE',
  myResponse: 'PENDING',
  participantCount: 2,
  responseCounts: { accepted: 1, declined: 0, tentative: 0, pending: 1 },
  canJoin: false,
  joinUnavailableReason: 'The meeting room opens 15 minutes before the start.',
  joinOpensAt: new Date(Date.now() + 2 * HOUR - 15 * 60_000).toISOString(),
  meetingUrl: 'http://localhost/ws1/meetings/m1',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});
const participants: MeetingParticipant[] = [
  { user: { id: 'u-org', username: 'olivia', displayName: 'Olivia' }, role: 'ORGANIZER', response: 'ACCEPTED', respondedAt: null, invitedAt: '' },
  { user: { id: 'u-me', username: 'me', displayName: null }, role: 'ATTENDEE', response: 'PENDING', respondedAt: null, invitedAt: '' },
];

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  joinMeeting.mockReset();
});

describe('ScheduleMeetingModal', () => {
  const open = (props: Partial<Parameters<typeof ScheduleMeetingModal>[0]> = {}) => {
    const onSaved = vi.fn();
    render(<ScheduleMeetingModal workspaceId="ws1" currentUserId="u-me" channels={[]} onClose={vi.fn()} onSaved={onSaved} {...props} />);
    return { onSaved };
  };

  it('needs a title before anything is sent', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    expect(await screen.findByText('Give the meeting a title.')).toBeInTheDocument();
    expect(api.createMeeting).not.toHaveBeenCalled();
  });

  it('sends the time as a UTC instant for the chosen zone, with reminders and the picked people', async () => {
    api.createMeeting.mockResolvedValue({ meeting: meeting({ id: 'new' }) });
    const { onSaved } = open();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Design review ' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-01-15' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText(/Time zone/), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByRole('button', { name: /Audio only/ }));
    fireEvent.click(screen.getByRole('button', { name: /30 min before/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /alice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalledTimes(1));
    expect(api.createMeeting).toHaveBeenCalledWith('ws1', {
      title: 'Design review',
      description: null,
      startsAt: '2027-01-15T20:00:00.000Z', // 15:00 in New York (UTC−5 in January)
      endsAt: '2027-01-15T20:45:00.000Z',
      timezone: 'America/New_York',
      type: 'AUDIO',
      reminderMinutes: [10, 30],
      participantIds: ['u-alice'],
      channelId: null,
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }));
  });

  it('editing: a details change updates, a time change reschedules', async () => {
    const m = meeting({ myRole: 'ORGANIZER', startsAt: '2027-02-01T10:00:00.000Z', endsAt: '2027-02-01T11:00:00.000Z' });
    api.updateMeeting.mockResolvedValue({ meeting: m });
    api.rescheduleMeeting.mockResolvedValue({ meeting: m });
    open({ meeting: m });
    expect(screen.queryByRole('textbox', { name: 'Search people' })).not.toBeInTheDocument(); // people are managed on the page
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sprint planning (v2)' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.rescheduleMeeting).toHaveBeenCalled());
    expect(api.updateMeeting).toHaveBeenCalledWith('m1', { title: 'Sprint planning (v2)' });
    expect(api.rescheduleMeeting).toHaveBeenCalledWith('m1', { startsAt: '2027-02-01T11:00:00.000Z', endsAt: '2027-02-01T12:00:00.000Z', timezone: 'UTC' });
  });
});

describe('MeetingRow', () => {
  const row = (m: Meeting, extra: Partial<Parameters<typeof MeetingRow>[0]> = {}) =>
    render(
      <MemoryRouter>
        <ul>
          <MeetingRow meeting={m} {...extra} />
        </ul>
      </MemoryRouter>
    );

  it('offers Join only while the room is open', () => {
    const onJoin = vi.fn();
    row(meeting(), { onJoin });
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
    row(meeting({ id: 'm2', canJoin: true }), { onJoin });
    fireEvent.click(screen.getByRole('button', { name: /Join/ }));
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }));
  });

  it('answers invitations inline and marks cancelled meetings', () => {
    const onRespond = vi.fn();
    row(meeting(), { onRespond });
    fireEvent.click(within(screen.getByRole('group', { name: 'Your response' })).getByRole('button', { name: 'Accept' }));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), 'accepted');
    row(meeting({ id: 'm3', status: 'CANCELLED' }));
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

describe('MeetingDetailPage', () => {
  const page = () =>
    render(
      <MemoryRouter initialEntries={['/ws1/meetings/m1']}>
        <Routes>
          <Route path="/:workspaceId/meetings/:meetingId" element={<MeetingDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it('an attendee answers and sees why the room is not open yet; no organizer controls', async () => {
    api.getMeeting.mockResolvedValue({ meeting: meeting() });
    api.listMeetingParticipants.mockResolvedValue({ participants });
    api.respondToMeeting.mockResolvedValue({ meeting: meeting({ myResponse: 'ACCEPTED' }) });
    page();
    expect(await screen.findByRole('heading', { name: 'Sprint planning' })).toBeInTheDocument();
    expect(screen.getByText(/opens 15 minutes before the start/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.respondToMeeting).toHaveBeenCalledWith('m1', 'accepted'));
  });

  it('joining opens the existing call lobby for this meeting', async () => {
    api.getMeeting.mockResolvedValue({ meeting: meeting({ canJoin: true, joinUnavailableReason: null, myResponse: 'ACCEPTED' }) });
    api.listMeetingParticipants.mockResolvedValue({ participants });
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Join meeting/ }));
    expect(joinMeeting).toHaveBeenCalledWith({ id: 'm1', title: 'Sprint planning', type: 'VIDEO', isOrganizer: false });
  });

  it('the organizer can edit, invite, remove and cancel', async () => {
    api.getMeeting.mockResolvedValue({ meeting: meeting({ myRole: 'ORGANIZER', myResponse: 'ACCEPTED', organizer: { id: 'u-me', username: 'me', displayName: null } }) });
    api.listMeetingParticipants.mockResolvedValue({
      participants: [
        { ...participants[0], user: { id: 'u-me', username: 'me', displayName: null } },
        { user: { id: 'u-bob', username: 'bob', displayName: null }, role: 'ATTENDEE', response: 'DECLINED', respondedAt: null, invitedAt: '' },
      ],
    });
    page();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove bob/ })).toBeInTheDocument();
    expect(screen.getByText('Not going')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Your response' })).not.toBeInTheDocument(); // organizers don't answer
  });

  it('a meeting you cannot see shows "not found", not an error', async () => {
    const { ApiError } = await import('../../lib/api/http');
    api.getMeeting.mockRejectedValue(new ApiError('Meeting not found.', 404));
    api.listMeetingParticipants.mockRejectedValue(new ApiError('Meeting not found.', 404));
    page();
    expect(await screen.findByText('Meeting not found')).toBeInTheDocument();
  });
});
