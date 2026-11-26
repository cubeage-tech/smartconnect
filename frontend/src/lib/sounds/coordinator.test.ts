import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUND_PREFERENCES, SoundPreferences } from '../api/soundPreferences';

/**
 * When a sound plays, and in which tab: categories, Do Not Disturb, calls,
 * duplicates, the browser blocking audio, and several tabs of one user
 * (separate module instances sharing Web Locks, BroadcastChannel and
 * localStorage, as real tabs do). The engine is a recorder here.
 */

const h = vi.hoisted(() => ({
  ready: true,
  prefs: null as unknown as SoundPreferences,
  plays: [] as { sound: string; volume: number; loop: boolean; stopped: boolean; stop: () => void }[],
}));

vi.mock('./engine', () => ({
  soundReady: () => h.ready,
  unlockSound: async () => h.ready,
  playSound: (sound: string, { volume, loop = false }: { volume: number; loop?: boolean }) => {
    if (!h.ready || volume <= 0) return null;
    const p = { sound, volume, loop, stopped: false, stop: () => void (p.stopped = true) };
    h.plays.push(p);
    return p;
  },
}));
vi.mock('./preferences', () => ({ getSoundPreferences: () => h.prefs }));

type Tab = typeof import('./coordinator');
/** A fresh coordinator: another browser tab of the same user. */
const openTab = async (userId = 'u1'): Promise<Tab> => {
  vi.resetModules();
  const tab = await import('./coordinator');
  tab.setSoundUser(userId);
  return tab;
};

/** Minimal Web Locks shared by every "tab" of the test (exclusive/shared, ifAvailable, signal, query). */
class FakeLocks {
  held: { name: string; mode: string }[] = [];
  queue: { name: string; mode: string; free: () => boolean; resolve: (lock: { name: string; mode: string }) => void }[] = [];
  async request(name: string, optsOrCb: unknown, maybeCb?: unknown) {
    const opts = (typeof optsOrCb === 'function' ? {} : optsOrCb) as { mode?: string; ifAvailable?: boolean; signal?: AbortSignal };
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (lock: unknown) => unknown;
    const mode = opts.mode ?? 'exclusive';
    const free = () => (mode === 'shared' ? !this.held.some((l) => l.name === name && l.mode === 'exclusive') : !this.held.some((l) => l.name === name));
    let lock: { name: string; mode: string };
    if (free() && !this.queue.some((q) => q.name === name)) {
      lock = { name, mode };
      this.held.push(lock);
    } else if (opts.ifAvailable) {
      return cb(null);
    } else {
      lock = await new Promise((resolve, reject) => {
        const entry = { name, mode, free, resolve };
        this.queue.push(entry);
        opts.signal?.addEventListener('abort', () => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(new DOMException('Aborted', 'AbortError'));
          }
        });
      });
    }
    try {
      return await cb(lock);
    } finally {
      this.held.splice(this.held.indexOf(lock), 1);
      this.pump();
    }
  }
  pump() {
    for (const entry of [...this.queue]) {
      if (!entry.free()) continue;
      this.queue.splice(this.queue.indexOf(entry), 1);
      const lock = { name: entry.name, mode: entry.mode };
      this.held.push(lock);
      entry.resolve(lock);
    }
  }
  async query() {
    return { held: this.held.map((l) => ({ ...l })), pending: [] };
  }
  /** Another tab holds `name` until the returned function is called. */
  holdElsewhere(name: string, mode = 'exclusive') {
    let release!: () => void;
    void this.request(name, { mode }, () => new Promise<void>((r) => (release = r)));
    return () => release();
  }
}

const setLocks = (locks: FakeLocks | undefined) => Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const playing = () => h.plays.filter((p) => !p.stopped);

beforeEach(() => {
  h.ready = true;
  h.prefs = structuredClone(DEFAULT_SOUND_PREFERENCES);
  h.plays = [];
  localStorage.clear();
  setLocks(undefined);
});
afterEach(() => setLocks(undefined));

