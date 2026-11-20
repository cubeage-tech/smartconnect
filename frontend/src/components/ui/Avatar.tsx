import { useEffect, useState } from 'react';
import { initialsOf, useAvatarUrl, usePerson } from '../../lib/people';

/**
 * Initial-based avatar (T.32 design system), or the person's photo (QA H4).
 * Each person gets a stable, muted colour derived from their id (QA L9; from
 * the name when no id is known), so a conversation is scannable at a
 * glance without the same gradient on everyone. White text on every swatch
 * meets 4.5:1. Optional presence dot with a ring in the surface colour; the
 * presence is also given as text for assistive technology.
 */
const SWATCHES = ['#0b7c86', '#3a6ea5', '#7a5195', '#a8456b', '#b25a2b', '#5f7d2e', '#2e7d5b', '#5a6270', '#8a6a1f', '#4b5fbf'];

const hash = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const avatarColor = (name: string | null | undefined) => SWATCHES[hash(name || '?') % SWATCHES.length];

const SIZES = {
  xs: 'h-5 w-5 text-[9px] tracking-tight rounded-md', // QA L8: two letters fit at 20px
  sm: 'h-7 w-7 text-xs rounded-md',
  md: 'h-9 w-9 text-sm rounded-lg',
  lg: 'h-11 w-11 text-base rounded-xl',
} as const;

export type Presence = 'online' | 'away' | 'offline';

export const Avatar = ({
  name,
  userId,
  avatarId,
  size = 'md',
  presence,
  className = '',
}: {
  name: string | null | undefined;
  /**
   * QA L9: the person's id. Their colour is derived from it, so the same
   * person has the same colour on every screen whichever name string a screen
   * has; it also finds their photo in the people directory (QA H4).
   */
  userId?: string | null;
  /** QA H4: the photo id when the screen already has it (else looked up by userId). */
  avatarId?: string | null;
  size?: keyof typeof SIZES;
  presence?: Presence;
  /** @deprecated QA L8: initials are now the same everywhere (two letters at every size). */
  initials?: 1 | 2;
  className?: string;
}) => {
  const known = usePerson(userId);
  const photoId = avatarId ?? known?.avatarId ?? null;
  const photo = useAvatarUrl(userId, photoId);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);
  const shown = photo && !broken;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {shown ? (
        <img src={photo} alt="" aria-hidden="true" onError={() => setBroken(true)} className={`object-cover ${SIZES[size]}`} />
      ) : (
        <span
          aria-hidden="true"
          className={`flex select-none items-center justify-center font-semibold uppercase text-white ${SIZES[size]}`}
          style={{ backgroundColor: avatarColor(userId || name) }}
        >
          {initialsOf(name)}
        </span>
      )}
      {presence && presence !== 'offline' && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${presence === 'online' ? 'bg-presence-online' : 'bg-presence-away'}`}
          aria-hidden="true"
        />
      )}
      {presence && <span className="sr-only">{presence === 'online' ? 'online' : presence === 'away' ? 'away' : 'offline'}</span>}
    </span>
  );
};
