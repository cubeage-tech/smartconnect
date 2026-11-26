import { Mic, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Meeting, MeetingResponse } from '../../lib/api/meetings';
import { durationLabel, formatMeetingRange } from '../../lib/meetingTime';
import { displayNameOf } from '../../lib/people';
import { Badge, BadgeTone, Button } from '../ui';

const RESPONSE: Record<MeetingResponse, { label: string; tone: BadgeTone }> = {
  ACCEPTED: { label: 'Going', tone: 'success' },
  TENTATIVE: { label: 'Maybe', tone: 'warning' },
  DECLINED: { label: 'Not going', tone: 'danger' },
  PENDING: { label: 'Awaiting reply', tone: 'neutral' },
};

export const ResponseBadge = ({ response }: { response: MeetingResponse }) => <Badge tone={RESPONSE[response].tone}>{RESPONSE[response].label}</Badge>;

/** Cancelled / ended / in progress; nothing for a plain upcoming meeting. */
export const StatusBadge = ({ meeting, now = Date.now() }: { meeting: Meeting; now?: number }) => {
  if (meeting.status === 'CANCELLED') return <Badge tone="danger">Cancelled</Badge>;
  if (meeting.status === 'ENDED' || Date.parse(meeting.endsAt) <= now) return <Badge>Ended</Badge>;
  if (Date.parse(meeting.startsAt) <= now) return <Badge tone="brand">In progress</Badge>;
  return null;
};

export const MeetingTypeIcon = ({ type, size = 15 }: { type: Meeting['type']; size?: number }) =>
  type === 'AUDIO' ? <Mic size={size} aria-label="Audio meeting" /> : <Video size={size} aria-label="Video meeting" />;

interface MeetingRowProps {
  meeting: Meeting;
  onJoin?: (meeting: Meeting) => void;
  /** Invitations tab: answer inline. */
  onRespond?: (meeting: Meeting, response: 'accepted' | 'declined' | 'tentative') => void;
  responding?: boolean;
}

/** One meeting in a list: time, title, organizer, my answer, and Join when the room is open. */
export const MeetingRow = ({ meeting, onJoin, onRespond, responding }: MeetingRowProps) => {
  const cancelled = meeting.status === 'CANCELLED';
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <Link to={`/${meeting.workspaceId}/meetings/${meeting.id}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cancelled ? 'bg-surface-tertiary text-fg-subtle' : 'bg-brand-soft text-brand'}`}>
          <MeetingTypeIcon type={meeting.type} size={16} />
        </span>
        <span className="min-w-0">
          <span className={`block truncate font-semibold text-fg ${cancelled ? 'line-through decoration-fg-subtle' : ''}`}>{meeting.title}</span>
          <span className="block text-sm text-fg-muted">
            {formatMeetingRange(meeting.startsAt, meeting.endsAt)} · {durationLabel(meeting.startsAt, meeting.endsAt)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
            <span>
              {meeting.myRole === 'ORGANIZER' ? 'You organize' : `By ${displayNameOf(meeting.organizer)}`} · {meeting.participantCount} {meeting.participantCount === 1 ? 'person' : 'people'}
            </span>
            <StatusBadge meeting={meeting} />
            {meeting.myRole === 'ATTENDEE' && meeting.myResponse && meeting.status === 'SCHEDULED' && <ResponseBadge response={meeting.myResponse} />}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {onRespond && meeting.myRole === 'ATTENDEE' && meeting.status === 'SCHEDULED' && (
          <RsvpButtons value={meeting.myResponse} onRespond={(r) => onRespond(meeting, r)} busy={responding} compact />
        )}
        {onJoin && meeting.canJoin && (
          <Button size="sm" onClick={() => onJoin(meeting)} icon={<MeetingTypeIcon type={meeting.type} size={14} />}>
            Join
          </Button>
        )}
      </div>
    </li>
  );
};

const RSVP = [
  ['accepted', 'ACCEPTED', 'Accept'],
  ['tentative', 'TENTATIVE', 'Maybe'],
  ['declined', 'DECLINED', 'Decline'],
] as const;

/** Accept / Maybe / Decline; the current answer is pressed. */
export const RsvpButtons = ({ value, onRespond, busy, compact }: { value: MeetingResponse | null; onRespond: (r: 'accepted' | 'declined' | 'tentative') => void; busy?: boolean; compact?: boolean }) => (
  <div role="group" aria-label="Your response" className="inline-flex rounded-lg bg-surface-tertiary p-1">
    {RSVP.map(([key, response, label]) => (
      <button
        key={key}
        type="button"
        aria-pressed={value === response}
        disabled={busy}
        onClick={() => onRespond(key)}
        className={`rounded-md font-medium transition-colors disabled:opacity-60 ${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${value === response ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
      >
        {label}
      </button>
    ))}
  </div>
);
