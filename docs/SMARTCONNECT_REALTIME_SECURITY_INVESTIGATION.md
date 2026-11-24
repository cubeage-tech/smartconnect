# SmartConnect — Real-time messaging, message isolation and People directory: investigation

**Date:** 2026-11-23 · **Branch:** `main` · **Baseline commit:** `ebd4317` (identical to `cubage/main`) · **Working tree at start:** clean

Companion documents: [remediation tracker](SMARTCONNECT_REALTIME_REMEDIATION_TRACKER.md) · [final report](SMARTCONNECT_REALTIME_FINAL_REPORT.md)

---

## 1. Reported symptoms

| Id | Symptom (as reported from the deployed site, real accounts) |
|----|----|
| A1 | In an open conversation, new messages do not reliably appear in real time; a page reload shows them. |
| A2 | After reloading, messages belonging to another person appear in the conversation or message interface. |
| B  | People → select any user → an error appears instead of the profile or conversation. |

Production itself was **not** accessed (no production URL is recorded in the repository, and the hosted database is not to be touched). Every result below comes from local, throwaway databases.

## 2. Baseline (Phase 0)

### Repository and deployment

- `main` = `cubage/main` = `ebd4317`. `origin/main` is `6d5057b` (11 commits behind `main`), `origin/smartconnect-release` is `27adf05` (14 behind). **Local `main` has not been pushed to `origin`**, so which commit the live site runs could not be determined from the repository.
- Frontend: React 19 + Vite SPA, deployed on Vercel (`frontend/vercel.json`). The API and Socket.IO origins are baked in at build time (`VITE_API_URL`, `VITE_BACKEND_URL`).
- Backend: Express 4 + Socket.IO 4.8 + Prisma 6 on Render (`render.yaml`, one instance, start command `npm run db:deploy && npx tsx server.ts`). PostgreSQL is hosted. Per `docs/SMARTCONNECT_QA_FINAL_REPORT.md` §12 it is the Neon database `backend/.env` points at. Redis is optional (`REDIS_URL`, not set in `render.yaml`).
- `backend/.env` points at that hosted database. It was never used. Every test ran with an explicit local `DATABASE_URL`, and the test harness refuses non-local URLs (`backend/tests/setup.ts`, `frontend/playwright.config.ts`).

### Real-time architecture (as found)

- **Handshake** (`backend/sockets/index.ts`): the token is checked against the server-side session (`lib/sessions.ts verifySessionToken`). The socket's identity comes from the database. Each socket joins `user:<id>` and `session:<sid>`.
- **Subscriptions** (`sockets/channelAccess.ts`): on every (re)connect, `subscribeToMemberChannels` joins exactly the channels where the user is a channel member, a member of the channel's workspace, and (for private projects) a project member. Then the server emits `subscriptions:ready`. `channel:join` accepts UUIDs only and re-checks access in the database, so internal room names can't be joined.
- **Delivery** (`sockets/messages.handlers.ts emitToVerifiedMembers`): `message:received` / `message:updated` go to the `user:<id>` rooms of members re-verified in the database (ACTIVE account, channel + workspace + private-project membership, history window). Typing, deletes, reactions and reply counts go to channel rooms. Stale channel-room members are swept off.
- **History** (`GET /api/channels/:id/messages`): `requireChannelMembership` → `getChannelAccess` (the same rule as above, plus the history window). Cursors and `after` anchors must belong to the same channel.
- **Client**: one socket per tab (`hooks/useSocket.ts`, created in `WorkspaceLayout`). `ChatArea` is keyed by conversation id (`ChannelPage`), drops events whose `channelId` isn't the open conversation, de-duplicates by id/clientId (`lib/messages.ts`), and backfills on `subscriptions:ready`.
- **Sign-in storage** (`lib/devTabSession.ts`): production keeps one token in `localStorage["token"]`, shared by every tab of a browser profile. Per-tab sessions (T.37) exist only in local development builds on localhost.

### People flow (as found)

People → `PeopleDirectory` (`GET /api/workspaces/:wid/members`) → card → `ProfileModal` (`GET /api/workspaces/:wid/members/:uid`) → **Message** → `startDM` (`POST /api/channels/dm`, find-or-create under a per-pair advisory lock). Selecting a person opens the profile; Message opens or creates the DM. This behaviour is preserved.

### Existing tests consulted

`backend/tests/realtime.test.ts`, `messages.test.ts`, `p2-dm-scope.test.ts`, `collaboration-security.test.ts`, `members-presence.test.ts`; `frontend/src/components/chat/ChatArea.*.test.tsx`, `components/people/people.test.tsx`; `frontend/e2e/smoke.spec.ts` (two-person live chat and People → Message) and `t37-multi-tab.spec.ts`.

