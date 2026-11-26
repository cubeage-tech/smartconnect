import { NORMALIZED_PEAK, peakLevel, SoundDefinition, SOUNDS, volumeToGain } from './library';

/**
 * Plays the synthesized sounds (library.ts) through ONE AudioContext,
 * separate from anything a call uses (calls play remote audio through media
 * elements and only analyse levels with their own contexts), so a ringtone
 * or alert never touches call audio.
 *
 * Browser autoplay rules: an AudioContext may only start after the page had a
 * user gesture. The engine is created lazily, resumed on the first pointer or
 * key press (installUnlock), and play() simply returns null — no sound, no
 * error — while the browser still blocks it. The incoming-call banner and
 * toasts remain the visible signal.
 *
 * Every start and stop is announced as a `smartconnect:sound` window event
 * ({ action, sound, loop }), which tests use to observe playback.
 */

export interface Playback {
  stop: () => void;
}

type Ctor = typeof AudioContext;
const audioContextCtor = (): Ctor | null =>
  typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null);

const announce = (action: 'start' | 'stop', sound: string, loop: boolean) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('smartconnect:sound', { detail: { action, sound, loop } }));
};

let context: AudioContext | null = null;
let output: AudioNode | null = null;

const getContext = (): AudioContext | null => {
  if (context) return context;
  const C = audioContextCtor();
  if (!C) return null;
  try {
    context = new C();
    // A gentle limiter: overlapping notes or a loud setting never clip.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    limiter.connect(context.destination);
    output = limiter;
  } catch {
    context = null;
  }
  return context;
};

/** Whether sounds can play right now (the browser allowed audio in this tab). */
export const soundReady = () => context?.state === 'running';

/** Tries to start audio; call from a user gesture. */
export const unlockSound = async () => {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* still blocked */
    }
  }
  return soundReady();
};

let unlockInstalled = false;
/** Resumes audio on the first pointer or key press anywhere (autoplay policy). Idempotent. */
export const installUnlock = () => {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const once = () => {
    void unlockSound().then((ready) => {
      if (ready) {
        window.removeEventListener('pointerdown', once, true);
        window.removeEventListener('keydown', once, true);
      }
    });
  };
  window.addEventListener('pointerdown', once, true);
  window.addEventListener('keydown', once, true);
};

/** Schedules one cycle of `sound` at time `t0` into `destination`; returns the nodes to stop. */
const scheduleCycle = (ctx: AudioContext, sound: SoundDefinition, t0: number, destination: AudioNode) => {
  const nodes: OscillatorNode[] = [];
  const scale = NORMALIZED_PEAK / peakLevel(sound);
  for (const note of sound.notes) {
    const start = t0 + note.at;
    const end = start + note.length;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime((note.gain ?? 1) * scale, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(destination);
    for (const partial of note.partials ?? [{ ratio: 1, gain: 1 }]) {
      const osc = ctx.createOscillator();
      osc.type = partial.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq * partial.ratio, start);
      if (note.glideTo) osc.frequency.exponentialRampToValueAtTime(note.freq * partial.ratio * note.glideTo, end);
      const g = ctx.createGain();
      g.gain.value = partial.gain;
      osc.connect(g).connect(envelope);
      osc.start(start);
      osc.stop(end + 0.02);
      nodes.push(osc);
    }
  }
  return nodes;
};

/**
 * Plays `soundId` at `volume` (0–100); a ringtone loops until stop() when
 * `loop` is set. Returns null when nothing can play (unknown sound, volume 0,
 * no Web Audio, or audio still blocked by the browser).
 */
export const playSound = (soundId: string, { volume, loop = false }: { volume: number; loop?: boolean }): Playback | null => {
  const sound = SOUNDS[soundId];
  if (!sound || volume <= 0) return null;
  const ctx = getContext();
  if (!ctx || !output || ctx.state !== 'running') return null;

  const master = ctx.createGain();
  master.gain.value = volumeToGain(volume);
  master.connect(output);
  let nodes: OscillatorNode[] = scheduleCycle(ctx, sound, ctx.currentTime + 0.02, master);
  let timer: number | undefined;
  let stopped = false;

  const cycleSeconds = sound.period ?? Math.max(...sound.notes.map((n) => n.at + n.length));
  if (loop && sound.kind === 'ringtone') {
    let next = ctx.currentTime + 0.02 + cycleSeconds;
    // Schedule each cycle shortly before it is due (keeps few nodes alive).
    const tick = () => {
      if (stopped) return;
      nodes = nodes.concat(scheduleCycle(ctx, sound, next, master));
      next += cycleSeconds;
      timer = window.setTimeout(tick, Math.max(50, (next - ctx.currentTime - 0.5) * 1000));
    };
    timer = window.setTimeout(tick, Math.max(50, (next - ctx.currentTime - 0.5) * 1000));
  }
  announce('start', soundId, loop);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    // A 40 ms fade instead of a click, then everything is released.
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.04);
    for (const osc of nodes) {
      try {
        osc.stop(now + 0.05);
      } catch {
        /* already stopped */
      }
    }
    window.setTimeout(() => master.disconnect(), 100);
    nodes = [];
    announce('stop', soundId, loop);
  };
  if (!loop) window.setTimeout(() => !stopped && stop(), cycleSeconds * 1000 + 100);
  return { stop };
};

/** Test hook: forget the shared context (jsdom tests install a fake AudioContext). */
export const resetSoundEngineForTests = () => {
  context = null;
  output = null;
  unlockInstalled = false;
};