describe('choosing a sound', () => {
  it('picks the ringtone category from the call', async () => {
    const { ringCategoryFor } = await openTab();
    expect(ringCategoryFor('audio', true)).toBe('oneToOneAudio');
    expect(ringCategoryFor('video', true)).toBe('oneToOneVideo');
    expect(ringCategoryFor('audio', false)).toBe('groupCall');
    expect(ringCategoryFor('video', false)).toBe('groupCall');
  });

  it('is silent with Do Not Disturb, a switched-off category, or volume 0', async () => {
    const { soundChoice } = await openTab();
    const prefs = structuredClone(DEFAULT_SOUND_PREFERENCES);
    expect(soundChoice(prefs, 'mention')).toEqual({ sound: 'ping', volume: 60 });
    expect(soundChoice({ ...prefs, doNotDisturb: true }, 'mention')).toBeNull();
    prefs.categories.mention.enabled = false;
    expect(soundChoice(prefs, 'mention')).toBeNull();
    prefs.categories.groupCall.volume = 0;
    expect(soundChoice(prefs, 'groupCall')).toBeNull();
  });
});

describe('ringing (one tab)', () => {
  it('rings with the chosen ringtone and volume, once per call, until stopped', async () => {
    const tab = await openTab();
    h.prefs.categories.oneToOneVideo = { enabled: true, sound: 'bells', volume: 35 };
    tab.startRinging('call-1', 'oneToOneVideo');
    tab.startRinging('call-1', 'oneToOneVideo'); // the same ring delivered twice
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'bells', volume: 35, loop: true })]);
    tab.stopRinging('another-call');
    expect(playing()).toHaveLength(1);
    tab.stopRinging('call-1');
    expect(playing()).toHaveLength(0);
  });

  it('a new call replaces the one ringing', async () => {
    const tab = await openTab();
    tab.startRinging('call-1', 'oneToOneAudio');
    tab.startRinging('call-2', 'groupCall');
    expect(h.plays.map((p) => [p.sound, p.stopped])).toEqual([
      ['aurora', true],
      ['pulse', false],
    ]);
  });

  it('stays silent with Do Not Disturb or the category off, and while the browser blocks audio', async () => {
    const tab = await openTab();
    h.prefs.doNotDisturb = true;
    tab.startRinging('call-1', 'oneToOneAudio');
    h.prefs.doNotDisturb = false;
    h.prefs.categories.groupCall.enabled = false;
    tab.startRinging('call-2', 'groupCall');
    h.ready = false;
    expect(() => tab.startRinging('call-3', 'oneToOneAudio')).not.toThrow();
    expect(h.plays).toEqual([]);
  });

  it('never rings in a call, and joining a call stops the ringing', async () => {
    const tab = await openTab();
    tab.startRinging('call-1', 'oneToOneAudio');
    tab.setInCall(true);
    expect(playing()).toHaveLength(0);
    tab.startRinging('call-2', 'oneToOneAudio');
    expect(playing()).toHaveLength(0);
    tab.setInCall(false);
    tab.startRinging('call-3', 'oneToOneAudio');
    expect(playing()).toHaveLength(1);
  });
});

describe('ringing across tabs (Web Locks)', () => {
  it('two tabs, one ringtone; answering in either stops both and dismisses the other banner', async () => {
    setLocks(new FakeLocks());
    const a = await openTab();
    const b = await openTab();
    const dismissedInB: string[] = [];
    b.onRingHandledElsewhere((key) => dismissedInB.push(key));
    a.startRinging('call-1', 'oneToOneAudio');
    b.startRinging('call-1', 'oneToOneAudio');
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));
    await sleep(600); // past the hand-off grace: still only one
    expect(h.plays).toHaveLength(1);

    a.markRingHandled('call-1');
    await vi.waitFor(() => expect(dismissedInB).toEqual(['call-1']));
    await sleep(600);
    expect(h.plays).toHaveLength(1);
    expect(playing()).toHaveLength(0);
  });

  it('takes over when the ringing tab closes while the call still rings', async () => {
    const locks = new FakeLocks();
    setLocks(locks);
    const release = locks.holdElsewhere('smartconnect:ringtone:u1'); // tab A ringing
    const b = await openTab();
    b.startRinging('call-1', 'groupCall');
    await sleep(50);
    expect(h.plays).toHaveLength(0);
    release(); // tab A closed
    await vi.waitFor(() => expect(playing()).toHaveLength(1), { timeout: 2000 });
    b.stopRinging('call-1');
    expect(playing()).toHaveLength(0);
  });

  it('does not ring while this user is in a call in another tab', async () => {
    const locks = new FakeLocks();
    setLocks(locks);
    const release = locks.holdElsewhere('smartconnect:in-call:u1', 'shared');
    const b = await openTab();
    b.startRinging('call-1', 'oneToOneAudio');
    b.playAlert('directMessage', 'message:m1');
    await sleep(300);
    expect(h.plays).toEqual([]);
    release();
  });

  it('a call in one tab is visible to the others', async () => {
    const locks = new FakeLocks();
    setLocks(locks);
    const a = await openTab();
    a.setInCall(true);
    await vi.waitFor(() => expect(locks.held.map((l) => l.name)).toContain('smartconnect:in-call:u1'));
    a.setInCall(false);
    await vi.waitFor(() => expect(locks.held).toEqual([]));
  });

  it('another user signed in in another tab does not silence or dismiss this one', async () => {
    setLocks(new FakeLocks());
    const other = await openTab('u2');
    const mine = await openTab('u1');
    const dismissed: string[] = [];
    mine.onRingHandledElsewhere((key) => dismissed.push(key));
    other.startRinging('call-1', 'groupCall');
    mine.startRinging('call-1', 'groupCall');
    await vi.waitFor(() => expect(h.plays).toHaveLength(2));
    other.markRingHandled('call-1');
    await sleep(100);
    expect(dismissed).toEqual([]);
    expect(playing()).toHaveLength(1);
  });

  it('a hidden tab gives the tab in front the first chance', async () => {
    setLocks(new FakeLocks());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const hidden = await openTab();
    hidden.startRinging('call-1', 'oneToOneAudio');
    visibility.mockReturnValue('visible');
    const front = await openTab();
    front.startRinging('call-1', 'oneToOneAudio');
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));
    front.markRingHandled('call-1');
    await sleep(700);
    expect(h.plays).toHaveLength(1);
    expect(playing()).toHaveLength(0);
    visibility.mockRestore();
  });
});

