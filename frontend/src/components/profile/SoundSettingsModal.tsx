import { BellOff, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage } from '../../lib/api/http';
import {
  ALERT_CATEGORIES,
  CategoryPreference,
  RING_CATEGORIES,
  SoundCategory,
  SoundPreferences,
  soundPreferencesApi,
} from '../../lib/api/soundPreferences';
import { previewSound, stopPreview, useInCall, usePreviewingSound } from '../../lib/sounds/coordinator';
import { ALERTS, RINGTONES } from '../../lib/sounds/library';
import { isSoundPreferences, publishSoundPreferences } from '../../lib/sounds/preferences';
import { Button, focusRing } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { LoadingState } from '../ui/States';

const LABELS: Record<SoundCategory, { title: string; hint: string }> = {
  oneToOneAudio: { title: 'Audio calls', hint: 'Someone calls you directly.' },
  oneToOneVideo: { title: 'Video calls', hint: 'Someone video calls you directly.' },
  groupCall: { title: 'Group calls', hint: 'A call starts in a group conversation or channel.' },
  meetingReminder: { title: 'Meeting reminders', hint: 'Shortly before a scheduled meeting starts.' },
  directMessage: { title: 'Direct messages', hint: 'A new message in a direct conversation.' },
  mention: { title: 'Mentions', hint: 'Someone @mentions you.' },
};

const isRing = (category: SoundCategory) => (RING_CATEGORIES as readonly string[]).includes(category);
const same = (a: SoundPreferences, b: SoundPreferences) => JSON.stringify(a) === JSON.stringify(b);

