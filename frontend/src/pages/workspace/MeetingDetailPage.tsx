import { ArrowLeft, Clock, Hash, Pencil, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { MeetingTypeIcon, ResponseBadge, RsvpButtons, StatusBadge } from '../../components/meetings/MeetingBits';
import { PeoplePicker } from '../../components/meetings/PeoplePicker';
import { ScheduleMeetingModal } from '../../components/meetings/ScheduleMeetingModal';
import { Button, ErrorState, IconButton, LoadingState, Modal, useConfirm } from '../../components/ui';
import { Avatar } from '../../components/ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError, errorMessage } from '../../lib/api/http';
import {
  cancelMeeting,
  endMeeting,
  getMeeting,
  inviteToMeeting,
  listMeetingParticipants,
  Meeting,
  MeetingParticipant,
  removeFromMeeting,
  respondToMeeting,
} from '../../lib/api/meetings';
import { browserTimeZone, durationLabel, formatMeetingRange, formatTime } from '../../lib/meetingTime';
import { displayNameOf, nameIn, usePeopleDirectory } from '../../lib/people';
import { WorkspaceMember } from '../../types';
import { useWorkspace } from './WorkspaceContext';

/** One meeting: when, who, my answer, Join, and the organizer's controls. */
export const MeetingDetailPage = () => {
  const { meetingId = '' } = useParams();
  const { workspaceId, socket, channels, joinMeeting } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const people = usePeopleDirectory();
  const { confirm, dialog } = useConfirm();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [toInvite, setToInvite] = useState<WorkspaceMember[]>([]);

  const load = useCallback(async () => {
    try {
      const [{ meeting: m }, { participants: p }] = await Promise.all([getMeeting(meetingId), listMeetingParticipants(meetingId)]);
      setMeeting(m);
      setParticipants(p);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(errorMessage(err, 'This meeting could not be loaded.'));
    }
  }, [meetingId]);

  useEffect(() => {
    setMeeting(null);
    setNotFound(false);
    void load();
  }, [load]);

  // Live: changes to this meeting (responses, reschedule, cancel…) reload it.
  // The join window opens and closes with time, so the page also re-checks each minute.
  useEffect(() => {
    if (!socket) return;
    const onChanged = (data: { meetingId?: string }) => data?.meetingId === meetingId && void load();
    socket.on('meeting:changed', onChanged);
    return () => {
      socket.off('meeting:changed', onChanged);
    };
  }, [socket, meetingId, load]);
  useEffect(() => {
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const run = async (key: string, action: () => Promise<{ meeting: Meeting }>, done?: string) => {
    setBusy(key);
    try {
      const res = await action();
      setMeeting(res.meeting);
      if (done) toast.success(done);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'That did not work. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary p-6">
        <ErrorState title="Meeting not found" message="It may have been removed, or you are not invited to it." onRetry={() => navigate(`/${workspaceId}/meetings`)} />
      </div>
    );
  }
  if (error) return <div className="p-6"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!meeting || !user) return <LoadingState label="Loading meeting" />;

  const isOrganizer = meeting.myRole === 'ORGANIZER';
  const open = meeting.status === 'SCHEDULED' && Date.parse(meeting.endsAt) > Date.now();
  const inProgress = meeting.status === 'SCHEDULED' && Date.parse(meeting.joinOpensAt) <= Date.now();
  const zone = browserTimeZone();

  return (
    <div className="h-full overflow-y-auto bg-surface-secondary">
      {dialog}
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <Link to={`/${workspaceId}/meetings`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
          <ArrowLeft size={15} aria-hidden="true" /> Meetings
        </Link>

        <article className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <StatusBadge meeting={meeting} />
                {meeting.myRole === 'ATTENDEE' && meeting.myResponse && open && <ResponseBadge response={meeting.myResponse} />}
              </div>
              <h1 className={`text-xl font-bold tracking-tight text-fg sm:text-2xl ${meeting.status === 'CANCELLED' ? 'line-through decoration-fg-subtle' : ''}`}>{meeting.title}</h1>
            </div>
            {isOrganizer && open && (
              <Button variant="secondary" size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </header>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-start gap-2.5">
              <dt className="sr-only">When</dt>
              <Clock size={16} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <dd className="text-fg">
                {formatMeetingRange(meeting.startsAt, meeting.endsAt)} <span className="text-fg-muted">· {durationLabel(meeting.startsAt, meeting.endsAt)}</span>
                {/* The organizer's local time, only when it reads differently (zone names have aliases, e.g. Asia/Kolkata = Asia/Calcutta). */}
                {formatMeetingRange(meeting.startsAt, meeting.endsAt, meeting.timezone) !== formatMeetingRange(meeting.startsAt, meeting.endsAt, zone) && (
                  <span className="block text-xs text-fg-muted">
                    {formatMeetingRange(meeting.startsAt, meeting.endsAt, meeting.timezone)} in {meeting.timezone.replace(/_/g, ' ')} (organizer)
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center gap-2.5">
              <dt className="sr-only">Type</dt>
              <span className="text-fg-subtle">
                <MeetingTypeIcon type={meeting.type} size={16} />
              </span>
              <dd className="text-fg">{meeting.type === 'AUDIO' ? 'Audio meeting' : 'Video meeting'} in SmartConnect</dd>
            </div>
            {meeting.channel && (
              <div className="flex items-center gap-2.5">
                <dt className="sr-only">Channel</dt>
                <Hash size={16} className="text-fg-subtle" aria-hidden="true" />
                <dd>
                  <Link to={`/${workspaceId}/c/${meeting.channel.id}`} className="font-medium text-brand hover:underline">
                    {meeting.channel.name}
                  </Link>
                  <span className="text-fg-muted"> · meeting chat</span>
                </dd>
              </div>
            )}
          </dl>

          {meeting.status === 'SCHEDULED' && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary p-3">
              {meeting.canJoin ? (
                <Button
                  icon={<MeetingTypeIcon type={meeting.type} size={16} />}
                  onClick={() => joinMeeting?.({ id: meeting.id, title: meeting.title, type: meeting.type, isOrganizer })}
                >
                  Join meeting
                </Button>
              ) : (
                <p className="text-sm text-fg-muted">
                  {meeting.joinUnavailableReason}
                  {Date.parse(meeting.joinOpensAt) > Date.now() && ` (at ${formatTime(meeting.joinOpensAt)}).`}
                </p>
              )}
              {meeting.myRole === 'ATTENDEE' && open && (
                <div className="flex items-center gap-2 sm:ml-auto">
                  <span className="text-sm text-fg-muted">Going?</span>
                  <RsvpButtons value={meeting.myResponse} busy={busy === 'respond'} onRespond={(r) => void run('respond', () => respondToMeeting(meeting.id, r))} />
                </div>
              )}
            </div>
          )}

          {meeting.description && <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{meeting.description}</p>}
        </article>

        <section aria-labelledby="meeting-people" className="mt-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="meeting-people" className="text-base font-semibold text-fg">
              People <span className="font-normal text-fg-muted">· {meeting.responseCounts.accepted} going, {meeting.responseCounts.tentative} maybe, {meeting.responseCounts.pending} not answered</span>
            </h2>
            {isOrganizer && open && (
              <Button variant="secondary" size="sm" icon={<UserPlus size={14} aria-hidden="true" />} onClick={() => setInviting(true)}>
                Invite people
              </Button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {participants.map((p) => {
              const name = nameIn(people, p.user, displayNameOf(p.user));
              return (
                <li key={p.user.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={name} userId={p.user.id} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {name}
                    {p.user.id === user.id && <span className="text-fg-muted"> (you)</span>}
                  </span>
                  {p.role === 'ORGANIZER' ? <span className="text-xs font-medium text-fg-muted">Organizer</span> : <ResponseBadge response={p.response} />}
                  {isOrganizer && p.role !== 'ORGANIZER' && (
                    <IconButton
                      label={`Remove ${name} from the meeting`}
                      icon={<X size={15} />}
                      size="sm"
                      disabled={busy !== null}
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${name}?`, message: 'They lose access to this meeting and its room.', confirmLabel: 'Remove', tone: 'danger' })) {
                          void run('remove', () => removeFromMeeting(meeting.id, p.user.id), `${name} was removed.`);
                        }
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {participants.length > 8 && <p className="mt-3 text-xs text-fg-muted">Up to 8 people can be in the meeting room at the same time.</p>}
        </section>

        {isOrganizer && meeting.status === 'SCHEDULED' && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {inProgress && (
              <Button
                variant="secondary"
                loading={busy === 'end'}
                onClick={async () => {
                  if (await confirm({ title: 'End the meeting for everyone?', message: 'Everyone in the room is disconnected and the meeting moves to Past.', confirmLabel: 'End meeting', tone: 'danger' })) {
                    void run('end', () => endMeeting(meeting.id), 'Meeting ended.');
                  }
                }}
              >
                End meeting
              </Button>
            )}
            {open && (
              <Button
                variant="danger"
                loading={busy === 'cancel'}
                onClick={async () => {
                  if (await confirm({ title: 'Cancel this meeting?', message: 'Everyone invited is told, in SmartConnect and by e-mail.', confirmLabel: 'Cancel meeting', cancelLabel: 'Keep it', tone: 'danger' })) {
                    void run('cancel', () => cancelMeeting(meeting.id), 'Meeting cancelled.');
                  }
                }}
              >
                Cancel meeting
              </Button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <ScheduleMeetingModal
          workspaceId={workspaceId}
          currentUserId={user.id}
          channels={channels}
          meeting={meeting}
          onClose={() => setEditing(false)}
          onSaved={(m) => {
            setEditing(false);
            setMeeting(m);
            toast.success('Meeting updated.');
            void load();
          }}
        />
      )}
      {inviting && (
        <Modal
          title="Invite people"
          subtitle={meeting.title}
          onClose={() => {
            setInviting(false);
            setToInvite([]);
          }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setInviting(false)}>
                Cancel
              </Button>
              <Button
                disabled={toInvite.length === 0}
                loading={busy === 'invite'}
                onClick={() =>
                  void run('invite', async () => {
                    const res = await inviteToMeeting(meeting.id, toInvite.map((m) => m.id));
                    setInviting(false);
                    setToInvite([]);
                    return res;
                  }, `${toInvite.length === 1 ? 'Invitation' : 'Invitations'} sent.`)
                }
              >
                Invite {toInvite.length > 0 ? toInvite.length : ''}
              </Button>
            </>
          }
        >
          <PeoplePicker workspaceId={workspaceId} excludeIds={participants.map((p) => p.user.id)} selected={toInvite} onChange={setToInvite} legend="People in this workspace" />
        </Modal>
      )}
    </div>
  );
};
