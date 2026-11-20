import axios from 'axios';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { displayNameOf, updatePerson } from '../../lib/people';
import { UserProfileSettings } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';

/** QA H4: what the server accepts as a profile photo (users.service.ts). */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const photoProblem = (file: { type: string; size: number }) =>
  !PHOTO_TYPES.includes(file.type) ? 'Choose a JPEG, PNG, WebP or GIF image.' : file.size > PHOTO_MAX_BYTES ? 'Choose an image of 5 MB or less.' : null;

interface ProfileSettingsModalProps {
  onClose: () => void;
}

const timeZones = (): string[] => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
};

/**
 * Profile (QA H4: display name and photo; title, bio, time zone) and
 * preferences (read receipts). Login credentials (e-mail, username, password)
 * are intentionally not editable here.
 */
export const ProfileSettingsModal = ({ onClose }: ProfileSettingsModalProps) => {
  const { user } = useAuth();
  const [form, setForm] = useState<UserProfileSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(timeZones, []);
  // QA H4: a newly chosen photo, uploaded on Save; `removePhoto` clears the current one.
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.preview);
  }, [photo]);

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setRemovePhoto(false);
    setPhoto({ file, preview: URL.createObjectURL(file) });
  };

  useEffect(() => {
    axios
      .get<UserProfileSettings>('/api/users/me/profile')
      .then((res) => setForm(res.data))
      .catch(() => setError('Could not load your profile.'));
  }, []);

  const update = <K extends keyof UserProfileSettings>(key: K, value: UserProfileSettings[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      let avatarId: string | null | undefined;
      if (photo) {
        const body = new FormData();
        body.append('attachment', photo.file);
        const uploaded = await axios.post<{ id: string }>('/api/upload', body);
        avatarId = uploaded.data.id;
      } else if (removePhoto) {
        avatarId = null;
      }
      const res = await axios.patch<UserProfileSettings>('/api/users/me/profile', {
        displayName: form.displayName ?? '',
        title: form.title ?? '',
        bio: form.bio ?? '',
        timezone: form.timezone ?? '',
        readReceiptsEnabled: form.readReceiptsEnabled,
        ...(avatarId !== undefined ? { avatarId } : {}),
      });
      setForm(res.data);
      // Every screen shows the new name, title and photo at once (lib/people).
      if (user) updatePerson(user.id, { displayName: res.data.displayName, title: res.data.title, avatarId: res.data.avatarId });
      toast.success('Profile saved');
      onClose();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100';

  return (
    <Modal
      title="Profile & preferences"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!form || saving}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Save
          </button>
        </>
      }
    >
      {!form && !error && (
        <p className="py-8 flex justify-center text-gray-400" role="status">
          <Loader2 className="animate-spin" size={20} aria-label="Loading profile" />
        </p>
      )}
      {error && (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {form && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {photo ? (
              <img src={photo.preview} alt="New profile photo" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <Avatar name={displayNameOf({ username: user?.username, displayName: form.displayName })} userId={user?.id} avatarId={removePhoto ? null : form.avatarId} size="lg" />
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={PHOTO_TYPES.join(',')}
                className="sr-only"
                id="profile-photo"
                onChange={(e) => {
                  choosePhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-fg hover:bg-surface-secondary">
                <ImagePlus size={15} aria-hidden="true" /> {form.avatarId || photo ? 'Change photo' : 'Add photo'}
              </button>
              {(photo || (form.avatarId && !removePhoto)) && (
                <button
                  type="button"
                  onClick={() => {
                    setPhoto(null);
                    setRemovePhoto(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-fg-muted hover:bg-surface-secondary"
                >
                  <Trash2 size={15} aria-hidden="true" /> Remove photo
                </button>
              )}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Name</span>
            <input
              value={form.displayName ?? ''}
              onChange={(e) => update('displayName', e.target.value)}
              maxLength={80}
              autoComplete="name"
              placeholder={user?.username}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-gray-500">Shown to people in your workspaces. Your username stays @{user?.username}.</span>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Title</span>
            <input value={form.title ?? ''} onChange={(e) => update('title', e.target.value)} maxLength={80} placeholder="e.g. Product Designer" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">About</span>
            <textarea value={form.bio ?? ''} onChange={(e) => update('bio', e.target.value)} maxLength={500} rows={3} className={`${inputClass} resize-none`} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Time zone</span>
            {zones.length > 0 ? (
              <select value={form.timezone ?? ''} onChange={(e) => update('timezone', e.target.value || null)} className={inputClass}>
                <option value="">Not set</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            ) : (
              <input value={form.timezone ?? ''} onChange={(e) => update('timezone', e.target.value)} placeholder="e.g. Asia/Kolkata" className={inputClass} />
            )}
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.readReceiptsEnabled}
              onChange={(e) => update('readReceiptsEnabled', e.target.checked)}
            />
            <span>
              <span className="block text-sm font-semibold text-gray-900">Read receipts</span>
              <span className="block text-xs text-gray-500">
                Let people in direct messages see when you've read their messages. If you turn this off, you won't see theirs either.
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
};
