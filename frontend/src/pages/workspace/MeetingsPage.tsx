import { CalendarDays, CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { MeetingCalendar, calendarGrid } from '../../components/meetings/MeetingCalendar';
import { MeetingRow } from '../../components/meetings/MeetingBits';
import { ScheduleMeetingModal } from '../../components/meetings/ScheduleMeetingModal';
import { Button, EmptyState, ErrorState, LoadingState, Tabs } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage } from '../../lib/api/http';
import { listMeetings, listMeetingsInRange, Meeting, respondToMeeting } from '../../lib/api/meetings';
import { dayBounds, localDayKey } from '../../lib/meetingTime';
import { useWorkspace } from './WorkspaceContext';

type TabId = 'upcoming' | 'calendar' | 'invitations' | 'mine' | 'past';
const TAB_IDS: TabId[] = ['upcoming', 'calendar', 'invitations', 'mine', 'past'];

const EMPTY: Record<Exclude<TabId, 'calendar'>, { title: string; description: string }> = {
  upcoming: { title: 'No upcoming meetings', description: 'Meetings you organize or accept show up here.' },
  invitations: { title: 'No invitations waiting', description: 'When someone invites you, you can answer here.' },
  mine: { title: 'You are not organizing any meetings', description: 'Schedule one and invite people from this workspace.' },
  past: { title: 'No past meetings yet', description: 'Ended and cancelled meetings are kept here.' },
};

/**
 * Meetings dashboard: Upcoming (with Today on top), Calendar, Invitations,
 * My meetings (organized by me) and Past. Updates live (meeting:changed).
 */
