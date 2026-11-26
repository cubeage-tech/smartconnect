/**
 * SmartConnect's sound library: original tones synthesized in the browser
 * with the Web Audio API (no audio files to download or license). Ringtones
 * loop while a call rings; alerts play once.
 *
 * Every sound is a short score of notes. Each note is a sum of sine/triangle
 * partials with a fast attack and an exponential decay. Scores are normalized
 * to the same peak (NORMALIZED_PEAK), so a given volume sounds equally loud
 * whichever sound is chosen. Ids must match backend/modules/users/soundPreferences.ts.
 */

export interface SoundPartial {
  /** Multiple of the note frequency. */
  ratio: number;
  gain: number;
  type?: OscillatorType;
}

export interface Note {
  /** Hz. */
  freq: number;
  /** Seconds from the start of one cycle. */
  at: number;
  /** Seconds until the note has faded out. */
  length: number;
  /** Relative loudness before normalization. */
  gain?: number;
  partials?: SoundPartial[];
  /** Pitch glide over the note (multiplier reached at the end), e.g. a water drop. */
  glideTo?: number;
}

export interface SoundDefinition {
  id: string;
  label: string;
  kind: 'ringtone' | 'alert';
  notes: Note[];
  /** Ringtones: seconds between the starts of two cycles. */
  period?: number;
}

/** Every sound peaks at this linear gain before the user's volume. */
export const NORMALIZED_PEAK = 0.32;

const SOFT: SoundPartial[] = [{ ratio: 1, gain: 1 }, { ratio: 2, gain: 0.18, type: 'triangle' }];
const MARIMBA: SoundPartial[] = [{ ratio: 1, gain: 1 }, { ratio: 4, gain: 0.35 }, { ratio: 9.2, gain: 0.08 }];
const BELL: SoundPartial[] = [{ ratio: 1, gain: 1 }, { ratio: 2.0, gain: 0.5 }, { ratio: 3.0, gain: 0.28 }, { ratio: 4.2, gain: 0.16 }, { ratio: 5.4, gain: 0.08 }];
const PLAIN: SoundPartial[] = [{ ratio: 1, gain: 1 }];
const TRI: SoundPartial[] = [{ ratio: 1, gain: 1, type: 'triangle' }];

// Note frequencies (equal temperament, A4 = 440 Hz).
const N = { C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5, G6: 1567.98 };

export const RINGTONES: SoundDefinition[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    kind: 'ringtone',
    period: 3.2,
    notes: [N.C5, N.E5, N.G5, N.C6].map((freq, i) => ({ freq, at: i * 0.16, length: 0.9, partials: SOFT })),
  },
  {
    id: 'pulse',
    label: 'Pulse',
    kind: 'ringtone',
    period: 2.6,
    notes: [0, 0.3, 0.9, 1.2].map((at, i) => ({ freq: i % 2 ? N.E5 : N.A4, at, length: 0.26, partials: TRI })),
  },
  {
    id: 'marimba',
    label: 'Marimba',
    kind: 'ringtone',
    period: 3.0,
    notes: [N.G5, N.E5, N.C5, N.D5, N.E5].map((freq, i) => ({ freq, at: i * 0.18, length: 0.55, partials: MARIMBA })),
  },
  {
    id: 'bells',
    label: 'Bells',
    kind: 'ringtone',
    period: 3.0,
    notes: [
      { freq: N.E5, at: 0, length: 1.4, partials: BELL },
      { freq: N.C5, at: 0.45, length: 1.6, partials: BELL },
    ],
  },
  {
    id: 'classic',
    label: 'Classic',
    kind: 'ringtone',
    period: 3.0,
    // The two-tone "phone ring" (440 + 480 Hz), twice.
    notes: [0, 0.55].flatMap((at) => [
      { freq: 440, at, length: 0.42, partials: PLAIN, gain: 0.8 },
      { freq: 480, at, length: 0.42, partials: PLAIN, gain: 0.8 },
    ]),
  },
  {
    id: 'soft',
    label: 'Soft',
    kind: 'ringtone',
    period: 3.6,
    notes: [
      { freq: N.C4, at: 0, length: 1.6, partials: SOFT },
      { freq: N.E4, at: 0.05, length: 1.6, partials: SOFT },
      { freq: N.G4, at: 0.1, length: 1.6, partials: SOFT },
    ],
  },
];

export const ALERTS: SoundDefinition[] = [
  {
    id: 'chime',
    label: 'Chime',
    kind: 'alert',
    notes: [
      { freq: N.C6, at: 0, length: 0.6, partials: BELL },
      { freq: N.G6, at: 0.14, length: 0.8, partials: BELL },
    ],
  },
  { id: 'pop', label: 'Pop', kind: 'alert', notes: [{ freq: N.A5, at: 0, length: 0.14, partials: PLAIN, glideTo: 0.6 }] },
  { id: 'ping', label: 'Ping', kind: 'alert', notes: [{ freq: N.E6, at: 0, length: 0.45, partials: TRI }] },
  { id: 'drop', label: 'Drop', kind: 'alert', notes: [{ freq: 1200, at: 0, length: 0.25, partials: PLAIN, glideTo: 0.35 }] },
  {
    id: 'knock',
    label: 'Knock',
    kind: 'alert',
    notes: [
      { freq: 190, at: 0, length: 0.12, partials: MARIMBA },
      { freq: 190, at: 0.16, length: 0.12, partials: MARIMBA },
    ],
  },
];

export const SOUNDS: Record<string, SoundDefinition> = Object.fromEntries([...RINGTONES, ...ALERTS].map((s) => [s.id, s]));

/** Loudest instant of one cycle (notes overlap), used to normalize every sound to NORMALIZED_PEAK. */
export const peakLevel = (sound: SoundDefinition) => {
  let peak = 0;
  for (const t of sound.notes.map((n) => n.at)) {
    const level = sound.notes
      .filter((n) => n.at <= t && t < n.at + n.length)
      .reduce((sum, n) => sum + (n.gain ?? 1) * (n.partials ?? PLAIN).reduce((s, p) => s + p.gain, 0) * Math.exp(-4 * ((t - n.at) / n.length)), 0);
    peak = Math.max(peak, level);
  }
  return peak || 1;
};

/** User volume 0–100 → linear gain (squared: perceptually even steps). */
export const volumeToGain = (volume: number) => {
  const v = Math.min(100, Math.max(0, volume)) / 100;
  return v * v;
};
