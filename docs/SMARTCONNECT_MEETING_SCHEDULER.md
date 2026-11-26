# SmartConnect — Meeting Scheduler

Status: built on 2026-11-26, uncommitted. Phases 0–5 and 7 of the master task are done; Phase 6 (advanced features) is not built yet (§8).

## 1. What it does

Anyone in a workspace can:
- schedule a video or audio meeting with other members of that workspace;
- see it in **Meetings**: Upcoming (with Today), Calendar, Invitations, My meetings (organized by them) and Past;
- answer an invitation: Accept, Maybe or Decline;
- get reminders before it starts;
- join it in SmartConnect's own call room.

The organizer can edit, reschedule, invite, remove, cancel and end the meeting. The organizer can also end it for everyone from inside the room.

## 2. Built on what already existed

| Need | Existing piece reused | What changed |
|---|---|---|
| Meeting room | WebRTC mesh calls: `sockets/calls.handlers.ts` with `CallLobby` and `CallOverlay` | The room key is the meeting id. `verifyCallAccess` falls back to `meetingRoomAccess` only when no channel has that id. Every existing check (join, each re-check on offer and answer, media state, leave, disconnect) applies unchanged. |
| In-app notifications | `WorkNotification` feed and the live `work:notification` push | One nullable `meetingId` column. Activity opens the meeting. |
| E-mail | Brevo `sendViaBrevo` | `sendMeetingEmail`: one recipient per message, times in their own zone. |
| Live updates | `notifyUser` → `user:<id>` rooms | `meeting:changed` (ids only), `meeting:reminder`, `meeting:room-closed`. |
| Background work | In-process timers plus Postgres conditional claims, as task overdue reminders already do | `meetings.jobs.ts` / `meetings.reminders.ts`. |
| UI | `Modal`, `Field`, `Tabs`, `Button`, `Badge`, `States`, `Avatar`, `ConfirmDialog`, and the workspace member directory | New `components/meetings/*` and two pages. No new dependency. |

## 3. Data model (migration `20261126120000_meeting_scheduler`, additive only)