export const MeetingsPage = () => {
  const { workspaceId, socket, channels, joinMeeting } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TAB_IDS.includes(params.get('tab') as TabId) ? (params.get('tab') as TabId) : 'upcoming';

  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [today, setToday] = useState<Meeting[]>([]);
  const [invitationCount, setInvitationCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => localDayKey(new Date()));
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    try {
      if (tab === 'calendar') {
        const { from, to } = calendarGrid(month);
        const res = await listMeetingsInRange(workspaceId, from, to);
        if (id === requestId.current) setMeetings(res.meetings);
      } else if (tab === 'upcoming') {
        const { start, end } = dayBounds();
        const [day, upcoming] = await Promise.all([listMeetingsInRange(workspaceId, start, end), listMeetings(workspaceId, 'upcoming')]);
        if (id !== requestId.current) return;
        const todayIds = new Set(day.meetings.map((m) => m.id));
        setToday(day.meetings);
        setMeetings(upcoming.meetings.filter((m) => !todayIds.has(m.id)));
      } else {
        const res = await listMeetings(workspaceId, tab === 'mine' ? 'organized' : tab);
        if (id !== requestId.current) return;
        setMeetings(res.meetings);
        setHasMore(tab === 'past' && res.meetings.length === 50);
      }
    } catch (err) {
      if (id === requestId.current) setError(errorMessage(err, 'Meetings could not be loaded.'));
    }
  }, [tab, month, workspaceId]);

  const loadInvitationCount = useCallback(() => {
    listMeetings(workspaceId, 'invitations')
      .then((res) => setInvitationCount(res.meetings.length))
      .catch(() => setInvitationCount(undefined));
  }, [workspaceId]);

  useEffect(() => {
    setMeetings(null);
    void load();
  }, [load]);
  useEffect(() => loadInvitationCount(), [loadInvitationCount]);

  // Live: any change to one of my meetings in this workspace reloads the view.
  useEffect(() => {
    if (!socket) return;
    let timer: number | undefined;
    const onChanged = (data: { workspaceId?: string }) => {
      if (data?.workspaceId !== workspaceId) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load();
        loadInvitationCount();
      }, 300);
    };
    socket.on('meeting:changed', onChanged);
    return () => {
      window.clearTimeout(timer);
      socket.off('meeting:changed', onChanged);
    };
  }, [socket, workspaceId, load, loadInvitationCount]);

  const loadEarlier = async () => {
    const last = meetings?.[meetings.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await listMeetings(workspaceId, 'past', { before: last.startsAt });
      setMeetings((list) => [...(list ?? []), ...res.meetings]);
      setHasMore(res.meetings.length === 50);
    } catch (err) {
      toast.error(errorMessage(err, 'Earlier meetings could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const respond = async (meeting: Meeting, response: 'accepted' | 'declined' | 'tentative') => {
    setResponding(meeting.id);
    try {
      await respondToMeeting(meeting.id, response);
      await load();
      loadInvitationCount();
    } catch (err) {
      toast.error(errorMessage(err, 'Your answer could not be saved.'));
    } finally {
      setResponding(null);
    }
  };

  const join = (m: Meeting) => joinMeeting?.({ id: m.id, title: m.title, type: m.type, isOrganizer: m.myRole === 'ORGANIZER' });
  const dayMeetings = useMemo(() => (meetings ?? []).filter((m) => localDayKey(m.startsAt) === selectedDay), [meetings, selectedDay]);

  const list = (items: Meeting[], withRespond = false) => (
    <ul className="space-y-2">
      {items.map((m) => (
        <MeetingRow key={m.id} meeting={m} onJoin={join} onRespond={withRespond ? respond : undefined} responding={responding === m.id} />
      ))}
    </ul>
  );

  return (
    <div className="h-full overflow-y-auto bg-surface-secondary">
      <div className="mx-auto max-w-5xl p-4 sm:p-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-fg">Meetings</h1>
            <p className="mt-1 text-sm text-fg-muted">Schedule meetings with people in this workspace, answer invitations and join on time.</p>
          </div>
          <Button icon={<CalendarPlus size={16} aria-hidden="true" />} onClick={() => setScheduling(true)}>
            Schedule meeting
          </Button>
        </header>
        <div className="overflow-x-auto">
          <Tabs
            label="Meeting views"
            idPrefix="meetings"
            value={tab}
            onChange={(id) => setParams(id === 'upcoming' ? {} : { tab: id }, { replace: true })}
            tabs={[
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'calendar', label: 'Calendar' },
              { id: 'invitations', label: 'Invitations', count: invitationCount },
              { id: 'mine', label: 'My meetings' },
              { id: 'past', label: 'Past' },
            ]}
            className="min-w-max"
          />
        </div>

        <div role="tabpanel" id={`meetings-panel-${tab}`} aria-labelledby={`meetings-tab-${tab}`} className="mt-4">
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : meetings === null ? (
            <LoadingState label="Loading meetings" />
          ) : tab === 'calendar' ? (
            <div className="space-y-4">
              <MeetingCalendar month={month} meetings={meetings} selectedDay={selectedDay} onSelectDay={setSelectedDay} onMonthChange={setMonth} />
              <section aria-label="Meetings on the selected day">
                <h2 className="mb-2 text-sm font-semibold text-fg-muted">
                  {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${selectedDay}T12:00:00`))}
                </h2>
                {dayMeetings.length === 0 ? <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-fg-muted">No meetings on this day.</p> : list(dayMeetings)}
              </section>
            </div>
          ) : tab === 'upcoming' ? (
            today.length === 0 && meetings.length === 0 ? (
              <EmptyState icon={<CalendarDays size={22} />} title={EMPTY.upcoming.title} description={EMPTY.upcoming.description} action={<Button onClick={() => setScheduling(true)}>Schedule meeting</Button>} />
            ) : (
              <div className="space-y-6">
                <section aria-labelledby="meetings-today">
                  <h2 id="meetings-today" className="mb-2 text-sm font-semibold text-fg-muted">
                    Today
                  </h2>
                  {today.length === 0 ? <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-sm text-fg-muted">Nothing else today.</p> : list(today)}
                </section>
                {meetings.length > 0 && (
                  <section aria-labelledby="meetings-later">
                    <h2 id="meetings-later" className="mb-2 text-sm font-semibold text-fg-muted">
                      Coming up
                    </h2>
                    {list(meetings)}
                  </section>
                )}
              </div>
            )
          ) : meetings.length === 0 ? (
            <EmptyState icon={<CalendarDays size={22} />} title={EMPTY[tab].title} description={EMPTY[tab].description} />
          ) : (
            <>
              {list(meetings, tab === 'invitations')}
              {tab === 'past' && hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" loading={loadingMore} onClick={() => void loadEarlier()}>
                    Show earlier meetings
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {scheduling && user && (
        <ScheduleMeetingModal
          workspaceId={workspaceId}
          currentUserId={user.id}
          channels={channels}
          onClose={() => setScheduling(false)}
          onSaved={(meeting) => {
            setScheduling(false);
            toast.success('Meeting scheduled.');
            navigate(`/${workspaceId}/meetings/${meeting.id}`);
          }}
        />
      )}
    </div>
  );
};
