import { SYSTEM_USER_EMAIL } from './sharedWorkspace';

/**
 * Internal accounts that are not people: the SmartConnect Collab system owner
 * and the "deleted user" placeholder messages are reassigned to. They are left
 * out of every people list and every people count (QA M9: the dashboard counted
 * them, so its total disagreed with User Management).
 */
export const RESERVED_LOGINS = [SYSTEM_USER_EMAIL, 'deleted-user@system.internal'];

/** Prisma `where` for real (non-system) user accounts. */
export const realUsers = { email: { notIn: RESERVED_LOGINS } };
