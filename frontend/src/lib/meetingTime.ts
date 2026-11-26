/**
 * Meeting scheduler time helpers. Meetings are stored as UTC instants plus the
 * organizer's IANA time zone. The form works in wall-clock time ("15:00 on
 * 2026-12-01") in a chosen zone, which may differ from the browser's; these
 * helpers convert between the two with Intl only (no date library), DST-safe.
 */

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const FALLBACK_ZONES = ['UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];

/** Every zone the browser knows (the user's own first), or a short fallback list. */
export const timeZoneOptions = (current = browserTimeZone()): string[] => {
  const all = typeof (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf === 'function' ? (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone') : FALLBACK_ZONES;
  return [current, ...all.filter((z) => z !== current)];
};

const partsIn = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
};

/** How far `timeZone` is ahead of UTC at `date`, in ms. */
const offsetAt = (date: Date, timeZone: string) => {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (date.getTime() - date.getMilliseconds());
};

/** The UTC instant of wall-clock `date` ("YYYY-MM-DD") + `time` ("HH:mm") in `timeZone`. */
export const zonedToUtc = (date: string, time: string, timeZone: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let instant = guess - offsetAt(new Date(guess), timeZone);
  // Second pass: the offset at the real instant (differs across a DST change).
  instant = guess - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock date ("YYYY-MM-DD") and time ("HH:mm") of `instant` in `timeZone`. */
export const utcToZoned = (instant: Date | string, timeZone: string) => {
  const p = partsIn(new Date(instant), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
};

/** The next whole half hour from now (a sensible default start). */
export const nextHalfHour = (now = new Date()) => {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
};

/** "Tue, Dec 1 · 3:00 – 3:30 PM" in the viewer's time zone. */
export const formatMeetingRange = (startsAt: string | Date, endsAt: string | Date, timeZone?: string) => {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' });
  const sameDay = utcToZoned(start, timeZone ?? browserTimeZone()).date === utcToZoned(end, timeZone ?? browserTimeZone()).date;
  return sameDay ? `${day} · ${time.format(start)} – ${time.format(end)}` : `${day} ${time.format(start)} – ${new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(end)}`;
};

/** "3:00 PM" in the viewer's time zone. */
export const formatTime = (instant: string | Date, timeZone?: string) => new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

/** Local midnight of `date` and of the day after (the browser's zone). */
export const dayBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { start, end };
};

/** "YYYY-MM-DD" of `instant` in the browser's zone (calendar grouping). */
export const localDayKey = (instant: string | Date) => {
  const d = new Date(instant);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const durationLabel = (startsAt: string | Date, endsAt: string | Date) => {
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};
