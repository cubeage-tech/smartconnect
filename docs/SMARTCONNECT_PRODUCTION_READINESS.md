# SmartConnect — Production Readiness

Date: 2026-11-24 (audit, then pre-commit hardening the same day) · Audited state: `main` @ `16a24e9` (pushed to `cubage/main`) **plus uncommitted working-tree changes** (§1.2). **Nothing was committed, pushed or deployed by this audit or the hardening.** Production data, databases and environment variables were not touched; every test ran on local throwaway databases.

Companion documents: `docs/SMARTCONNECT_REALTIME_FINAL_REPORT.md` (real-time, isolation and People: root causes and tests), `docs/SMARTCONNECT_REALTIME_REMEDIATION_TRACKER.md`, and the earlier `docs/SMARTCONNECT_QA_FINAL_REPORT.md` and `docs/SMARTCONNECT_QA_REMEDIATION_TRACKER.md`.

## Verdict

**READY TO COMMIT. Not yet ready for deployment.**

- The code is ready (§1.1, after the pre-commit hardening of 2026-11-24):
  - backend **716/716**, frontend **511/511**, browser E2E **41/41**;
  - type checks, both production builds, schema validation, migration consistency and `git diff --check` all clean.
- The audit's two open items are fixed: the intermittent E2E test (§1.6, AUD-E2E-1) and invited addresses in logs and error answers (§1.3, AUD-PII-1).
- Deployment is blocked on facts that can only be confirmed in Render, Vercel and the production database (§2). This audit had no access to those dashboards: the Vercel and GitHub CLIs on this machine are not signed in, and no Render CLI is installed. None of the blockers needs a code change.

## 1. What was verified

### 1.1 Automated verification (run one at a time, fresh throwaway databases)

Final results, after the pre-commit hardening (2026-11-24, working tree as listed in §1.2):

| Check | Command | Result |
|---|---|---|
| Backend full suite | `vitest run` (single fork, serial) | ✅ **716 passed, 0 failed, 21 skipped**; 73 files (72 passed, 1 skipped); 16.3 min |
| Frontend full suite | `vitest run` | ✅ **511 passed, 0 failed**; 82 files |
| Browser E2E full suite | `playwright test` (Chromium) | ✅ **41 passed, 0 failed**; 15.3 min |
| Affected spec, repeated (`qa-remediation.spec.ts`) | `--repeat-each=10` (whole spec), then `-g "QA desktop" --repeat-each=20` | ✅ **50/50**, then ✅ **20/20** |
| Production-hosting E2E (SPA deep links, Vercel rewrites) | `npm run test:hosting` | ✅ 15 passed (2026-11-23; `vercel.json` and routing unchanged since) |
| Backend type check / production build | `tsc --noEmit` / `tsc -p tsconfig.json` | ✅ / ✅ |
| Frontend type check / production build | `tsc -p tsconfig.json` / `vite build` | ✅ / ✅ (existing chunk-size warning only) |
| Changed test files outside the tsconfigs | strict `tsc --noEmit` on `e2e/qa-remediation.spec.ts` and `tests/invitation-privacy.test.ts` | ✅ / ✅ |
| Prisma schema | `prisma validate` | ✅ valid |
| Migrations applied | `prisma migrate status` | ✅ up to date |
| Migrations ↔ schema | `prisma migrate diff --from-migrations … --to-schema-datamodel …` (shadow DB) | ✅ no difference |
| Migrated DB ↔ schema (the CI check) | `prisma migrate diff --from-url … --exit-code` | ✅ no difference |
| Whitespace | `git diff --check` | ✅ clean |
| Secrets in captured output | backend-suite and E2E output scanned for JWTs, bcrypt hashes, `Bearer`, test passwords and the old address-bearing invitation messages | ✅ none found |

The earlier audit run of the same day, before the hardening, gave backend 713/713, frontend 511/511 and E2E 40/41. The one failure was the intermittent test fixed in §1.6.

