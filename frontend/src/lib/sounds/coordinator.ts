import { useSyncExternalStore } from 'react';
import { AlertCategory, RingCategory, SoundCategory, SoundPreferences } from '../api/soundPreferences';
import { Playback, playSound, soundReady, unlockSound } from './engine';
import { SOUNDS } from './library';
import { getSoundPreferences } from './preferences';

/**
 * When SmartConnect makes a sound, and in which tab.
 *
 * - Ringtones loop while the incoming-call banner is up (WorkspaceLayout ties
 *   startRinging/stopRinging to it), so they stop with it on accept, decline,
 *   cancel, timeout, an answer elsewhere, or a lost connection.
 * - Alerts (messages, mentions, meeting reminders) play once per event.
 * - Nothing plays with Do Not Disturb on, for a switched-off category, while
 *   this user is in a call in any tab (never over call audio), or — for an
 *   alert — while a call is ringing.
 * - One tab plays: the user's open tabs all receive the same socket events.
 *   Web Locks (per user) elect the player, the tab in front first; tabs where
 *   the browser still blocks audio do not compete. Accepting or declining in
 *   one tab stops the ringing (and the banner) in the others. Browsers
 *   without Web Locks fall back to each tab deciding alone.
 * - Previews (settings) always play when asked, except during a call.
 */

export const ringCategoryFor = (callType: 'audio' | 'video', oneToOne: boolean): RingCategory =>
  !oneToOne ? 'groupCall' : callType === 'video' ? 'oneToOneVideo' : 'oneToOneAudio';

/** What to play for `category` under `prefs`, or null for silence. */
export const soundChoice = (prefs: SoundPreferences, category: SoundCategory) => {
  if (!prefs || prefs.doNotDisturb) return null;
  const choice = prefs.categories?.[category];
  if (!choice?.enabled || choice.volume <= 0) return null;
  return { sound: choice.sound, volume: choice.volume };
};

/** The tab in front gets the first chance to play. */
export const HIDDEN_TAB_DELAY_MS = 200;
/** After waiting for another tab's ring lock: time for its "handled" message to arrive. */
export const HANDOFF_GRACE_MS = 400;
/** At most one alert per this interval (a burst of messages makes one sound). */
export const ALERT_GAP_MS = 1200;
/** How long an alert keeps its lock (the other tabs see it as played). */
const ALERT_HOLD_MS = 600;
const PLAYED_TTL_MS = 2 * 60_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const lockManager = (): LockManager | null => (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null);

let userId: string | null = null;
/** Sounds belong to one signed-in user (dev tabs may each be someone else). */
export const setSoundUser = (id: string | null) => {
  if (id === userId) return;
  stopRinging();
  setInCall(false);
  userId = id;
  if (id) getChannel(); // hear about calls answered in other tabs from now on
};
const lockName = (what: 'ringtone' | 'alert' | 'in-call') => `smartconnect:${what}:${userId ?? 'anonymous'}`;

// ── Cross-tab messages ────────────────────────────────────────────────────
type TabMessage = { type: 'ring-handled'; userId: string; key: string };
let channel: BroadcastChannel | null = null;
const handledListeners = new Set<(key: string) => void>();
const getChannel = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel('smartconnect:ringing');
    channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const msg = event.data;
      if (msg?.type !== 'ring-handled' || msg.userId !== userId || typeof msg.key !== 'string') return;
      stopRinging(msg.key);
      handledListeners.forEach((fn) => fn(msg.key));
    };
  } catch {
    channel = null;
  }
  return channel;
};

/** Another of this user's tabs accepted or declined the call `key`. */
export const onRingHandledElsewhere = (fn: (key: string) => void) => {
  getChannel();
  handledListeners.add(fn);
  return () => {
    handledListeners.delete(fn);
  };
};

// ── In a call ─────────────────────────────────────────────────────────────
let inCallHere = false;
let releaseInCall: (() => void) | null = null;
const inCallListeners = new Set<() => void>();

