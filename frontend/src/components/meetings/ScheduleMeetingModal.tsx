import { Check, Mic, Video } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { errorMessage } from '../../lib/api/http';
import { createMeeting, Meeting, MeetingType, REMINDER_CHOICES, rescheduleMeeting, updateMeeting } from '../../lib/api/meetings';
import { browserTimeZone, nextHalfHour, timeZoneOptions, utcToZoned, zonedToUtc } from '../../lib/meetingTime';
import { Channel, WorkspaceMember } from '../../types';
import { Button, Field, Modal, TextArea, TextInput } from '../ui';
import { selectClass } from '../tasks/TaskBits';
import { PeoplePicker } from './PeoplePicker';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const reminderLabel = (m: number) => (m === 60 ? '1 hour' : `${m} min`);

interface ScheduleMeetingModalProps {
  workspaceId: string;
  currentUserId: string;
  /** The caller's channels in this workspace (optional link). */
  channels: Channel[];
  /** Edit mode: the organizer's meeting. Create mode when absent. */
  meeting?: Meeting;
  onClose: () => void;
  onSaved: (meeting: Meeting) => void;
}

/**
 * Schedule a meeting, or edit one as its organizer. In edit mode a changed
 * time goes through "reschedule" (attendees are asked to respond again);
 * people are managed on the meeting page.
 */
export const ScheduleMeetingModal = ({ workspaceId, currentUserId, channels, meeting, onClose, onSaved }: ScheduleMeetingModalProps) => {
  const editing = !!meeting;
  const initialZone = meeting?.timezone ?? browserTimeZone();
  const initialStart = meeting ? utcToZoned(meeting.startsAt, initialZone) : utcToZoned(nextHalfHour(), initialZone);
  const initialDuration = meeting ? Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60_000) : 30;

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [date, setDate] = useState(initialStart.date);
  const [time, setTime] = useState(initialStart.time);
  const [duration, setDuration] = useState(initialDuration);
  const [timezone, setTimezone] = useState(initialZone);
  const [type, setType] = useState<MeetingType>(meeting?.type ?? 'VIDEO');
  const [reminders, setReminders] = useState<number[]>(meeting?.reminderMinutes ?? [10]);
  const [channelId, setChannelId] = useState<string>(meeting?.channel?.id ?? '');
  const [invitees, setInvitees] = useState<WorkspaceMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const zones = useMemo(() => timeZoneOptions(initialZone), [initialZone]);
  const durations = DURATIONS.includes(initialDuration) ? DURATIONS : [...DURATIONS, initialDuration].sort((a, b) => a - b);
  const linkableChannels = channels.filter((c) => !c.isDM && !c.isGroupDM && !c.archivedAt);

  const toggleReminder = (m: number) => setReminders((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setTitleError('Give the meeting a title.');
      return;
    }
    setTitleError(null);
    if (!date || !time) {
      setError('Choose a date and a start time.');
      return;
    }
    let startsAt: Date;
    try {
      startsAt = zonedToUtc(date, time, timezone);
      if (Number.isNaN(startsAt.getTime())) throw new RangeError('invalid');
    } catch {
      setError('Choose a valid date, start time and time zone.');
      return;
    }
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (startsAt.getTime() < Date.now() - 5 * 60_000 && (!editing || startsAt.getTime() !== Date.parse(meeting!.startsAt))) {
      setError('The start time is in the past.');
      return;
    }
    setSaving(true);
    try {
      if (!meeting) {
        const { meeting: created } = await createMeeting(workspaceId, {
          title: cleanTitle,
          description: description.trim() || null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timezone,
          type,
          reminderMinutes: reminders,
          participantIds: invitees.map((m) => m.id),
          channelId: channelId || null,
        });
        onSaved(created);
        return;
      }
      let latest = meeting;
      const details = {
        ...(cleanTitle !== meeting.title ? { title: cleanTitle } : {}),
        ...((description.trim() || null) !== meeting.description ? { description: description.trim() || null } : {}),
        ...(type !== meeting.type ? { type } : {}),
        ...([...reminders].sort().join() !== [...meeting.reminderMinutes].sort().join() ? { reminderMinutes: reminders } : {}),
        ...((channelId || null) !== (meeting.channel?.id ?? null) ? { channelId: channelId || null } : {}),
      };
      if (Object.keys(details).length > 0) latest = (await updateMeeting(meeting.id, details)).meeting;
      const timeChanged = startsAt.toISOString() !== new Date(meeting.startsAt).toISOString() || endsAt.toISOString() !== new Date(meeting.endsAt).toISOString() || timezone !== meeting.timezone;
      if (timeChanged) latest = (await rescheduleMeeting(meeting.id, { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timezone })).meeting;
      onSaved(latest);
    } catch (err) {
      setError(errorMessage(err, editing ? 'The meeting could not be saved.' : 'The meeting could not be scheduled.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit meeting' : 'Schedule a meeting'}
      subtitle={editing ? 'Changing the time asks everyone to respond again.' : 'Invited people are notified in SmartConnect and by e-mail.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-meeting-form" loading={saving}>
            {editing ? 'Save changes' : 'Schedule meeting'}
          </Button>
        </>
      }
    >
      <form id="schedule-meeting-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Field label="Title" error={titleError}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Weekly sync" autoFocus />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} />
          </Field>
          <Field label="Duration">
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={selectClass}>
              {durations.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Time zone" hint="Everyone sees the meeting in their own time zone.">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectClass}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Meeting type</legend>
          <div className="inline-flex rounded-lg bg-surface-tertiary p-1">
            {(
              [
                ['VIDEO', 'Video', Video],
                ['AUDIO', 'Audio only', Mic],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${type === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
              >
                <Icon size={15} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Reminders</legend>
          <div className="flex flex-wrap gap-2">
            {REMINDER_CHOICES.map((m) => {
              const on = reminders.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleReminder(m)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-brand bg-brand-soft text-brand' : 'border-line text-fg-muted hover:border-border-strong hover:text-fg'}`}
                >
                  {on && <Check size={13} aria-hidden="true" />}
                  {reminderLabel(m)} before
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field label="Description" hint="Optional: agenda, links, what to prepare.">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
        </Field>

        {linkableChannels.length > 0 && (
          <Field label="Related channel" hint="Optional. Only people in the channel see this link.">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={selectClass}>
              <option value="">None</option>
              {linkableChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {!editing && <PeoplePicker workspaceId={workspaceId} excludeIds={[currentUserId]} selected={invitees} onChange={setInvitees} />}
      </form>
    </Modal>
  );
};
