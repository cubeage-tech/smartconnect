import { randomBytes } from 'crypto';
import { findUserIdByUsername } from './identity';
import { prisma } from './prisma';

/**
 * A readable, unique username (3–40 characters: letters, digits, ".", "_",
 * "-") derived from a person's name, or from the local part of their e-mail
 * address when no name is given. Used wherever the server creates an account
 * without the person choosing a username themselves: Team Lead and Member
 * provisioning (teamManagement) and public sign-up with a full name
 * (auth.service). Uniqueness is checked exactly and case-insensitively
 * (Stage 6C, IDN-3); callers still handle a unique violation from a
 * concurrent insert.
 */
export const uniqueUsername = async (displayName: string | null, email: string, fallback = 'teamlead') => {
  const source = (displayName ?? email.split('@')[0]).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/[._-]{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 30)
    .replace(/[._-]+$/g, '');
  if (base.length < 3) base = fallback;
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}${n}`;
    if (!(await findUserIdByUsername(prisma, candidate))) return candidate;
  }
  return `${base}.${randomBytes(6).toString('hex').slice(0, 6)}`;
};
