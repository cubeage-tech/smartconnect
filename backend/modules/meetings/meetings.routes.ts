import { NextFunction, Response, Router } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { requireSessionUser } from '../../middleware/identity.middleware';
import { userRateLimit } from '../../middleware/userRateLimit.middleware';
import { closeMeetingRoom } from '../../sockets/calls.handlers';
import { deliverMeetingChange } from './meetings.delivery';
import * as meetings from './meetings.service';

/**
 * Meeting scheduler API, mounted at /api. No workspace middleware: every
 * handler checks the caller in meetings.service (workspace membership and
 * meeting visibility; hidden meetings answer 404). Per-user rate limits:
 * reads 240/min, changes 60/min, invitations 30/min.
 */
const router = Router();
const read = [...requireSessionUser, userRateLimit(240, 60_000, 'Too many requests. Please slow down.')];
const write = [...requireSessionUser, userRateLimit(60, 60_000, 'Too many meeting changes. Please slow down.')];
const invite = [...requireSessionUser, userRateLimit(30, 60_000, 'Too many invitations. Please slow down.')];

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const handle = (fn: Handler) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const quietly = (promise: Promise<unknown>) => promise.catch((err) => console.error('Meeting room update failed:', err instanceof Error ? err.message : err));

router.get('/workspaces/:workspaceId/meetings', ...read, handle(async (req, res) => {
  res.json(await meetings.listMeetings(req.user!.id, req.params.workspaceId, req.query as Record<string, unknown>));
}));

router.post('/workspaces/:workspaceId/meetings', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.createMeeting(req.user!.id, req.params.workspaceId, req.body);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  res.status(201).json({ meeting });
}));

router.get('/meetings/:meetingId', ...read, handle(async (req, res) => {
  res.json({ meeting: await meetings.getMeeting(req.user!.id, req.params.meetingId) });
}));

router.patch('/meetings/:meetingId', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.updateMeeting(req.user!.id, req.params.meetingId, req.body);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  res.json({ meeting });
}));

router.post('/meetings/:meetingId/reschedule', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.rescheduleMeeting(req.user!.id, req.params.meetingId, req.body);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  res.json({ meeting });
}));

router.post('/meetings/:meetingId/cancel', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.cancelMeeting(req.user!.id, req.params.meetingId);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  quietly(closeMeetingRoom(meeting.id, 'The organizer cancelled this meeting.'));
  res.json({ meeting });
}));

router.post('/meetings/:meetingId/end', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.endMeeting(req.user!.id, req.params.meetingId);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  quietly(closeMeetingRoom(meeting.id, 'The organizer ended the meeting.'));
  res.json({ meeting });
}));

router.get('/meetings/:meetingId/participants', ...read, handle(async (req, res) => {
  res.json(await meetings.listParticipants(req.user!.id, req.params.meetingId));
}));

router.post('/meetings/:meetingId/participants', ...invite, handle(async (req, res) => {
  const { meeting, invited, alreadyInvited, change } = await meetings.inviteParticipants(req.user!.id, req.params.meetingId, req.body);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  res.json({ meeting, invited, alreadyInvited });
}));

router.delete('/meetings/:meetingId/participants/:userId', ...write, handle(async (req, res) => {
  const { meeting, removedUserId, change } = await meetings.removeParticipant(req.user!.id, req.params.meetingId, req.params.userId);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  quietly(closeMeetingRoom(meeting.id, 'The organizer removed you from this meeting.', removedUserId));
  res.json({ meeting });
}));

router.post('/meetings/:meetingId/respond', ...write, handle(async (req, res) => {
  const { meeting, change } = await meetings.respondToMeeting(req.user!.id, req.params.meetingId, req.body);
  deliverMeetingChange(meeting.id, meeting.workspaceId, change);
  // A decline takes this person out of the room if they are in it.
  if (meeting.myResponse === 'DECLINED') quietly(closeMeetingRoom(meeting.id, 'You declined this meeting.', req.user!.id));
  res.json({ meeting });
}));

export default router;