**The 21 skipped tests** are the Redis multi-instance suites (`t33-multi-instance`, and 11 tests in `t33-stores`). They run only with `TEST_REDIS_URL`, and this machine has no Redis. Production as configured (`render.yaml`) runs one instance without Redis, so they don't cover a configured production path. CI doesn't provide Redis either.

### 1.2 Changes since `16a24e9` (uncommitted, in the working tree)

| File | Change |
|---|---|
| `backend/tests/member-email-privacy.test.ts` | Test setup only: `beforeAll(() => reconcileSharedWorkspace())`. The file failed when it ran first on a fresh database, because sign-up needs SmartConnect Collab, which only the running server or other test files created. No expectation changed. Now 10/10 when run alone on a fresh database. |
| `frontend/src/components/layout/HomeView.tsx`, `frontend/src/pages/workspace/HomePage.tsx` | Home page redesign: a live workspace banner (unread summary, who's online), recent conversations with previews, and channels ordered by unread. It uses data the app already loads; no new API. |
| `frontend/src/components/layout/HomeView.test.tsx` (new) | 6 tests for the redesigned Home page. |
| `frontend/e2e/qa-remediation.spec.ts` | Pre-commit hardening (§1.6): link previews in the desktop QA test are answered in the browser (`page.route('**/api/preview')`, the convention of `stage4-company-overview.spec.ts`) instead of fetched live from `example.com`. The test now also asserts the late-arriving preview card really renders, and waits for a still message list before opening the reaction picker. Every reaction-picker assertion is unchanged. Later the same day, during the logo work, step L15 failed once in a full run: the keys were typed before the edit box had focus (TipTap applies `autofocus` in a `setTimeout` after mounting) and were lost. The step now waits for the edit box to have focus before typing. After that, the spec passed 50/50 and the full E2E suite 41/41. |
| `backend/modules/invitations/invitations.service.ts` | Pre-commit hardening (AUD-PII-1): the wrong-account 403 no longer names the invited address: *"This invitation was sent to a different account. Sign in with the invited e-mail address, or ask for a new invitation."* The invitation page already shows the address from the token lookup. |
| `backend/modules/teamManagement/teamLeads.service.ts` | Pre-commit hardening (AUD-PII-1): the failed account-invitation e-mail log line names the role, not the recipient's address. |
| `backend/utils/mailer.ts` | Pre-commit hardening (AUD-PII-1): Brevo's rejection reason is logged and passed up with the recipient's address replaced by `[recipient]` (any letter case), the same way the API key was already removed. This covers every mail type (invitation, account invitation, OTP, reset). |
| `backend/tests/invitation-privacy.test.ts` (new) | 3 regression tests for AUD-PII-1. They fail on `16a24e9` (3/3) and pass with the fix. |
| `docs/…` | This audit. |

The signup transaction deadlock fix (`ebd4317`: `backend/lib/policy/context.ts`, `backend/modules/invitations/invitations.service.ts`) is unchanged. `context.ts` is identical to `16a24e9`. The only edit to `invitations.service.ts` is the one-line wrong-account message at line 236. `git diff 16a24e9` shows that single hunk. Both of the fix's hunks, `stillManages(…, db)` and its call on the transaction client in `acceptInvitationForNewAccount`, are untouched. `signup-concurrency-small-pool.test.ts` passes (3/3).

Not part of this change set: an untracked `frontend/public/logo.png` (2172×724 PNG, created 2026-11-24 14:12 outside this work; nothing references it). It was left untouched. Decide separately whether to commit it.

### 1.3 Security audit

| Area | How it was verified | Result |
|---|---|---|
| Authentication and sessions | Server-side session check on every REST call and socket handshake (`lib/sessions.ts`); suites `auth`, `t32-sessions`, `socket-revocation`, `t34-admin-login` | ✅ |
| Cross-tab account sync | `AuthContext.crossTab` (7), `sharedSignIn` (8); E2E *two tabs of ONE browser profile* | ✅ Tabs follow the shared sign-in. Sign-out and 401 handling act on the tab's own session only. |
| Workspace membership | `permission-matrix`, `workspace-channel`, `hierarchy-policy`, `realtime-isolation` | ✅ |
| Private channels | `channels`, `collaboration-security`, `realtime-isolation` (revoked private channel not restored on reconnect) | ✅ |
| DM participants | `p2-dm-scope`, `group-dms`, `realtime-isolation` (a workspace member outside the DM receives nothing) | ✅ |
| REST message history | `realtime-isolation`: 403 for outsiders on messages, search, pinned and thread; a foreign `cursor` or `after` is refused | ✅ |
| Socket rooms | UUID-only `channel:join`; internal rooms (`user:<id>`, `ws:<id>`) refused; audience re-verified per event | ✅ |
| People directory and profiles | `member-email-privacy` (10), `realtime-isolation` (403 cross-workspace, 400 invalid id, 404 non-member); e-mails only for managers | ✅ |
| Invitations and sign-up | `public-signup`, `workspace-invitations`, `stage6a-auth1-signup`, `signup-concurrency-small-pool`, `onboarding-flow`, `invitation-privacy` | ✅ |
| Secrets in responses | Login, sign-up and `/me` responses are field-by-field selections. The three `password` selects only feed hash comparisons (`auth.service`, `activation.service`, `teamLeads.service`). Messages expose `sender {id, username}` only. | ✅ No hash or token returned |
| Secrets in logs | Captured server output of the whole backend suite and the E2E run, scanned for JWTs, bcrypt hashes, `Bearer`, the test password, reset/activation tokens and configured secrets | ✅ none found (E2E scan: the E2E reporter captured only 2 server lines (upload refusals) and the whole E2E output; both clean. The backend-suite scan is the substantive one.) |
| Personal data in logs and responses | Same scan, for e-mail addresses; then `invitation-privacy` (3 tests) | ✅ **Fixed in pre-commit hardening (AUD-PII-1).** The two low-severity cases the audit found were: (1) the failed account-invitation e-mail log line named the recipient; (2) the wrong-account 403 named the invited address, and the error handler logs every 4xx message. A third path was found while fixing them: Brevo's rejection reason, logged by the mailer and by the invitation services, could repeat the address. All three are now fixed. Every failure is still logged and reported to the sender, and the 403 still says what to do. |

### 1.4 Real-time audit

Covered by automated tests that ran green above:

- WebSocket connection and the **HTTP long-polling fallback** when the WebSocket handshake is refused (E2E; `useSocket.test`).
- Delivery without reload, conversation switching, multiple conversations at once, and duplicate and out-of-order events (`ChatArea.isolation`, `realtime-isolation`).
- Reconnection, plus backfill of what was missed (`realtime.test`: *restores subscriptions after a reconnect; missed messages are recoverable*).
- Typing, including stopping on disconnect (`realtime.test`).
- Read receipts, DM participants only (`read-state`).
- Reactions, including concurrent toggles (`messages`, `reactions`).
- Threads (`t33-reply-counts`, `messages`).

### 1.5 Functional regression (browser)

The full E2E suite covers:

- sign-up, login and sign-out;
- workspaces, invitations and join requests;
- channels (including private and archived), DMs and group DMs;
- People and profiles;
- file uploads and voice messages, through a local storage stand-in;
- projects, my tasks and team tasks;
- notifications and Activity;
- audio and video calls, including the lobby, self view and signalling security;
- the admin console;
- the Team Lead and Company Admin flows;
- phone layouts (`t39-mobile`) and light and dark themes across desktop, tablet and phone (`p3-visual-quality`, `admin-theme`).

The redesigned Home page is part of that theme and viewport sweep, and of the phone no-sideways-scroll check (`qa-remediation`). It was also screenshot-checked in desktop light, desktop dark and phone (2026-11-24).

### 1.6 Intermittent E2E failure: investigated and stabilised in pre-commit hardening (AUD-E2E-1)

**Result:** after the fix, the spec passed 50/50 (`--repeat-each=10`), the desktop test 20/20 more, and the full E2E suite 41/41.

- **What failed** (audit full run, 1 of 41): `frontend/e2e/qa-remediation.spec.ts:34`, step *H2 / M1: the reaction picker on the newest message is fully on screen*. `expect(picker).toBeVisible()` timed out.
- **What the failure trace shows.** This replaces the audit's first guess, which blamed `hover()` scrolling; the trace shows the hover did not scroll.
  1. The list was at its end before the hover.
  2. The click on *Add reaction* succeeded, and the picker **opened**: it was in the DOM 3 ms later, still showing *Loading emoji…*.
  3. About 80 ms later it was gone. In that window the message list scrolled up by about one message: the frames show it, the rendered rows went from messages 3–5 to messages 2–5, and the re-mounted message 2 fetched its link preview again.
  4. `ReactionPicker` closes by design when the list scrolls under it, so it closed.
- **The variable the test did not control.** Every message in the test carries `https://example.com`. Its preview card comes from `POST /api/preview`, which the server fetches live from the internet (cached 10 minutes). The card arrives after its message renders, so it grows the message late; whether the card appears at all depends on the network. Each message that (re)mounts goes through *loading placeholder → card* again.
- **What could not be pinned down.** The exact trigger of that one scroll. 22 targeted attempts on the unchanged code did not reproduce it:
  - 8× the test alone;
  - 6× with the browser CPU slowed 6×;
  - 5× slowed 20×;
  - 3× directly after `p3-visual-quality`, as in the full run.

  The failing run was the slowest seen (36.6 s against 7.4–9.6 s).
- **Fix (test-only; no product code changed):**
  - `/api/preview` is answered in the browser with the same answer shape the server gives for example.com, so the test no longer touches the internet and every run gets the same card at once;
  - the test now asserts that the late preview card really renders, so the late-growth check (L12) is not weakened;
  - it waits until the list is still (no preview loading; the same scroll position and height over 10 frames) before the end-of-list check and again before opening the picker;
  - all reaction-picker assertions are unchanged: on screen, on top, and closes with Escape.
- **Product note (not changed, low):** the picker closes on *any* scroll of the list, including the list's own automatic adjustments. That is the intended QA H2 behaviour, so it was left as is. If people report the picker closing by itself while previews load, the follow-up is to close only when the anchor actually moves.

## 2. Deployment blockers (owner actions; none needs code)

| # | Blocker | Why it matters | How to clear it |
|---|---|---|---|
| B1 | **Which repository and branch do Render and Vercel deploy from?** Not visible from here. `16a24e9` is on `cubage/main` (cubeage-tech/smartconnect). `origin` (pentasoftwareconsultancy/smartconnect) is still at `6d5057b`, 12 commits behind (`smartconnect-release` is at `27adf05`, 15 behind), and is not publicly visible. GitHub has no deployment records for cubeage-tech/smartconnect. | Deploying from `origin` ships none of the real-time, isolation, People or signup fixes. Frontend and backend from different commits is a known way to get mismatched behaviour. | Render → service → Settings → Repository / Branch; Vercel → Project → Settings → Git. Point both at the same repository and branch, and deploy the same commit. |
| B2 | **Production migration state.** `20261120120000_qa_h4_profile_avatar` must be applied before the current code serves People profiles, avatars and `/api/users`. | If the column is missing, every profile in People fails (reproduced; the realtime final report §3). The current code no longer depends on it for profiles, but avatars still do. | Read-only check in §3.3. If it's missing, the Render start command applies it on the next deploy. Confirm that command (B3). |
| B3 | **The actual Render start command.** The blueprint (`render.yaml`) says `npm run db:deploy && npx tsx server.ts`. A service created or edited by hand in the dashboard may differ. | Without `db:deploy`, migrations never run in production (B2). | Render → service → Settings → Build & Deploy → Start Command must equal the blueprint's. |
| B4 | **Credentials flagged by the earlier QA audit** (C1 Cloudinary rejected; C2 Brevo missing). Their current state wasn't visible here. | Without them: uploads, voice messages and photos answer 503; reset and invitation e-mails aren't sent (honest messages, no silent failure). | Render → Environment: `CLOUDINARY_*`, `BREVO_API_KEY`, `BREVO_FROM_EMAIL`. Check the startup log lines in §4. |
| B5 | **`VITE_BACKEND_URL` / `VITE_API_URL` on Vercel** must be the Render backend origin with **no path**, and `APP_URL` on Render must be the exact public frontend origin. | A path such as `/api` in `VITE_BACKEND_URL` becomes a Socket.IO namespace: no real-time at all. An `APP_URL` mismatch blocks REST and the polling fallback (CORS). | Vercel → Environment Variables; Render → Environment. Redeploy the frontend after any change, because the values are baked into the build. |

## 3. Deployment contract

Source: repository files (`render.yaml`, `vercel.json`, `frontend/vercel.json`, `backend/config/*`, `.github/workflows/ci.yml`). The dashboards couldn't be inspected (B1–B5).

### 3.1 Services

| | Backend (Render web service `smartconnect-backend`) | Frontend (Vercel; `render.yaml` also defines an alternative static site) |
|---|---|---|
| Root | `backend` | `frontend` |
| Build | `npm ci --include=dev && npm run build` (`postinstall` runs `prisma generate`; `build` = `tsc`, a type gate) | `npm ci && npm run build` (`tsc && vite build`, output `dist`) |
| Start | `npm run db:deploy && npx tsx server.ts` (migrations first; a failing migration stops the new version from starting) | static; SPA rewrite `/((?!assets/)[^.]*) → /index.html`; security headers (`vercel.json`) |
| Runtime | Node 22.14.0, `NODE_ENV=production`, plan `free`, **one instance** | — |
| Health | `healthCheckPath: /api/health` (liveness + database). `/api/ready` (readiness: database, Redis if configured, not draining) is also available. | — |
| Shutdown | SIGTERM drains connections (`server.ts`, `SHUTDOWN_TIMEOUT_MS`) | — |
| CI | GitHub Actions on `main` and `smartconnect-release`: lint, build, `migrate deploy`, migrate diff, tests (backend); lint, tests, build (frontend) | |

### 3.2 Environment variables (names only; never commit values)

| Backend | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL. A session-mode connection (migrations need one; not a transaction pooler). |
| `JWT_SECRET` | yes | Session token signing (`render.yaml` generates it). |
| `APP_URL` | yes in production | Exact frontend origin: the only CORS / Socket.IO origin, and the base of e-mailed links. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes (the server exits without them) | File storage; `CLOUDINARY_URL` optional. |
| `BREVO_API_KEY`, `BREVO_FROM_EMAIL` | for e-mail | Transactional e-mail; `BREVO_FROM_NAME` optional. |
| `CALL_TURN_URLS`, `CALL_TURN_SECRET` (or `CALL_TURN_USERNAME` / `CALL_TURN_CREDENTIAL`) | optional | TURN relay for calls behind strict NATs. |
| `REDIS_URL` | optional | Only for more than one instance (Socket.IO adapter, shared presence and rate limits). |
| `NODE_ENV`, `PORT`, `TRUST_PROXY`, `NODE_VERSION`, tuning (`SHUTDOWN_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `PRESENCE_HEARTBEAT_MS`, `CALL_RING_TIMEOUT_MS`, `CALL_MAX_PARTICIPANTS`, `TEAM_LEAD_INVITATION_TTL_HOURS`) | defaults exist | — |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` | only for `npm run admin:bootstrap` | One-off admin creation. |

| Frontend (build time) | Purpose |
|---|---|
| `VITE_API_URL` | REST base: the backend origin, no `/api`. |
| `VITE_BACKEND_URL` | Socket.IO origin: the backend origin, **no path**. |

### 3.3 Required production migration and the read-only check

All migrations through `20261120120000_qa_h4_profile_avatar` (additive: one nullable column, a unique index and a foreign key). This audit adds **no** migration. Read-only check:

```sql
SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3;
SELECT column_name FROM information_schema.columns WHERE table_name = 'UserProfile' AND column_name = 'avatarAttachmentId';
```

Or `npx prisma migrate status` with the production `DATABASE_URL`. **Not run by this audit.**

### 3.4 Real-time constraints

- Socket.IO connects **directly to Render**; Vercel serves static files only.
- WebSocket first, HTTP long-polling fallback when the handshake is refused.
- With **one** instance (the current configuration), both transports work without extra setup.
- Scaling past one instance needs `REDIS_URL` **and** sticky sessions for the polling fallback. Render doesn't provide sticky sessions, so keep one instance.
- Polling is subject to CORS (`APP_URL`), WebSocket is not. A WebSocket that is accepted and then dropped by a middlebox gets no fallback (documented limitation).
- Render's free plan sleeps when idle and restarts on deploys. Clients reconnect on their own (unlimited retries, 1–10 s backoff) and backfill what they missed (tested).

## 4. Deploy order

1. Clear B1–B5.
2. Commit and push the working-tree changes (§1.2) to the branch both services deploy from. Confirm CI is green.
3. **Backend (Render).** Deploy. The start command applies any pending migration first. Check the startup log for:
   - `Backend running on …`
   - `SmartConnect Collab ready …`
   - one of `File storage: Cloudinary accepted the server credentials.` / `File storage is OFF: …`
   - the e-mail status line.

   `GET /api/health` should answer `{"database":"connected"}` and `GET /api/ready` should answer `ready: true`.
4. **Frontend (Vercel).** Deploy the **same commit**.

## 5. After deploying: production checks

Use two separate browsers or a private window. Production allows one account per browser profile, and a second sign-in in another tab switches every tab.

| # | Check | Expected |
|---|---|---|
| 1 | A and B in a DM; A sends | B sees it at once, without reload, and vice versa |
| 2 | Same, on a network that blocks WebSockets (or DevTools → block `wss://…/socket.io`) | Messages still arrive (polling); no lasting "Connecting…" bar |
| 3 | B switches between General and the DM while A writes in the DM | Nothing from the DM appears in General; the DM is complete on return |
| 4 | People → select any member | The profile opens. **Message** opens or creates the DM; a second click opens the same DM |
| 5 | Home | Banner shows the unread summary and online people; recent conversations and channels are listed |
| 6 | Sign in as A in tab 1 and as B in tab 2 of the same browser | Tab 1 switches to B immediately; signing out ends only that session |
| 7 | Upload a file and record a voice message (needs B4) | Works, or an honest 503 if storage is still unconfigured |
| 8 | Phone, light and dark theme: Home, a channel, People | No sideways scrolling; readable contrast |

## 6. Rollback

- **Code:** Render → Deploys → *Rollback* to the previous deploy. Vercel → Deployments → previous production deployment → *Promote to Production*. Or redeploy commit `ebd4317` (before the real-time/People fixes) or the commit that was live before.
- **Database:** this change set has no migration, so nothing to roll back. Never drop `UserProfile.avatarAttachmentId` (`20261120120000`): the older code ignores it, and dropping it deletes profile-photo links.
- **Behaviour of the rolled-back version:** the real-time WebSocket-only problem, the cross-tab sign-in problem and the profile-column dependency come back.

## 7. Test-data cleanup manifest (needs your confirmation)

The QA session created the records below in **production**. **Nothing has been changed or deleted.** For each item, confirm the proposed action; until then they stay as they are.

- **Identifying them:** the read-only SQL at the end of this section (`BEGIN TRANSACTION READ ONLY … ROLLBACK`) lists the exact rows and IDs. Run it with a read-only role.
- **Acting on them:** prefer the in-app admin tools. They check permissions and write audit entries.

| # | Record | Identifier | Classification | Proposed action | How |
|---|---|---|---|---|---|
| 1 | QA test account | e-mail `qa.normaluser.11201116@example.com` (the user id comes from query 1 below) | Test-only. Its password appeared in the QA report, so **treat it as compromised**. | **Suspend it** (preferred: it keeps message authorship intact), or delete it after items 2–5 are cleaned up | Admin → User Management → the account → Suspend. Suspending ends all its sessions and live connections. |
| 2 | `[QA test]` messages in SmartConnect Collab `#General` | channel `43b6408c-10e1-433a-bfd9-cd4e5c5079ca`, workspace `12ccfca4-6281-4eed-a4a5-7ae5133458c6`; message ids from query 4 | Test-only. Shared channel, visible to every member. | Delete each `[QA test]` message (and its replies and reactions) | Admin → Content Moderation → search “[QA test]” → Delete. Do not touch other people’s messages in this channel. |
| 3 | QA direct-message conversation | DM channel `6d9af4e5-7d04-4fbf-9653-b1d049d3a3d2` | Test-only. One of its two members is a real user, so confirm the other participant before acting. | Delete the QA account’s messages in it; leave the conversation if the other person posted in it | Content Moderation, or ask the other participant |
| 4 | Test task | `TEAM-2` “[QA test] Verify file uploads” in SmartUnifolio (`1fca6554-bfe7-49f5-8e71-222292960865`) | Test-only | Delete the task | Team tasks → open TEAM-2 → Delete (Team Lead or owner) |
| 5 | Test project and its task | project “QA Test Project” `1528a5f3-e82c-4813-bf7e-720438c39bc0` (key `QTP`) with `QTP-1`, in SmartUnifolio | Test-only | Delete task QTP-1, then **archive** the project. The app has no project deletion; removing the row entirely would be a manual database operation, which needs a separate confirmation. | Open QTP-1 → Delete; then Projects → QA Test Project → Archive (owner or Team Lead) |
| 6 | Archived test channel | “QA Test Channel!” `d898acfd-6070-47d7-8512-037f57785a49`, in SmartUnifolio | Test-only, already archived | Delete the channel | Admin → Channel Management → the channel → Delete |
| 7 | Pending invitation | `qa.invitee.test@example.com` → SmartUnifolio | Test-only (an `example.com` address, so no real recipient) | **Revoke** | Workspace settings → Invitations → Revoke (owner or Team Lead) |
| 8 | Two Admin password-reset requests | — | **No database record.** A reset link is a signed token that expires 15 minutes after it is issued, and it stops working once the password changes, because it is signed with the current password hash. Both expired long ago. While C2 was in effect, the e-mails were most likely never sent at all. | Nothing to revoke. The Admin password is unchanged by them. | — |
| 9 | Audit-log entries made by the QA session | from query 9 | Audit records | **Keep.** Audit history is permanent. | — |

### Related credential hygiene (manual)

- The QA report artifact contains the QA account’s password. Once item 1 is done, that password is useless. You can also ask for the artifact to be republished with the password removed.
- The Administrator and Team Lead passwords were shared in plain text during the QA session. **Rotate both.** They were not changed, because that requires your authorization.

### Read-only identification SQL

```sql
-- READ ONLY: identifies QA test records. Nothing is changed.
BEGIN TRANSACTION READ ONLY;
-- 1. QA account
SELECT u.id, u.username, u.email, u.status, u.role, u."createdAt", p."displayName", p.title
FROM "User" u LEFT JOIN "UserProfile" p ON p."userId" = u.id
WHERE u.email = 'qa.normaluser.11201116@example.com';
-- 2. QA account sessions
SELECT s.id, s."createdAt", s."lastUsedAt", s."revokedAt" FROM "AuthSession" s JOIN "User" u ON u.id = s."userId"
WHERE u.email = 'qa.normaluser.11201116@example.com';
-- 3. QA account workspace memberships
SELECT wm."workspaceId", w.name, wm.role FROM "WorkspaceMember" wm JOIN "Workspace" w ON w.id = wm."workspaceId" JOIN "User" u ON u.id = wm."userId"
WHERE u.email = 'qa.normaluser.11201116@example.com';
-- 4. Messages sent by the QA account, or containing [QA test]
SELECT m.id, m."channelId", c.name AS channel, c."isDM", w.name AS workspace, su.username AS sender, m."parentId", m."createdAt",
       left(regexp_replace(coalesce(m.content,''), '<[^>]+>', '', 'g'), 70) AS text
FROM "Message" m JOIN "Channel" c ON c.id = m."channelId" JOIN "Workspace" w ON w.id = c."workspaceId" JOIN "User" su ON su.id = m."senderId"
WHERE su.email = 'qa.normaluser.11201116@example.com' OR m.content ILIKE '%[QA test]%'
ORDER BY m."createdAt";
-- 5. Reactions by the QA account
SELECT r.id, r."messageId", r.emoji, r."createdAt" FROM "Reaction" r JOIN "User" u ON u.id = r."userId"
WHERE u.email = 'qa.normaluser.11201116@example.com';
-- 6. DM conversations the QA account is in (with all members)
SELECT c.id, c.name, c."isDM", c."workspaceId",
       (SELECT string_agg(u2.username, ', ') FROM "ChannelMember" cm2 JOIN "User" u2 ON u2.id = cm2."userId" WHERE cm2."channelId" = c.id) AS members
FROM "Channel" c JOIN "ChannelMember" cm ON cm."channelId" = c.id JOIN "User" u ON u.id = cm."userId"
WHERE c."isDM" = true AND u.email = 'qa.normaluser.11201116@example.com';
-- 7. Test channel
SELECT c.id, c.name, c."workspaceId", c."archivedAt", c."createdAt", cu.username AS created_by
FROM "Channel" c JOIN "User" cu ON cu.id = c."createdBy" WHERE c.name = 'QA Test Channel!';
-- 8. Test project and tasks
SELECT p.id, p.name, p.key, p."workspaceId", p."createdAt" FROM "Project" p WHERE p.name = 'QA Test Project';
SELECT t.id, t.number, t.title, t.status, t."projectId", t."workspaceId", t."createdAt" FROM "Task" t
WHERE t.title ILIKE '[QA test]%' OR t."projectId" IN (SELECT id FROM "Project" WHERE name = 'QA Test Project');
-- 9. Pending test invitation, and audit entries from the QA session (audit entries are kept)
SELECT i.id, i.email, i.status, i."workspaceId", w.name AS workspace, i."createdAt" FROM "Invitation" i JOIN "Workspace" w ON w.id = i."workspaceId"
WHERE i.email = 'qa.invitee.test@example.com';
SELECT a.id, a.action, a."targetType", a."targetId", left(a.details, 80) AS details, a."createdAt" FROM "AuditLog" a
WHERE a.details ILIKE '%QA Test%' OR a.details ILIKE '%qa.invitee.test%' ORDER BY a."createdAt";
ROLLBACK;
```

This SQL was checked against the current schema on a local database. It was **not** run against production: running it there needs your go-ahead and a read-only connection.

## 8. Known limitations carried into production

- **Real-time:** a middlebox that accepts the WebSocket upgrade and then drops it gets no polling fallback. More than one backend instance needs Redis plus sticky sessions.
- **One account per browser profile.** A sign-in in another tab switches every tab of that profile, and anything in progress there (for example a call) ends.
- **Redis multi-instance tests** (21) are not run in CI or locally (no Redis). They cover a configuration production doesn't use.
- **M15:** sign-up still reveals whether an e-mail is registered. This is a product decision that needs e-mail verification first.
- **L7:** the minimum password length stays at 6 (a documented product rule); people see a strength hint.
- **M18:** serial database round trips were reduced. Co-locating the API and the database (Neon ap-southeast-1; Render's default region is Oregon) removes most of the remaining latency.
- **`relationJoins`** is a Prisma preview feature. To revert, remove `previewFeatures = ["relationJoins"]` from `schema.prisma`; no schema change.
- **Credential hygiene** from the earlier QA session (rotate the Administrator and Team Lead passwords; suspend the QA account) is still open (§7).
