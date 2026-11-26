import { NextFunction, Response, Router } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getSoundPreferences, resetSoundPreferences, saveSoundPreferences } from './soundPreferences';
import { requireSessionUser } from '../../middleware/identity.middleware';
import { userRateLimit } from '../../middleware/userRateLimit.middleware';
import { requireWorkspaceAccess } from '../../middleware/workspace.middleware';
import { getAvatarHandler, getMyProfileHandler, listUsersHandler, updateActiveWorkspaceHandler, updateMyProfileHandler } from './users.controller';

const router = Router();
const profileWriteLimiter = userRateLimit(30, 60_000, 'Too many profile updates. Please slow down.');

router.get('/', ...requireSessionUser, listUsersHandler);
// requireWorkspaceAccess reads workspaceId from the body here (no :id param
// on this route) — same pattern as POST /api/channels.
router.patch('/me/active-workspace', ...requireSessionUser, requireWorkspaceAccess, updateActiveWorkspaceHandler);
router.get('/me/profile', ...requireSessionUser, getMyProfileHandler);
router.patch('/me/profile', ...requireSessionUser, profileWriteLimiter, updateMyProfileHandler);
// Personal call and notification sounds — the caller's own only (no user id in
// the path, so nobody can read or change anyone else's).
const soundRoute = (fn: (userId: string, body: unknown) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await fn(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
};
router.get('/me/sound-preferences', ...requireSessionUser, soundRoute((userId) => getSoundPreferences(userId)));
router.put('/me/sound-preferences', ...requireSessionUser, profileWriteLimiter, soundRoute(saveSoundPreferences));
router.delete('/me/sound-preferences', ...requireSessionUser, profileWriteLimiter, soundRoute((userId) => resetSoundPreferences(userId)));
// QA H4: profile photos (one link per person on screen, cached by the client for its lifetime).
const avatarLinkLimiter = userRateLimit(600, 60_000, 'Too many photo requests. Please slow down.');
router.get('/:id/avatar', ...requireSessionUser, avatarLinkLimiter, getAvatarHandler);

export default router;
