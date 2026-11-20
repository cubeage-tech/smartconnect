import { signedAttachmentUrl } from '../../lib/attachments';
import { prisma } from '../../lib/prisma';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * People the caller can see: everyone who shares at least one workspace with
 * them (including themselves). Previously returned every user on the
 * platform, across all tenants (audit SEC-10).
 */
const visibleTo = (userId: string) => ({
  OR: [{ id: userId }, { workspaces: { some: { workspace: { members: { some: { userId } } } } } }],
});

/**
 * QA H4: each person's display name (the full name given at sign-up, or set
 * in their profile), title and photo id come with the directory, so every
 * screen can show the same name for the same person. The username stays the
 * unique handle (mentions, search).
 */
export const listUsers = async (userId: string) => {
  const users = await prisma.user.findMany({
    where: visibleTo(userId),
    select: { id: true, username: true, profile: { select: { displayName: true, title: true, avatarAttachmentId: true } } },
    orderBy: { username: 'asc' },
  });
  return users.map(({ profile, ...u }) => ({
    ...u,
    displayName: profile?.displayName ?? null,
    title: profile?.title ?? null,
    avatarId: profile?.avatarAttachmentId ?? null,
  }));
};

/**
 * QA H4: a short-lived link to a person's photo, for people who share a
 * workspace with them (the same rule as the directory). Null when there is no
 * photo or the caller may not see this person (the route answers 404 for both).
 */
export const getAvatarLink = async (callerId: string, userId: string) => {
  if (!UUID_RE.test(userId)) return null;
  const person = await prisma.user.findFirst({
    where: { id: userId, ...visibleTo(callerId) },
    select: { profile: { select: { avatarAttachment: true } } },
  });
  const photo = person?.profile?.avatarAttachment;
  return photo ? signedAttachmentUrl(photo) : null;
};

// Called whenever the caller switches into a workspace (see
// WorkspaceLayout.tsx) — kept in sync so login/signup can tell the frontend
// where to land them next time, instead of always defaulting to whichever
// workspace happens to be first in the list.
export const setLastActiveWorkspace = (userId: string, workspaceId: string) =>
  prisma.user.update({ where: { id: userId }, data: { lastActiveWorkspaceId: workspaceId } });

export const PROFILE_LIMITS = { displayName: 80, title: 80, bio: 500, timezone: 64 } as const;
/** QA H4: photo uploads accepted as a profile photo (no SVG: it can carry script). */
export const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface ProfileView {
  displayName: string | null;
  avatarId: string | null;
  title: string | null;
  bio: string | null;
  timezone: string | null;
  readReceiptsEnabled: boolean;
}

const DEFAULT_PROFILE: ProfileView = { displayName: null, avatarId: null, title: null, bio: null, timezone: null, readReceiptsEnabled: true };
const PROFILE_SELECT = { displayName: true, avatarAttachmentId: true, title: true, bio: true, timezone: true, readReceiptsEnabled: true } as const;
const toView = ({ avatarAttachmentId, ...rest }: { avatarAttachmentId: string | null } & Omit<ProfileView, 'avatarId'>): ProfileView => ({ ...rest, avatarId: avatarAttachmentId });

export const getProfile = async (userId: string): Promise<ProfileView> => {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: PROFILE_SELECT });
  return profile ? toView(profile) : DEFAULT_PROFILE;
};

/** QA H4: the same rules as the sign-up "Full name" field; empty clears it (the username is shown). */
const displayNameInput = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Name must be text.');
  if (CONTROL_CHARS.test(value)) throw new HttpError(400, 'Your name contains characters that are not allowed.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > PROFILE_LIMITS.displayName) throw new HttpError(400, `Name must be at most ${PROFILE_LIMITS.displayName} characters.`);
  return name || null;
};

/**
 * QA H4: a profile photo is an image this user uploaded through /api/upload
 * that is not attached to a message or task (and not someone else's photo).
 * null removes the photo (the old file is then removed by the orphan sweeper).
 */
const avatarInput = async (userId: string, value: unknown): Promise<string | null | undefined> => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError(400, 'Choose a photo you uploaded.');
  const file = await prisma.attachment.findUnique({ where: { id: value }, select: { uploaderId: true, messageId: true, taskId: true, mimeType: true, size: true, avatarOf: { select: { userId: true } } } });
  if (!file || file.uploaderId !== userId || file.messageId || file.taskId || (file.avatarOf && file.avatarOf.userId !== userId)) {
    throw new HttpError(400, 'Choose a photo you uploaded.');
  }
  if (!AVATAR_MIME_TYPES.has(file.mimeType)) throw new HttpError(400, 'A profile photo must be a JPEG, PNG, WebP or GIF image.');
  if (file.size > AVATAR_MAX_BYTES) throw new HttpError(400, 'A profile photo must be 5 MB or smaller.');
  return value;
};

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const optionalText = (value: unknown, field: string, max: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return trimmed || null;
};

/**
 * Collaboration profile + preferences. Stored in UserProfile, never on the
 * User (authentication) row. Partial updates; unknown fields ignored.
 */
export const updateProfile = async (userId: string, body: unknown): Promise<ProfileView> => {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const displayName = displayNameInput(input.displayName);
  const avatarAttachmentId = await avatarInput(userId, input.avatarId);
  const title = optionalText(input.title, 'Title', PROFILE_LIMITS.title);
  const bio = optionalText(input.bio, 'Bio', PROFILE_LIMITS.bio);
  const timezone = optionalText(input.timezone, 'Time zone', PROFILE_LIMITS.timezone);
  if (timezone && !isValidTimeZone(timezone)) throw new HttpError(400, 'Unknown time zone.');
  let readReceiptsEnabled: boolean | undefined;
  if (input.readReceiptsEnabled !== undefined) {
    if (typeof input.readReceiptsEnabled !== 'boolean') throw new HttpError(400, 'readReceiptsEnabled must be true or false.');
    readReceiptsEnabled = input.readReceiptsEnabled;
  }

  const data = { displayName, avatarAttachmentId, title, bio, timezone, readReceiptsEnabled };
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) },
    update: data,
    select: PROFILE_SELECT,
  });
  return toView(profile);
};

export { HttpError };