/** This tab joined (or left) a call or its lobby; other tabs see it through a shared lock. */
export const setInCall = (value: boolean) => {
  if (value === inCallHere) return;
  inCallHere = value;
  if (value) {
    stopRinging();
    stopPreview();
    const locks = lockManager();
    if (locks) {
      const held = new Promise<void>((resolve) => {
        releaseInCall = resolve;
      });
      locks.request(lockName('in-call'), { mode: 'shared' }, () => held).catch(() => undefined);
    }
  } else {
    releaseInCall?.();
    releaseInCall = null;
  }
  inCallListeners.forEach((fn) => fn());
};

export const useInCall = () =>
  useSyncExternalStore(
    (fn) => {
      inCallListeners.add(fn);
      return () => inCallListeners.delete(fn);
    },
    () => inCallHere,
    () => inCallHere
  );

/** Whether this user is in a call (any tab) or — with `orRinging` — another tab is ringing. */
const busyElsewhere = async (orRinging: boolean) => {
  if (inCallHere) return true;
  const locks = lockManager();
  if (!locks?.query) return false;
  try {
    const { held = [] } = await locks.query();
    return held.some((l) => l.name === lockName('in-call') || (orRinging && l.name === lockName('ringtone')));
  } catch {
    return false;
  }
};

// ── Ringtones ─────────────────────────────────────────────────────────────
interface Ring {
  key: string;
  playback: Playback | null;
  abort: AbortController | null;
  release: (() => void) | null;
}
let ring: Ring | null = null;

/** Rings for the call `key` (a conversation or meeting id) until stopRinging; repeated calls are no-ops. */
export const startRinging = (key: string, category: RingCategory) => {
  if (ring?.key === key) return;
  stopRinging();
  const choice = soundChoice(getSoundPreferences(), category);
  if (!choice || inCallHere) return;
  const r: Ring = { key, playback: null, abort: null, release: null };
  ring = r;
  getChannel();
  const play = () => {
    if (ring === r && !r.playback) r.playback = playSound(choice.sound, { volume: choice.volume, loop: true });
    return !!r.playback;
  };
  const locks = lockManager();
  if (!locks) {
    if (soundReady()) play();
    return;
  }
  r.abort = typeof AbortController === 'undefined' ? null : new AbortController();
  // Plays and keeps the lock until the ring stops; nothing (and the lock goes
  // straight back) when audio turned out to be blocked here.
  const hold = async () => {
    if (!play()) return;
    await new Promise<void>((resolve) => {
      r.release = resolve;
    });
  };
  void (async () => {
    if (!isVisible()) await delay(HIDDEN_TAB_DELAY_MS);
    if (ring !== r || !soundReady() || (await busyElsewhere(false)) || ring !== r) return;
    const name = lockName('ringtone');
    // Nobody else ringing: this tab rings.
    const rangHere = await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      if (ring === r) await hold();
      return true;
    });
    if (rangHere || ring !== r) return;
    // Another tab is ringing: take over only if it goes away (closed) while
    // the call still rings here. If it was answered or declined there, its
    // "handled" message arrives within the grace period and this stops first.
    try {
      await locks.request(name, r.abort ? { signal: r.abort.signal } : {}, async () => {
        await delay(HANDOFF_GRACE_MS);
        if (ring !== r || (await busyElsewhere(false)) || ring !== r) return;
        await hold();
      });
    } catch {
      /* stopped while waiting for the lock */
    }
  })().catch(() => undefined);
};

/** Stops ringing (only for `key` when given). Local to this tab. */
export const stopRinging = (key?: string) => {
  if (!ring || (key !== undefined && ring.key !== key)) return;
  const r = ring;
  ring = null;
  r.playback?.stop();
  r.abort?.abort();
  r.release?.();
};

/** This tab accepted or declined `key`: stop here and in this user's other tabs. */
export const markRingHandled = (key: string) => {
  if (userId) {
    try {
      getChannel()?.postMessage({ type: 'ring-handled', userId, key } satisfies TabMessage);
    } catch {
      /* the other tabs stop when the server ends the ring */
    }
  }
  stopRinging(key);
};

export const isRinging = () => !!ring?.playback;