## 3. Reproduction (Phase 1)

Three environments, all local:

1. **E2E harness**: Vite dev server plus backend with `NODE_ENV=test`, throwaway DB `smartconnect_rt_e2e`.
2. **Production replica**: production `vite build` bundle served by `vite preview`, plus backend with `NODE_ENV=production` (rate limits, strict CORS), same throwaway DB, backend restarted mid-conversation to simulate a Render deploy or free-tier spin-down.
3. **Backend integration**: Vitest with real Socket.IO and Postgres on `smartconnect_rt_test` / `smartconnect_rt_drift`.

Users A and B share workspace W. C has no access to W. D is in W but not in the A–B DM. Separate browser contexts (separate people, separate logins) unless stated.

| # | Scenario | Result before the fix |
|---|---|---|
| R1 | A posts in W/General → B live | ✅ live (dev and production modes) |
| R2 | A ↔ B DM, both directions | ✅ live |
| R3 | B in General while A writes in the DM; B returns to the DM | ✅ no leak into General; DM complete on return |
| R4 | Backend restarted while A and B are in the DM | ✅ reconnect, live again, no reload |
| R5 | A sends while the backend is down | ✅ shown as "Not delivered yet", re-sent on reconnect, B receives it |
| R6 | C reads W's General / the A–B DM / B's profile | ✅ 403 / 403 / 403; C's page receives none of it |
| R7 | **B's browser cannot open a WebSocket** (handshake refused, HTTP fine) | ❌ **0 polling requests, B never receives A's message live; it appears after a reload** |
| R8 | **Two tabs of one browser profile**: tab 2 on the login form, tab 1 signs in as A, tab 2 signs in as B | ❌ **Tab 1 keeps acting as A; on its next page load it is silently B and shows B's conversations at the same address.** Signing out in tab 1 before that ended **B's** session and left A's running. |
| R9 | People → select a member (created workspace and SmartConnect Collab; with and without profile fields) | ✅ profile and Message work on a migrated database |
| R10 | **People → select any member when the database lacks `UserProfile.avatarAttachmentId`** (migration `20261120120000_qa_h4_profile_avatar` not applied) | ❌ **List 200, every profile 500 "Something went wrong on our side"** |

How R7 was simulated: the page's Socket.IO WebSocket is replaced with a real WebSocket to a closed port. That is a genuine browser handshake failure (error before open, close 1006), the same thing a proxy, firewall or antivirus refusal produces. Two other simulations were tried and rejected as invalid. Playwright `routeWebSocket` opens the socket before closing it, which is a different failure mode. CDP `Network.setBlockedURLs` didn't block the socket at all.

## 4. Root causes (Phase 2)

### A1 — messages need a reload: the real-time connection has no fallback (confirmed)

`useSocket` created the client with `transports: ['websocket', 'polling']` and socket.io-client 4.8's default `tryAllTransports: false`. In `engine.io-client` (`Socket._onError`), the next transport is tried only when `tryAllTransports` is set. Otherwise a failed WebSocket handshake closes the attempt and the manager retries WebSocket again, forever. **Polling is never used.** REST is plain HTTPS and keeps working, so the app loads and history shows. But no live event ever arrives: new messages, edits and unread counts show only after a reload. The only visible sign is the amber "Connecting to SmartConnect…" bar.

Where this happens: networks or software that refuse or break WebSocket upgrades while allowing HTTPS (corporate and campus proxies, some firewalls and antivirus HTTPS inspection, some mobile carriers). This explains "not reliably": it depends on the viewer's network, not on the account.

Ruled out by reproduction:

- Server restarts and spin-down (R4, R5).
- Conversation switching (R3).
- Listener leaks: one set of listeners per open conversation, removed on unmount (unit test).
- Room authorization: `message:received` goes to `user:<id>` rooms, not channel rooms.
- Cross-workspace filtering.

### A2 — "another person's messages appear after reloading": one shared sign-in, tabs not kept in step (confirmed)

All tabs of a browser profile share `localStorage["token"]`. A tab reads it **once**, at page load. Nothing told a running tab that the shared sign-in had changed. So when someone signed in as B in another tab:

- the first tab kept using A's token in memory, so it still looked and acted like A;
- on its next page load it read B's token and **became B at the same URL**, showing B's sidebar and DMs (R8);
- `logout()` sent `readStoredToken()`, the *shared* token, to `/api/auth/logout`. It **ended B's session** while A's session stayed valid on the server, and it removed B's sign-in from storage. A 401 in that tab also wiped the shared token.

