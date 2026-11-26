import { runMeetingReminders } from './meetings.reminders';

/**
 * Meeting reminders every 30 seconds (first run 5 seconds after start, which
 * also catches up on reminders that came due while the server was down).
 * Same model as tasks.jobs.ts: the timer only wakes the worker; the schedule
 * and the "sent once" guarantee live in the database (meetings.reminders.ts).
 * A run never overlaps the previous one on this instance.
 *
 * Infrastructure note: reminders are delivered while a backend instance is
 * running. A host that sleeps when idle (e.g. a free Render instance) delays
 * them until it wakes; production needs an always-on instance.
 */
export const MEETING_REMINDER_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export const startMeetingJobs = () => {
  if (timer || process.env.NODE_ENV === 'test') return;
  const run = () => {
    if (running) return;
    running = true;
    runMeetingReminders()
      .catch((err) => console.error('Meeting reminders failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(run, 5_000).unref();
  timer = setInterval(run, MEETING_REMINDER_INTERVAL_MS);
  timer.unref();
};

export const stopMeetingJobs = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