// ── Alerts ────────────────────────────────────────────────────────────────
const memoryLog: { ids: Record<string, number>; last: number } = { ids: {}, last: 0 };
const logKey = () => `smartconnect:sound-log:${userId ?? 'anonymous'}`;
const readLog = (): { ids: Record<string, number>; last: number } => {
  try {
    const parsed = JSON.parse(localStorage.getItem(logKey()) ?? 'null');
    if (parsed && typeof parsed === 'object' && typeof parsed.last === 'number' && parsed.ids && typeof parsed.ids === 'object') return parsed;
  } catch {
    /* fall through */
  }
  return { ids: { ...memoryLog.ids }, last: memoryLog.last };
};
const writeLog = (log: { ids: Record<string, number>; last: number }) => {
  const now = Date.now();
  for (const [id, at] of Object.entries(log.ids)) if (now - at > PLAYED_TTL_MS) delete log.ids[id];
  memoryLog.ids = log.ids;
  memoryLog.last = log.last;
  try {
    localStorage.setItem(logKey(), JSON.stringify(log));
  } catch {
    /* memory copy only */
  }
};

/**
 * Records `eventId` as dealt with (by any of this user's tabs). Returns false
 * when it already was — or, with `throttle`, when another alert played too
 * recently.
 */
const claimEvent = (eventId: string, throttle: boolean) => {
  const log = readLog();
  const now = Date.now();
  if (log.ids[eventId]) return false;
  if (throttle && now - log.last < ALERT_GAP_MS) {
    log.ids[eventId] = now;
    writeLog(log);
    return false;
  }
  log.ids[eventId] = now;
  if (throttle) log.last = now;
  writeLog(log);
  return true;
};

/** The person is already looking at what `eventId` is about: no tab should chime for it. */
export const markAlertSeen = (eventId: string) => {
  claimEvent(eventId, false);
};

/** Plays the `category` alert once for `eventId` across this user's tabs. */
export const playAlert = (category: AlertCategory, eventId: string) => {
  const choice = soundChoice(getSoundPreferences(), category);
  if (!choice || inCallHere || ring || !soundReady()) return;
  const attempt = async () => {
    if (await busyElsewhere(true)) return;
    if (!claimEvent(eventId, true)) return;
    if (playSound(choice.sound, { volume: choice.volume })) await delay(ALERT_HOLD_MS);
  };
  const locks = lockManager();
  void (async () => {
    if (!isVisible()) await delay(HIDDEN_TAB_DELAY_MS);
    if (!locks) return attempt();
    await locks.request(lockName('alert'), { ifAvailable: true }, async (lock) => {
      if (lock) await attempt();
    });
  })().catch(() => undefined);
};

// ── Previews (settings) ───────────────────────────────────────────────────
let preview: { soundId: string; playback: Playback; timer: number } | null = null;
const previewListeners = new Set<() => void>();
const previewChanged = () => previewListeners.forEach((fn) => fn());

export const stopPreview = () => {
  if (!preview) return;
  window.clearTimeout(preview.timer);
  preview.playback.stop();
  preview = null;
  previewChanged();
};

/** How long a preview lasts: a ringtone about one cycle, an alert its own length. */
export const RINGTONE_PREVIEW_SECONDS = 3.5;

/**
 * Previews `soundId` at `volume` from a click (which also unlocks audio).
 * Returns false when nothing can play: the browser refuses, the volume is 0,
 * or a call is on.
 */
export const previewSound = async (soundId: string, volume: number) => {
  stopPreview();
  const sound = SOUNDS[soundId];
  if (inCallHere || !sound) return false;
  await unlockSound();
  const isRingtone = sound.kind === 'ringtone';
  const playback = playSound(soundId, { volume, loop: isRingtone });
  if (!playback) return false;
  const seconds = isRingtone ? RINGTONE_PREVIEW_SECONDS : Math.max(...sound.notes.map((n) => n.at + n.length)) + 0.1;
  preview = { soundId, playback, timer: window.setTimeout(stopPreview, seconds * 1000) };
  previewChanged();
  return true;
};

export const usePreviewingSound = () =>
  useSyncExternalStore(
    (fn) => {
      previewListeners.add(fn);
      return () => previewListeners.delete(fn);
    },
    () => preview?.soundId ?? null,
    () => null
  );

/** Test hook. */
export const resetSoundCoordinatorForTests = () => {
  stopRinging();
  stopPreview();
  setInCall(false);
  userId = null;
  memoryLog.ids = {};
  memoryLog.last = 0;
  handledListeners.clear();
  channel?.close();
  channel = null;
};