/** An accessible on/off switch (role="switch"). */
const Switch = ({ checked, onChange, label, describedBy }: { checked: boolean; onChange: (next: boolean) => void; label: string; describedBy?: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-describedby={describedBy}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${focusRing} ${checked ? 'bg-brand' : 'bg-border-strong'}`}
  >
    <span
      aria-hidden="true"
      className={`inline-block h-5 w-5 rounded-full bg-surface shadow-sm transition-transform motion-reduce:transition-none ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
    />
  </button>
);

interface RowProps {
  category: SoundCategory;
  value: CategoryPreference;
  onChange: (next: CategoryPreference) => void;
  previewing: string | null;
  inCall: boolean;
  onPreviewFailed: () => void;
}

const CategoryRow = ({ category, value, onChange, previewing, inCall, onPreviewFailed }: RowProps) => {
  const id = useId();
  const { title, hint } = LABELS[category];
  const options = isRing(category) ? RINGTONES : ALERTS;
  const playing = previewing === value.sound;
  const soundName = options.find((o) => o.id === value.sound)?.label ?? value.sound;
  return (
    <li className="py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p id={`${id}-title`} className="text-sm font-semibold text-fg">
            {title}
          </p>
          <p id={`${id}-hint`} className="text-xs text-fg-subtle">
            {hint}
          </p>
        </div>
        <Switch checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label={`${title} sound`} describedBy={`${id}-hint`} />
      </div>
      {value.enabled && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor={`${id}-sound`} className="sr-only">
              {title} sound
            </label>
            <select
              id={`${id}-sound`}
              value={value.sound}
              onChange={(e) => {
                stopPreview();
                onChange({ ...value, sound: e.target.value });
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand-muted"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-[5.25rem] shrink-0"
              disabled={inCall || value.volume === 0}
              aria-label={playing ? `Stop ${soundName}` : `Play ${soundName}`}
              icon={playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              onClick={async () => {
                if (playing) return stopPreview();
                if (!(await previewSound(value.sound, value.volume))) onPreviewFailed();
              }}
            >
              {playing ? 'Stop' : 'Play'}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor={`${id}-volume`} className="shrink-0 text-xs font-medium text-fg-muted">
              Volume
            </label>
            <input
              id={`${id}-volume`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={value.volume}
              aria-valuetext={`${value.volume}%`}
              onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
              onPointerUp={() => playing && stopPreview()}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand"
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted" aria-hidden="true">
              {value.volume}%
            </span>
          </div>
        </div>
      )}
    </li>
  );
};

/**
 * Personal call and notification sounds: ringtones for direct audio and video
 * calls and for group calls, alert sounds for meeting reminders, direct
 * messages and mentions — each with on/off, a choice of sound, a preview and
 * a volume — plus Do Not Disturb and a way back to the defaults. Saved to the
 * account (every device), only on Save.
 */
export const SoundSettingsModal = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [saved, setSaved] = useState<SoundPreferences | null>(null);
  const [form, setForm] = useState<SoundPreferences | null>(null);
  const [defaults, setDefaults] = useState<SoundPreferences | null>(null);
  // "Restore defaults" was chosen and nothing changed since: Save clears the saved choices.
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const previewing = usePreviewingSound();
  const inCall = useInCall();

  useEffect(() => {
    let live = true;
    soundPreferencesApi
      .get()
      .then((view) => {
        if (!live) return;
        if (!isSoundPreferences(view?.preferences) || !isSoundPreferences(view.defaults)) throw new Error('Unexpected response');
        setSaved(view.preferences);
        setForm(view.preferences);
        setDefaults(view.defaults);
      })
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load your sound settings.')));
    return () => {
      live = false;
      stopPreview();
    };
  }, []);

  const change = (next: SoundPreferences) => {
    setForm(next);
    setRestoring(false);
    setSaveError(null);
  };
  const setCategory = (category: SoundCategory, value: CategoryPreference) =>
    form && change({ ...form, categories: { ...form.categories, [category]: value } });

  const dirty = !!form && !!saved && (!same(form, saved) || restoring);

  const save = async () => {
    if (!form || !user) return;
    setSaving(true);
    setSaveError(null);
    stopPreview();
    try {
      const view = restoring && defaults && same(form, defaults) ? await soundPreferencesApi.reset() : await soundPreferencesApi.save(form);
      publishSoundPreferences(user.id, view);
      toast.success('Sound settings saved');
      onClose();
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save your sound settings. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const section = (heading: string, categories: readonly SoundCategory[]) => (
    <section aria-label={heading}>
      <h3 className="pt-2 text-sm font-semibold text-fg">{heading}</h3>
      <ul className="divide-y divide-line">
        {form &&
          categories.map((category) => (
            <CategoryRow
              key={category}
              category={category}
              value={form.categories[category]}
              onChange={(value) => setCategory(category, value)}
              previewing={previewing}
              inCall={inCall}
              onPreviewFailed={() => setNotice('Your browser didn’t play the sound. Check that this device isn’t muted, then try again.')}
            />
          ))}
      </ul>
    </section>
  );

  return (
    <Modal
      title="Call & notification sounds"
      subtitle="Saved to your account, so they apply on every device."
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            className="mr-auto"
            disabled={!form || !defaults || (same(form, defaults) && !dirty)}
            icon={<RotateCcw size={15} aria-hidden="true" />}
            onClick={() => {
              if (!defaults) return;
              stopPreview();
              setForm(defaults);
              setRestoring(true);
              setSaveError(null);
            }}
          >
            Restore defaults
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </div>
      }
    >
      {loadError && (
        <p className="py-6 text-sm text-danger" role="alert">
          {loadError}
        </p>
      )}
      {!form && !loadError && <LoadingState label="Loading your sound settings" />}
      {form && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-secondary p-3.5">
            <BellOff size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">Do not disturb</p>
              <p id="sounds-dnd-hint" className="text-xs text-fg-subtle">
                Silences every ringtone and alert. Calls, messages and reminders still show on screen.
              </p>
            </div>
            <Switch checked={form.doNotDisturb} onChange={(doNotDisturb) => change({ ...form, doNotDisturb })} label="Do not disturb" describedBy="sounds-dnd-hint" />
          </div>
          {inCall && <p className="text-xs text-fg-muted">Previews are paused while you’re in a call.</p>}
          {notice && (
            <p className="text-xs text-fg-muted" role="status">
              {notice}
            </p>
          )}
          {section('Calls', RING_CATEGORIES)}
          {section('Notifications', ALERT_CATEGORIES)}
          {saveError && (
            <p className="text-sm text-danger" role="alert">
              {saveError}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};
