import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/http';
import { DEFAULT_SOUND_PREFERENCES, SoundPreferences } from '../../lib/api/soundPreferences';
import { getSoundPreferences } from '../../lib/sounds/preferences';
import { SoundSettingsModal } from './SoundSettingsModal';

/**
 * "Call & notification sounds": shows the saved choices, changes each
 * category (on/off, sound, volume) and Do Not Disturb, previews, saves to the
 * account only on Save, restores the defaults, and reports failures.
 */

const h = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
  plays: [] as { sound: string; volume: number; stopped: boolean; stop: () => void }[],
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'mia' } }) }));
vi.mock('../../lib/api/soundPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/soundPreferences')>()),
  soundPreferencesApi: { get: h.get, save: h.save, reset: h.reset },
}));
vi.mock('../../lib/sounds/engine', () => ({
  soundReady: () => true,
  unlockSound: async () => true,
  playSound: (sound: string, { volume }: { volume: number }) => {
    if (volume <= 0) return null;
    const p = { sound, volume, stopped: false, stop: () => void (p.stopped = true) };
    h.plays.push(p);
    return p;
  },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const viewOf = (preferences: SoundPreferences, isDefault = false) => ({ preferences, isDefault, defaults: DEFAULT_SOUND_PREFERENCES });
const saved = () => {
  const p = structuredClone(DEFAULT_SOUND_PREFERENCES);
  p.categories.groupCall.enabled = false;
  p.categories.mention = { enabled: true, sound: 'knock', volume: 80 };
  return p;
};

const open = async () => {
  const onClose = vi.fn();
  render(<SoundSettingsModal onClose={onClose} />);
  await screen.findByText('Audio calls');
  return onClose;
};
const row = (title: string) => screen.getByText(title).closest('li')!;

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(viewOf(saved()));
  h.save.mockReset().mockImplementation(async (p: SoundPreferences) => viewOf(p));
  h.reset.mockReset().mockResolvedValue(viewOf(DEFAULT_SOUND_PREFERENCES, true));
  h.plays = [];
});

describe('SoundSettingsModal', () => {
  it('shows every category with the saved choices', async () => {
    await open();
    expect(screen.getByRole('dialog', { name: 'Call & notification sounds' })).toBeInTheDocument();
    for (const title of ['Audio calls', 'Video calls', 'Group calls', 'Meeting reminders', 'Direct messages', 'Mentions']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(within(row('Mentions')).getByRole('combobox')).toHaveValue('knock');
    expect(within(row('Mentions')).getByRole('slider')).toHaveValue('80');
    // Switched off: no sound controls.
    expect(within(row('Group calls')).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(within(row('Group calls')).queryByRole('combobox')).toBeNull();
    // Ringtones for calls, alert sounds for notifications.
    expect(within(row('Audio calls')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Aurora', 'Pulse', 'Marimba', 'Bells', 'Classic', 'Soft']);
    expect(within(row('Direct messages')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Chime', 'Pop', 'Ping', 'Drop', 'Knock']);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves every change on Save, and the app uses them at once', async () => {
    const onClose = await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Do not disturb' }));
    fireEvent.change(within(row('Video calls')).getByRole('combobox'), { target: { value: 'bells' } });
    fireEvent.change(within(row('Video calls')).getByRole('slider'), { target: { value: '35' } });
    fireEvent.click(within(row('Group calls')).getByRole('switch'));
    fireEvent.click(within(row('Direct messages')).getByRole('switch'));
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const expected = saved();
    expected.doNotDisturb = true;
    expected.categories.oneToOneVideo = { enabled: true, sound: 'bells', volume: 35 };
    expected.categories.groupCall.enabled = true;
    expected.categories.directMessage.enabled = false;
    expect(h.save).toHaveBeenCalledWith(expected);
    expect(h.reset).not.toHaveBeenCalled();
    expect(getSoundPreferences()).toEqual(expected);
  });

  it('Restore defaults, then Save, clears the saved choices', async () => {
    const onClose = await open();
    fireEvent.click(screen.getByRole('button', { name: /Restore defaults/ }));
    expect(within(row('Mentions')).getByRole('combobox')).toHaveValue('ping');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('previews the chosen sound at the chosen volume, and stops it', async () => {
    await open();
    const mentions = row('Mentions');
    await act(async () => {
      fireEvent.click(within(mentions).getByRole('button', { name: 'Play Knock' }));
    });
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'knock', volume: 80 })]);
    fireEvent.click(await within(mentions).findByRole('button', { name: 'Stop Knock' }));
    expect(h.plays[0].stopped).toBe(true);
    // Nothing to hear at volume 0.
    fireEvent.change(within(mentions).getByRole('slider'), { target: { value: '0' } });
    expect(within(mentions).getByRole('button', { name: 'Play Knock' })).toBeDisabled();
  });

  it('keeps the dialog open with the reason when saving fails', async () => {
    h.save.mockRejectedValueOnce(new ApiError('Too many profile updates. Please slow down.', 429));
    const onClose = await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Do not disturb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many profile updates');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when the settings cannot be loaded', async () => {
    h.get.mockRejectedValueOnce(new ApiError('Network error — check your connection and try again.', null));
    render(<SoundSettingsModal onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(screen.queryByText('Audio calls')).toBeNull();
  });
});