The tester's account switching in one browser profile is what makes "messages belonging to another person" show up after a reload. The T.37 per-tab sessions that support side-by-side testing exist only in local development builds.

### Is there a server-side cross-user leak? (No: audited and tested)

Checked against the ten points of the brief:

- Workspace, channel, private-channel and DM access.
- Socket subscription and room joins, including internal room names.
- Event audiences.
- History, search, pinned and thread APIs.
- Cursor and `after` anchors from another conversation.
- Conversation switching.
- Reconnection.

No path returns or delivers another conversation's or workspace's messages to a user without access. All of it is pinned by the new security matrix (`backend/tests/realtime-isolation.test.ts`, 13 tests, three-plus users with independent logins) and the E2E spec (`frontend/e2e/realtime-isolation.spec.ts`, where C's page frames are inspected for the secret text).

### B — selecting a person errors (mechanism confirmed; production state to be verified)

`getMemberProfile` loaded `user.profile` with `profile: true`, i.e. **every** `UserProfile` column, although the card uses four of them. The directory list selects only `displayName` and `title`. Migration `20261120120000_qa_h4_profile_avatar` (in `main`, not in `origin/main`) added `UserProfile.avatarAttachmentId`. With that column missing from the database the code runs against, the list loads and **every** profile fails with a generic 500 (R10). That matches "select **any** user → error" exactly.

On a correctly migrated database the flow works in every variant tried (R9). So whether production is in that state needs a **read-only** check of the production database. The query is in the final report, §Deployment. Version skew is also possible: local `main` is ahead of `origin`, so the deployed backend may not match the deployed frontend. The code fix makes the profile endpoint independent of columns it doesn't show. The UI fix keeps "Message" reachable when a profile can't load.

## 5. Security impact assessment

| Finding | Impact | Severity |
|---|---|---|
| Server-side isolation | No leak found; verified by tests. | — |
| A2 cross-tab identity | Not a server-side leak: no request ever returned data its token wasn't entitled to. It needs two accounts signed in, one after the other, in **one browser profile**, so the person already holds both sets of credentials. Real consequences: (1) on shared computers, a tab can show the next person's conversations after a reload; (2) "Sign out" in a stale tab ends **someone else's** session and **leaves its own server session valid** (up to the 7-day token lifetime). | Medium (session hygiene) |
| A1 transport | Availability only. | High (functional) |
| B | Availability only. Nothing is disclosed: errors are generic, and 4xx cases are controlled. | High (functional) |

**Containment:** none needed for data. The fixes in §6 remove the cross-tab confusion and the cross-session logout.

## 6. Fixes implemented

See the [tracker](SMARTCONNECT_REALTIME_REMEDIATION_TRACKER.md) for files and tests.

1. **Transport fallback** (`frontend/src/hooks/useSocket.ts`): `tryAllTransports: true`. WebSocket is still tried first. If its handshake fails, the client falls back to HTTP long-polling. Verified in the production replica: 7 polling requests and B received the message live. Verified in E2E.
2. **One sign-in per browser profile, kept in step** (`frontend/src/lib/sharedSignIn.ts`, `contexts/AuthContext.tsx`):
   - When another tab signs in as a **different** account, or signs out, every other tab starts over at once (`/` or `/login`) with a full page load, so nothing the previous account loaded stays on screen.
   - The same person signing in again elsewhere is ignored.
   - T.37 isolated development tabs are untouched.
   - `logout()` ends **this tab's** session, never the shared token's.
   - A 401 or sign-out removes the shared sign-in only if it is this tab's own.
3. **Profile endpoint** (`backend/modules/members/members.service.ts`): selects only `displayName`, `title`, `bio`, `timezone`, the fields it returns.
4. **Profile card** (`frontend/src/components/people/ProfileModal.tsx`): on a server or network failure it shows **Try again** and keeps **Message** available. 4xx errors (not a member, invalid id) stay final with their message.

## 7. Remaining risks

- A middlebox that **accepts** the WebSocket upgrade and then drops it produces a transport close, not a handshake error, so it gets no polling fallback. Polling-first would cover it but needs sticky sessions once there is more than one backend instance.
- The polling fallback needs sticky sessions if the backend ever runs **several** instances (`render.yaml` says one).
- One account per browser profile is the product model in production. Testing several users side by side needs separate browser profiles or private windows.
- Switching accounts in another tab reloads every other tab, which drops anything in progress there (for example an active call).
- Issue B's production state must be confirmed with the read-only check, and the deployed commits identified (see the final report).
