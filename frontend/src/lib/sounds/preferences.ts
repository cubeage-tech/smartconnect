import { useSyncExternalStore } from 'react';
import { DEFAULT_SOUND_PREFERENCES, SoundPreferences, soundPreferencesApi, SoundPreferencesView } from '../api/soundPreferences';

/**
 * The signed-in user's sound preferences for this page: loaded once per user
 * from the server (the only place they are stored), replaced by whatever the
 * settings dialog saves, and kept in step across this browser's tabs (a save
 * in one tab is broadcast to the others, for the same user only). Until the
 * server answers — or if it can't — the defaults apply.
 */

interface State {
  userId: string | null;
  preferences: SoundPreferences;
  defaults: SoundPreferences;
  isDefault: boolean;
  loaded: boolean;
}

const initial = (): State => ({
  userId: null,
  preferences: DEFAULT_SOUND_PREFERENCES,
  defaults: DEFAULT_SOUND_PREFERENCES,
  isDefault: true,
  loaded: false,
});

let state: State = initial();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

// Another tab saved or reset (never its own messages: BroadcastChannel skips the sender).
let channel: BroadcastChannel | null = null;
const getChannel = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel('smartconnect:sound-preferences');
    channel.onmessage = (event: MessageEvent<{ userId?: string; view?: SoundPreferencesView }>) => {
      const { userId, view } = event.data ?? {};
      if (userId && view && userId === state.userId) apply(userId, view);
    };
  } catch {
    channel = null;
  }
  return channel;
};

export const isSoundPreferences = (value: unknown): value is SoundPreferences => {
  const p = value as SoundPreferences | null;
  return !!p && typeof p === 'object' && typeof p.doNotDisturb === 'boolean' && !!p.categories && typeof p.categories === 'object' &&
    Object.keys(DEFAULT_SOUND_PREFERENCES.categories).every((k) => {
      const c = p.categories[k as keyof SoundPreferences['categories']];
      return !!c && typeof c.enabled === 'boolean' && typeof c.sound === 'string' && typeof c.volume === 'number';
    });
};

/** Applies a server answer; anything malformed keeps the defaults. */
const apply = (userId: string, view: SoundPreferencesView) => {
  if (!view || !isSoundPreferences(view.preferences)) {
    console.warn('Unexpected sound preferences from the server; using the defaults.');
    return;
  }
  state = {
    userId,
    preferences: view.preferences,
    defaults: isSoundPreferences(view.defaults) ? view.defaults : DEFAULT_SOUND_PREFERENCES,
    isDefault: view.isDefault === true,
    loaded: true,
  };
  emit();
};

let loading: { userId: string; promise: Promise<void> } | null = null;

/** Loads `userId`'s preferences unless already loaded (or loading) for them. */
export const loadSoundPreferences = (userId: string): Promise<void> => {
  getChannel();
  if (state.userId === userId && state.loaded) return Promise.resolve();
  if (loading?.userId === userId) return loading.promise;
  if (state.userId !== userId) {
    state = { ...initial(), userId };
    emit();
  }
  const promise = soundPreferencesApi
    .get()
    .then((view) => {
      if (state.userId === userId) apply(userId, view);
    })
    .catch((err) => console.warn('Could not load sound preferences; using the defaults.', err))
    .finally(() => {
      if (loading?.promise === promise) loading = null;
    });
  loading = { userId, promise };
  return promise;
};

/** Signed out: back to the defaults, nobody's choices kept in memory. */
export const clearSoundPreferences = () => {
  loading = null;
  state = initial();
  emit();
};

/** Applies what the server returned after a save or reset, here and in this user's other tabs. */
export const publishSoundPreferences = (userId: string, view: SoundPreferencesView) => {
  if (state.userId && state.userId !== userId) return;
  apply(userId, view);
  try {
    getChannel()?.postMessage({ userId, view });
  } catch {
    /* other tabs pick it up on their next load */
  }
};

export const getSoundPreferences = () => state.preferences;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useSoundPreferencesState = () => useSyncExternalStore(subscribe, () => state, () => state);

/** Test hook. */
export const resetSoundPreferencesForTests = () => {
  clearSoundPreferences();
  channel?.close();
  channel = null;
};
