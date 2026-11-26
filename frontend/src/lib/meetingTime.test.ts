import { describe, expect, it } from 'vitest';
import { durationLabel, nextHalfHour, utcToZoned, zonedToUtc } from './meetingTime';

/** Meeting scheduler: wall-clock time in a chosen zone ↔ UTC instants (DST-safe). */
describe('meeting time zones', () => {
  it.each([
    ['2026-12-01', '15:00', 'Asia/Kolkata', '2026-12-01T09:30:00.000Z'],
    ['2026-12-01', '09:00', 'America/New_York', '2026-12-01T14:00:00.000Z'],
    ['2026-07-01', '09:00', 'America/New_York', '2026-07-01T13:00:00.000Z'], // summer time
    ['2026-12-01', '00:30', 'Pacific/Auckland', '2026-11-30T11:30:00.000Z'], // a day ahead of UTC
    ['2026-12-01', '10:00', 'UTC', '2026-12-01T10:00:00.000Z'],
  ])('%s %s in %s is %s', (date, time, zone, iso) => {
    expect(zonedToUtc(date, time, zone).toISOString()).toBe(iso);
    expect(utcToZoned(iso, zone)).toEqual({ date, time });
  });

  it('handles the daylight-saving changes in both directions', () => {
    // US clocks go forward on 2026-03-08 at 02:00 and back on 2026-11-01 at 02:00.
    expect(zonedToUtc('2026-03-08', '01:30', 'America/New_York').toISOString()).toBe('2026-03-08T06:30:00.000Z'); // EST
    expect(zonedToUtc('2026-03-08', '03:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z'); // EDT
    expect(zonedToUtc('2026-11-01', '03:00', 'America/New_York').toISOString()).toBe('2026-11-01T08:00:00.000Z'); // EST again
    expect(utcToZoned('2026-03-08T07:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-03-08', time: '03:30' });
  });

  it('the same instant reads differently per zone but converts back to itself', () => {
    const instant = zonedToUtc('2026-12-01', '18:45', 'Europe/London');
    for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'Australia/Sydney']) {
      const wall = utcToZoned(instant, zone);
      expect(zonedToUtc(wall.date, wall.time, zone).getTime()).toBe(instant.getTime());
    }
  });

  it('defaults to the next half hour and labels durations', () => {
    expect(nextHalfHour(new Date(2026, 0, 1, 10, 5)).getMinutes()).toBe(30);
    const top = nextHalfHour(new Date(2026, 0, 1, 10, 40));
    expect([top.getHours(), top.getMinutes()]).toEqual([11, 0]);
    expect(durationLabel('2026-01-01T10:00:00Z', '2026-01-01T10:45:00Z')).toBe('45 min');
    expect(durationLabel('2026-01-01T10:00:00Z', '2026-01-01T11:30:00Z')).toBe('1 h 30 min');
    expect(durationLabel('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')).toBe('2 h');
  });
});
