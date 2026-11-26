import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUND_PREFERENCES, RING_CATEGORIES } from '../api/soundPreferences';
import { installUnlock, playSound, resetSoundEngineForTests, soundReady, unlockSound } from './engine';
import { ALERTS, NORMALIZED_PEAK, peakLevel, RINGTONES, SOUNDS, volumeToGain } from './library';

/**
 * The synthesized sound library and the Web Audio engine, against a fake
 * AudioContext (jsdom has none): browser autoplay blocking, unlocking on a
 * gesture, looping ringtones, one-shot alerts, stopping, and volume.
 */

class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class FakeNode {
  disconnected = false;
  connect<T>(node: T) {
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  startAt: number | null = null;
  stopAt: number | null = null;
  start(t: number) {
    this.startAt = t;
  }
  stop(t: number) {
    this.stopAt = t;
  }
}
class FakeAudioContext {
  static allowResume = true;
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  async resume() {
    if (FakeAudioContext.allowResume) this.state = 'running';
  }
}

const events: { action: string; sound: string; loop: boolean }[] = [];
const onSound = (e: Event) => events.push((e as CustomEvent).detail);
const ctx = () => FakeAudioContext.instances.at(-1)!;

beforeEach(() => {
  resetSoundEngineForTests();
  FakeAudioContext.allowResume = true;
  FakeAudioContext.instances = [];
  events.length = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  window.addEventListener('smartconnect:sound', onSound);
});
afterEach(() => {
  window.removeEventListener('smartconnect:sound', onSound);
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  vi.useRealTimers();
});

describe('sound library', () => {
  it('offers the same sounds the server accepts', () => {
    // backend/modules/users/soundPreferences.ts RINGTONE_IDS / ALERT_IDS
    expect(RINGTONES.map((s) => s.id)).toEqual(['aurora', 'pulse', 'marimba', 'bells', 'classic', 'soft']);
    expect(ALERTS.map((s) => s.id)).toEqual(['chime', 'pop', 'ping', 'drop', 'knock']);
    expect(RINGTONES.every((s) => s.kind === 'ringtone' && s.period)).toBe(true);
    expect(ALERTS.every((s) => s.kind === 'alert')).toBe(true);
  });

  it('every default names a sound of the right kind', () => {
    for (const [category, pref] of Object.entries(DEFAULT_SOUND_PREFERENCES.categories)) {
      const kind = (RING_CATEGORIES as readonly string[]).includes(category) ? 'ringtone' : 'alert';
      expect(SOUNDS[pref.sound]?.kind, category).toBe(kind);
    }
  });

  it('keeps sounds short and normalizable (consistent loudness)', () => {
    for (const sound of [...RINGTONES, ...ALERTS]) {
      const end = Math.max(...sound.notes.map((n) => n.at + n.length));
      if (sound.kind === 'ringtone') expect(end, sound.id).toBeLessThanOrEqual(sound.period!);
      else expect(end, sound.id).toBeLessThanOrEqual(1.5);
      const peak = peakLevel(sound);
      expect(Number.isFinite(peak) && peak > 0, sound.id).toBe(true);
      // After normalization every sound peaks at the same level.
      expect(peak * (NORMALIZED_PEAK / peak)).toBeCloseTo(NORMALIZED_PEAK);
    }
  });

  it('maps volume 0–100 to gain 0–1, monotonically, clamping out-of-range values', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(-5)).toBe(0);
    expect(volumeToGain(500)).toBe(1);
    for (let v = 5; v <= 100; v += 5) expect(volumeToGain(v)).toBeGreaterThan(volumeToGain(v - 5));
  });
});

describe('sound engine', () => {
  it('plays nothing (and does not throw) while the browser blocks audio', () => {
    expect(playSound('aurora', { volume: 70 })).toBeNull();
    expect(soundReady()).toBe(false);
    expect(ctx().oscillators).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('stays silent when the browser refuses to start audio', async () => {
    FakeAudioContext.allowResume = false;
    expect(await unlockSound()).toBe(false);
    expect(playSound('pop', { volume: 50 })).toBeNull();
  });

  it('unlocks on the first click or key press (autoplay policy), once', async () => {
    installUnlock();
    installUnlock();
    expect(soundReady()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(soundReady()).toBe(true));
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('plays an alert once at the chosen volume, then releases it', async () => {
    vi.useFakeTimers();
    await unlockSound();
    const playback = playSound('chime', { volume: 50 });
    expect(playback).not.toBeNull();
    const notes = SOUNDS.chime.notes;
    expect(ctx().oscillators).toHaveLength(notes.reduce((n, note) => n + (note.partials?.length ?? 1), 0));
    // The first gain created is the master: the user's volume.
    expect(ctx().gains[0].gain.value).toBeCloseTo(volumeToGain(50));
    expect(events).toEqual([{ action: 'start', sound: 'chime', loop: false }]);
    vi.advanceTimersByTime(2000);
    expect(events.at(-1)).toEqual({ action: 'stop', sound: 'chime', loop: false });
  });

  it('loops a ringtone until stopped, then stops every note and schedules no more', async () => {
    vi.useFakeTimers();
    await unlockSound();
    const playback = playSound('aurora', { volume: 70, loop: true })!;
    const perCycle = ctx().oscillators.length;
    expect(perCycle).toBeGreaterThan(0);
    vi.advanceTimersByTime(SOUNDS.aurora.period! * 1000);
    expect(ctx().oscillators.length).toBe(perCycle * 2);
    vi.advanceTimersByTime(20_000);
    expect(ctx().oscillators.length).toBeGreaterThan(perCycle * 2);
    // Never stopped on its own.
    expect(events.filter((e) => e.action === 'stop')).toEqual([]);

    playback.stop();
    playback.stop(); // idempotent
    const count = ctx().oscillators.length;
    expect(ctx().oscillators.every((o) => o.stopAt !== null)).toBe(true);
    expect(events.filter((e) => e.action === 'stop')).toEqual([{ action: 'stop', sound: 'aurora', loop: true }]);
    vi.advanceTimersByTime(30_000);
    expect(ctx().oscillators.length).toBe(count);
  });

  it('plays nothing for volume 0, an unknown sound, or a browser without Web Audio', async () => {
    await unlockSound();
    expect(playSound('aurora', { volume: 0 })).toBeNull();
    expect(playSound('no-such-sound', { volume: 50 })).toBeNull();
    resetSoundEngineForTests();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    expect(await unlockSound()).toBe(false);
    expect(playSound('aurora', { volume: 50 })).toBeNull();
  });
});