describe('alerts', () => {
  it('plays once per event, at the chosen sound and volume', async () => {
    const tab = await openTab();
    h.prefs.categories.mention = { enabled: true, sound: 'knock', volume: 90 };
    tab.playAlert('mention', 'message:m1');
    tab.playAlert('mention', 'message:m1');
    await vi.waitFor(() => expect(h.plays).toHaveLength(1));
    await sleep(20);
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'knock', volume: 90, loop: false })]);
  });

  it('one tab plays an event every tab received', async () => {
    setLocks(new FakeLocks());
    const a = await openTab();
    const b = await openTab();
    a.playAlert('directMessage', 'message:m1');
    b.playAlert('directMessage', 'message:m1');
    await sleep(900);
    b.playAlert('directMessage', 'message:m1'); // a late copy
    await sleep(50);
    expect(h.plays).toHaveLength(1);
  });

  it('a burst makes one sound; the next one after a pause plays', async () => {
    const tab = await openTab();
    tab.playAlert('directMessage', 'message:m1');
    tab.playAlert('directMessage', 'message:m2');
    await sleep(20);
    expect(h.plays).toHaveLength(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
    tab.playAlert('directMessage', 'message:m3');
    await vi.waitFor(() => expect(h.plays).toHaveLength(2));
    clock.mockRestore();
  });

  it('nothing for an event the person is already looking at', async () => {
    const tab = await openTab();
    tab.markAlertSeen('message:m1');
    tab.playAlert('directMessage', 'message:m1');
    await sleep(20);
    expect(h.plays).toEqual([]);
  });

  it('silent with Do Not Disturb, in a call, while ringing, or while audio is blocked', async () => {
    const tab = await openTab();
    h.prefs.doNotDisturb = true;
    tab.playAlert('meetingReminder', 'reminder:1');
    h.prefs.doNotDisturb = false;
    tab.setInCall(true);
    tab.playAlert('meetingReminder', 'reminder:2');
    tab.setInCall(false);
    tab.startRinging('call-1', 'oneToOneAudio');
    tab.playAlert('meetingReminder', 'reminder:3');
    tab.stopRinging();
    h.ready = false;
    tab.playAlert('meetingReminder', 'reminder:4');
    await sleep(20);
    expect(h.plays.map((p) => p.sound)).toEqual(['aurora']);
  });
});

describe('previews', () => {
  it('play even with Do Not Disturb, stop on demand, and not during a call', async () => {
    const tab = await openTab();
    h.prefs.doNotDisturb = true;
    expect(await tab.previewSound('bells', 40)).toBe(true);
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'bells', volume: 40, loop: true })]);
    expect(await tab.previewSound('pop', 40)).toBe(true); // replaces the first
    expect(h.plays[0].stopped).toBe(true);
    tab.stopPreview();
    expect(playing()).toHaveLength(0);
    tab.setInCall(true);
    expect(await tab.previewSound('bells', 40)).toBe(false);
    h.ready = false;
    tab.setInCall(false);
    expect(await tab.previewSound('bells', 40)).toBe(false);
  });
});
