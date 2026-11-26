import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Meeting } from '../../lib/api/meetings';
import { formatTime, localDayKey } from '../../lib/meetingTime';
import { IconButton } from '../ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The 6-week grid (Monday first) that shows `month`, in the browser's zone. */
export const calendarGrid = (month: Date) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return { days, from: days[0], to: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42) };
};

interface MeetingCalendarProps {
  month: Date;
  meetings: Meeting[];
  selectedDay: string;
  onSelectDay: (dayKey: string) => void;
  onMonthChange: (month: Date) => void;
}

/**
 * Month view: each day lists its meetings (titles on wide screens, dots on
 * phones). Selecting a day shows its meetings below (rendered by the page).
 */
export const MeetingCalendar = ({ month, meetings, selectedDay, onSelectDay, onMonthChange }: MeetingCalendarProps) => {
  const { days } = calendarGrid(month);
  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = localDayKey(m.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }
  const todayKey = localDayKey(new Date());
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);

  return (
    <section aria-label="Calendar" className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg" aria-live="polite">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" icon={<ChevronLeft size={18} />} onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
          <button
            type="button"
            onClick={() => {
              onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
              onSelectDay(todayKey);
            }}
            className="rounded-lg px-2.5 py-1 text-sm font-medium text-fg-muted hover:bg-surface-secondary hover:text-fg"
          >
            Today
          </button>
          <IconButton label="Next month" icon={<ChevronRight size={18} />} onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface-secondary py-1.5 text-center text-xs font-medium text-fg-muted">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = localDayKey(day);
          const list = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === month.getMonth();
          const selected = key === selectedDay;
          const label = `${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(day)}${list.length ? `, ${list.length} meeting${list.length === 1 ? '' : 's'}` : ''}`;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelectDay(key)}
              className={`flex min-h-[3.25rem] flex-col items-stretch gap-0.5 p-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:min-h-[5.5rem] sm:p-1.5 ${selected ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-secondary'}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center self-center rounded-full text-xs sm:self-start ${key === todayKey ? 'bg-brand font-semibold text-on-brand' : inMonth ? 'text-fg' : 'text-fg-subtle'}`}
              >
                {day.getDate()}
              </span>
              {/* Phones: dots. */}
              {list.length > 0 && (
                <span className="flex justify-center gap-0.5 sm:hidden" aria-hidden="true">
                  {list.slice(0, 3).map((m) => (
                    <span key={m.id} className="h-1.5 w-1.5 rounded-full bg-brand" />
                  ))}
                </span>
              )}
              {/* Wider: the first titles. */}
              <span className="hidden flex-col gap-0.5 sm:flex" aria-hidden="true">
                {list.slice(0, 2).map((m) => (
                  <span key={m.id} className="truncate rounded bg-brand-soft px-1 text-[11px] text-brand">
                    {formatTime(m.startsAt)} {m.title}
                  </span>
                ))}
                {list.length > 2 && <span className="px-1 text-[11px] text-fg-muted">+{list.length - 2} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