- **Meeting**: workspace, optional channel, organizer, title, description, `startsAt`/`endsAt` (UTC), `timezone` (IANA, the organizer's), `type` (VIDEO/AUDIO), `status` (SCHEDULED/CANCELLED/ENDED), `reminderMinutes`, timestamps. A `CHECK` constraint requires `endsAt > startsAt`.
- **MeetingParticipant**: one row per person, including the organizer (role ORGANIZER). This row **is** the invitation: `response` is PENDING, ACCEPTED, DECLINED or TENTATIVE. `@@unique([meetingId, userId])` blocks duplicate invitations, including concurrent ones.
- **MeetingReminder**: one row per meeting and offset, with `remindAt` (UTC) and `sentAt`. A `CHECK` constraint limits the offset to 5, 10, 15, 30 or 60 minutes.
- `WorkNotification.meetingId`: optional, with cascade delete.

There is no separate `MeetingInvitation` or `MeetingOccurrence` table. The participant row already is the invitation, and recurring meetings, if built, will be a series of ordinary meetings (§8).

## 4. API (mounted at `/api`; every route is authenticated and rate-limited per user)

| Method and path | Who |
|---|---|
| `GET /workspaces/:id/meetings?scope=upcoming\|invitations\|organized\|past\|range&from&to&before` | workspace member (own meetings only) |
| `POST /workspaces/:id/meetings` | workspace member |
| `GET /meetings/:id`, `GET /meetings/:id/participants` | participants |
| `PATCH /meetings/:id` (title, description, type, reminders, channel) | organizer |
| `POST /meetings/:id/reschedule` (resets attendees to PENDING) | organizer |
| `POST /meetings/:id/cancel`, `POST /meetings/:id/end` | organizer |
| `POST /meetings/:id/participants`, `DELETE /meetings/:id/participants/:userId` | organizer |
| `POST /meetings/:id/respond` `{response: accepted\|declined\|tentative}` | attendees |

Rules:
- A meeting is visible only to people with a participant row who are still active members of its workspace. Everyone else gets **404**.
- Only active members of the same workspace can be invited.
- A linked channel must be in the workspace and the organizer must be in it. It is shown only to viewers who are also in the channel.
- No response ever includes an e-mail address.

## 5. The meeting room

Access requires all of the following:
- the person is a participant who has not declined;
- they are still an active workspace member;
- the meeting is not cancelled or ended;
- the time is inside the window: **15 minutes before the start until 1 hour after the scheduled end**.

The mesh holds at most 8 people at once (`CALL_MAX_PARTICIPANTS`). The meeting page says so when more are invited.

The room is closed for everyone on cancel or end, and for one person when they are removed or decline. Organizer controls: end for everyone (in the room and on the page) and remove a participant. "Meeting chat" is the linked channel, when there is one.

**Losing the workspace** (removed, left, or the workspace deleted) also takes the person out of any meeting room **at once**. The existing revocation path (`sockets/revocation.ts`) now re-checks every call the person is in with the same rule (`reverifyUserCalls`). Before the pre-commit review, it only covered that workspace's channel calls, so a removed member stayed in a meeting until the next peer pairing.

**No room credentials exist.** The room key is the meeting's UUID, and knowing it grants nothing: every join and every peer pairing is checked on the server. A non-participant who tries to join gets the generic "not authorized" answer, so the ID does not even confirm the meeting exists. TURN/ICE settings come from the existing `/api/calls` endpoint, which is unchanged.

**Former members:** a participant row outlives leaving the workspace. In-app notices and e-mails (invitations, changes, cancellations, reminders) only go to people who are still active members of the meeting's workspace.

## 5a. Security review (2026-11-26, before the first commit)

| Area | How it is enforced | Test |
|---|---|---|
| Who can see a meeting | Participant row and active workspace membership (`loadVisibleMeeting`); everyone else gets 404 | `meetings.test.ts` |
| Workspace isolation | Every query is scoped to the workspace; invitees must be active members; lists are per workspace | `meetings.test.ts` |
| Organizer-only actions | `requireOrganizer` on edit, reschedule, cancel, end, invite and remove (403) | `meetings.test.ts` |
| Declined people | Visible to them, but no room access and no reminders | `meetings.test.ts`, `meeting-room.test.ts`, `meeting-reminders.test.ts` |
| Removed people | 404 and put out of the room at once | `meetings.test.ts`, `meeting-room.test.ts` |
| Cancelled or expired meetings | No room access (cancel closes it); no responses, edits or invitations; reminders deleted | `meetings.test.ts`, `meeting-room.test.ts` |
| Losing the workspace mid-meeting | Put out at once (fixed in this review) | `meeting-room.test.ts` |
| Former members | No notices or e-mails (fixed in this review) | `meeting-room.test.ts` |
| Linked channel | A real channel (not a DM, fixed in this review) the organizer is in; shown only to members of that channel | `meetings.test.ts`, `meeting-room.test.ts` |
| Data in responses | People as `{id, username, displayName}` only, never e-mail; `meeting:changed` carries ids only | `meetings.test.ts` |
| Reminders sent once | Conditional claim (`sentAt IS NULL`), concurrent runs tested | `meeting-reminders.test.ts` |
| Abuse | Per-user rate limits (reads 240/min, changes 60/min, invitations 30/min); at most 50 people per meeting; field length limits | — |

## 6. Reminders — and the infrastructure they need

- **Durable:** the schedule is the `MeetingReminder` table. It is rebuilt on reschedule and reminder edits, and deleted on cancel or end.
- **Sent once:** each due row is claimed with a conditional update (`sentAt IS NULL → now`) before anything is sent. This holds for overlapping runs and for several instances.
- **Restarts:** the worker runs 5 s after start, then every 30 s. Reminders that came due while the server was down are sent on the next run, provided the meeting has not started yet.
- **Skipped when useless:** cancelled, ended or already-started meetings get no reminder. Declined participants are excluded.
- **Delivery:** an in-app notification plus a toast for each reminder. An **e-mail only for the earliest reminder**, so nobody gets several e-mails per meeting.
- **Time zones:** everything is stored in UTC; zones only change how times are shown.

**Infrastructure requirement:**
- **Why an always-on backend:** the reminder worker is a timer inside the backend process, the same model as the existing task overdue reminders. It only runs while an instance is up. A host that sleeps when idle (for example a free Render instance, which sleeps after about 15 minutes without traffic) runs no worker while asleep. **Production needs an always-on backend instance.**
- **When the backend is down or asleep:** nothing is lost, because the schedule is in the database. Reminders are not sent during that time. On start, the worker runs within 5 s and sends every reminder that came due meanwhile, as long as its meeting has not started; the text says the real time left ("Starts in 3 minutes"). Reminders whose meeting already started are marked handled and dropped: a late reminder is useless. Meetings themselves (scheduling, invitations, rooms) need no worker.
- **Recovery after a restart:** as above. Rows still unsent and due are picked up on the next run; nothing is held in memory.
- **No duplicates:** a row is claimed (`UPDATE … SET sentAt = now WHERE id = … AND sentAt IS NULL`) before anything is sent. Only the run whose update changed one row sends it: overlapping runs, several instances, or a restart in the middle of a run cannot send it twice. A crash after the claim but before sending loses that one reminder rather than sending it twice. That trade-off is deliberate (at most once).
- **Environment variables:** **none new.** The feature uses existing settings: `APP_URL` (links in e-mails), `BREVO_API_KEY` / `BREVO_FROM_EMAIL` (e-mail; without them in-app reminders still work), the optional `CALL_MAX_PARTICIPANTS` (room size, default 8) and the optional `REDIS_URL` (only to share call rooms across several instances). Redis is not needed for reminders: the database is the queue.

**Migration and deploy:** `20261126120000_meeting_scheduler` is additive:
- 4 enums, 3 tables, 8 indexes, the constraints of the new tables, two `CHECK` constraints;
- one nullable column on `WorkNotification`, with its foreign key and index.

It contains no drops, renames, data updates or column changes. The deploy blueprint's start command (`npm run db:deploy && npx tsx server.ts`) applies it before the new server starts; if it fails, the server does not start. On an existing `WorkNotification` table, the nullable column is instant, the foreign key validates rows that are all NULL, and the index build briefly blocks writes to that table. The previous code runs unchanged against the migrated schema, so a code rollback does not need the migration undone. Confirm that the actual Render start command matches the blueprint (production readiness, blocker B3).

## 7. Tests

| Suite | Covers |
|---|---|
| `backend/tests/meetings.test.ts` (25) | validation; visibility and 404s; workspace isolation and leaving the workspace; listing scopes; responses and organizer notices; edit, reschedule (responses reset, reminders moved, e-mails) and cancel (once, concurrently); duplicate-proof invitations; removal; room-access window; time-zone formatting |
| `backend/tests/meeting-reminders.test.ts` (6) | sent once under concurrency; catch-up after downtime; skipped after start or cancel; reschedule; recipients; one e-mail; time zones |
| `backend/tests/meeting-room.test.ts` (7) | the real Socket.IO call layer: invitees meet; uninvited (generic answer), declined and too-early refused; cancel and removal put people out; losing the workspace puts them out at once; former members get no notices or e-mails; no DM links. The last three fail without the review fixes. |
| `frontend/src/lib/meetingTime.test.ts` (8) | wall clock ↔ UTC in many zones, both DST changes |
| `frontend/src/components/meetings/meetings.test.tsx` (9) | form validation and the exact payload; edit versus reschedule; list rows; meeting page (attendee versus organizer, joining, not found) |
| `frontend/e2e/meetings.spec.ts` (1, three browsers) | schedule → invite → accept (live on the organizer's page) → uninvited member refused → both join the room → organizer ends it for everyone |

## 8. Not built yet (Phase 6) — recommended order

1. **Recurring meetings:** materialize a bounded series (for example up to 52 occurrences, or one year) of ordinary meetings sharing a `seriesId`. Each occurrence keeps its own participants, reminders and room, so nothing in §4–§6 changes. Add "edit or cancel this occurrence / all following".
2. **Availability checker:** show attendees' overlapping SmartConnect meetings in the form. Data already exists.
3. **Meeting notes:** a per-meeting notes field or a linked channel thread.
4. **Attendance:** record joins and leaves from the call layer's join and leave events.
5. **Google Calendar / Outlook:** an `.ics` attachment on invitation e-mails first (no OAuth), then two-way sync.
6. **AI summaries:** needs recording or transcription, which SmartConnect does not have. That is a separate product and privacy decision.

## 9. Known limitations

- The room is a mesh: 8 people at once, and quality degrades on weak connections. Larger meetings would need an SFU.
- Ending the meeting is the only server-side organizer control. Muting someone else is not possible in a mesh without a client-side request flow.
- Reminders depend on an always-on backend (§6).
