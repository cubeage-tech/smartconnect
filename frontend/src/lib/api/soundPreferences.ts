import { http } from './http';

/**
 * Personal call and notification sounds (backend/modules/users/soundPreferences.ts).
 * Always the signed-in user's own: the endpoints take no user id.
 */

export const RING_CATEGORIES = ['oneToOneAudio', 'oneToOneVideo', 'groupCall'] as const;
export const ALERT_CATEGORIES = ['meetingReminder', 'directMessage', 'mention'] as const;
export type RingCategory = (typeof RING_CATEGORIES)[number];
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type SoundCategory = RingCategory | AlertCategory;

export interface CategoryPreference {
  enabled: boolean;
  sound: string;
  /** 0–100. */
  volume: number;
}

export interface SoundPreferences {
  doNotDisturb: boolean;
  categories: Record<SoundCategory, CategoryPreference>;
}

export interface SoundPreferencesView {
  preferences: SoundPreferences;
  /** Nothing saved yet: the defaults apply. */
  isDefault: boolean;
  defaults: SoundPreferences;
}

/** Same as the server's defaults; used until the server's copy has loaded. */
export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  doNotDisturb: false,
  categories: {
    oneToOneAudio: { enabled: true, sound: 'aurora', volume: 70 },
    oneToOneVideo: { enabled: true, sound: 'marimba', volume: 70 },
    groupCall: { enabled: true, sound: 'pulse', volume: 60 },
    meetingReminder: { enabled: true, sound: 'chime', volume: 60 },
    directMessage: { enabled: true, sound: 'pop', volume: 50 },
    mention: { enabled: true, sound: 'ping', volume: 60 },
  },
};

const PATH = '/api/users/me/sound-preferences';

export const soundPreferencesApi = {
  get: () => http.get<SoundPreferencesView>(PATH),
  save: (preferences: SoundPreferences) => http.put<SoundPreferencesView>(PATH, preferences),
  reset: () => http.delete<SoundPreferencesView>(PATH),
};
