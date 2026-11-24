# SmartConnect — Real-time messaging, message isolation and People directory: final report

**Date:** 2026-11-23, verified 2026-11-24, re-verified in the final production-readiness audit · **Baseline:** `main` @ `ebd4317` · **Changes:** committed by the owner as `16a24e9` (on `cubage/main`); not deployed. Final readiness verdict: `docs/SMARTCONNECT_PRODUCTION_READINESS.md`.
Details: [investigation](SMARTCONNECT_REALTIME_SECURITY_INVESTIGATION.md) · [remediation tracker](SMARTCONNECT_REALTIME_REMEDIATION_TRACKER.md)

## 1. Executive summary

- **"Messages need a reload"**
  - The browser's real-time connection only ever tried WebSocket. On networks that refuse WebSocket upgrades but allow normal HTTPS (proxies, firewalls, some antivirus and mobile networks), it retried WebSocket forever and never fell back to HTTP long-polling.
  - Pages and history still loaded over REST, so the app looked normal, but no live message arrived until a reload.
  - **Fixed:** the client now falls back to long-polling. Reproduced and verified in a local production replica and in E2E.
- **"Another person's messages appear after reloading"**
  - In production, every tab of a browser profile shares one sign-in. A tab that was open while another tab signed in as a different person kept behaving as the old account. On its next reload it silently became the new account and showed that person's conversations at the same address.
  - That stale tab's "Sign out" also ended the *other* person's session while leaving its own valid on the server.
  - **Fixed:** tabs now follow the shared sign-in immediately, and sign-out only ever ends the tab's own session.
- **No server-side data leak was found.**
  - Every message read and delivery path was audited.
  - Every path is now pinned by a 13-test security matrix plus E2E: three-plus independently signed-in users, outsider receives and reads nothing.
- **"People → select a user → error"**
  - The profile endpoint loaded every column of the profile table although it shows four. If the database lacks the column added by the latest migration (`20261120120000_qa_h4_profile_avatar`), the People list works but **every** profile fails with "Something went wrong on our side". That matches the report exactly and was reproduced on a throwaway database.
  - **Fixed:** the endpoint reads only what it shows, and the profile card keeps **Message** and **Try again** available on a server error.
  - **Whether production's database is in that state still needs a read-only check (§7).**

## 2. Root cause — Issue A (real-time and "other person's messages")

| | Cause | Proof |
|---|---|---|
| A1 | `frontend/src/hooks/useSocket.ts` created the Socket.IO client with `transports: ['websocket','polling']` but without `tryAllTransports`. In socket.io-client 4.8, `engine.io-client` moves to the next transport only when that flag is set, so a refused WebSocket handshake was retried forever. | Production bundle + `NODE_ENV=production` backend, refused WebSocket handshake: 0 polling requests, message not delivered live, visible after reload. Same scenario with the fix: 7 polling requests, delivered live. E2E test fails on the old code and passes on the fix. |
| A2 | `localStorage["token"]` is shared by all tabs and read once per page load. `AuthContext` didn't react to another tab changing it. `logout()` sent the *shared* token, not the tab's own, to `/api/auth/logout`. A 401 cleared the shared token. | Two tabs, one profile: tab 1 signed in as A, tab 2 as B. Tab 1 kept A in memory and became B on its next load. Its sign-out ended B's session. With the fix, tab 1 restarts as B at once: every request after its reload carries B's token, A's session is never ended by mistake, and B's sign-out ends only B's. Unit and E2E tests fail on the old code and pass on the fix. |

Ruled out by reproduction:

- Backend restarts and Render-style spin-down, including a send made during the outage (recovered without reload).
- Conversation switching (no leak).
- Duplicate or out-of-order events.
- Listener leaks.
- Reconnect backfill.
- Cross-workspace event filtering.
- Socket room authorization.
- History pagination.

## 3. Root cause — Issue B (People)

`backend/modules/members/members.service.ts getMemberProfile` selected `user.profile` with `profile: true`, i.e. every `UserProfile` column. The directory list selects two. A database that runs the current code without the `avatarAttachmentId` column (migration not applied, or backend and database out of step) serves the list but fails every profile with a 500. Reproduced on a throwaway database. On a migrated database the flow works in every variant tried:

- created workspaces and SmartConnect Collab;
- users with full profiles and with no profile row;
- dev and production builds;
- existing and new DMs.

## 4. Security assessment

- **No confirmed server-side privacy vulnerability.** Verified with users A and B in workspace W, D in W but not in the A–B DM, and C outside W:
  - C and D receive no events from conversations they aren't in.
  - C cannot subscribe to W's channel, the DM, a thread or internal rooms (`user:<id>`, `ws:<id>`).
  - C cannot post into them (nothing is stored).
  - C gets 403 on messages, search, pinned, thread, member list, profile and DM creation.
  - A cursor taken from another conversation is refused.
  - Reconnecting restores only subscriptions the database still authorizes.
- **A2 is a session-hygiene defect, not a server breach** (Medium). It needs two accounts signed into one browser profile, so whoever triggers it already holds both credentials. It matters on shared computers, and because a stale tab's "Sign out" left its own session valid on the server.
- No containment action is required for data. After deploying, people who used "Sign out" in a tab that was showing a different account than the latest sign-in may still have a live session. **Account menu → Password & security → Sign out everywhere** (`/api/auth/logout-all`) ends those.

## 5. Changes

No architecture change, no new dependency, no schema or migration change, no environment variable change.

| File | Change |
|---|---|
| `frontend/src/hooks/useSocket.ts` | `tryAllTransports: true`: WebSocket first, HTTP long-polling when the handshake fails. |
| `frontend/src/lib/sharedSignIn.ts` (new) | Decides what a tab does when the shared sign-in changes: ignore (same person), sign out, or switch. |
| `frontend/src/contexts/AuthContext.tsx` | Listens for shared sign-in changes and starts over with a full page load (`/` or `/login`) when the account changes. `logout()` ends this tab's own session. A 401 or sign-out clears the shared sign-in only if it is this tab's. T.37 isolated development tabs are unaffected. |
| `frontend/src/lib/devTabSession.ts` | Exports the shared token key (no behaviour change). |
| `backend/modules/members/members.service.ts` | Profile selects `displayName`, `title`, `bio`, `timezone` only. |
| `frontend/src/components/people/ProfileModal.tsx` | On a server or network error: **Try again**, and **Message** stays available. 4xx errors stay final. |

The signup concurrency fix (`ebd4317`) was not touched.

## 6. Tests

### Added (49)

| Suite | File | Tests |
|---|---|---|
| Backend (real Socket.IO and Postgres) | `backend/tests/realtime-isolation.test.ts` | 13 |
| Frontend unit | `src/lib/sharedSignIn.test.ts` (8), `src/contexts/AuthContext.crossTab.test.tsx` (7), `src/hooks/useSocket.test.ts` (2), `src/components/chat/ChatArea.isolation.test.tsx` (4), `src/components/people/people.test.tsx` (+3) | 24 |
| Browser E2E | `frontend/e2e/realtime-isolation.spec.ts` | 3 |

The tests that cover a fixed defect were run against the pre-fix code and fail there:

- the 3 cross-tab unit tests;
- the profile schema-drift test;
- the WebSocket-blocked E2E test;
- the two-tab E2E test.

The requirement-by-requirement mapping is in the tracker.

### Results (all on local throwaway databases; the hosted database was never used)

| Check | Result |
|---|---|
| Frontend type check (`tsc --noEmit`) | ✅ pass |
| Frontend unit tests (`vitest run`) | ✅ 81 files, 505 tests passed |
| Frontend production build (`tsc` + `vite build`) | ✅ pass (existing chunk-size warning only) |
| Browser E2E, full suite (`playwright test`) | ✅ 41 passed (includes the 3 new) |
| Production-hosting E2E (`test:hosting`) | ✅ 15 passed |
| Backend type check (`tsc --noEmit`) | ✅ pass |
| Backend production build (`tsc -p tsconfig.json`) | ✅ pass |
| `prisma validate` | ✅ valid |
| `prisma migrate status` (throwaway DB) | ✅ up to date |
| `prisma migrate diff` migrations ↔ schema (shadow DB) | ✅ no difference |
| Backend full suite (`vitest run`), run 1 | ⚠️ 708 passed, 5 failed, 21 skipped. All 5 were 15 s timeouts in `group-dms`, `members-presence` and `socket-revocation`, while the E2E suite ran concurrently (files took 2–3× normal time). Those 3 files re-run alone: ✅ 25/25. |
| Backend full suite, run 2 (unloaded, fresh DB) | ⚠️ 712 passed, 1 failed, 21 skipped (72 files). The failure is **pre-existing and unrelated** (§6.1). |
| **Final audit, 2026-11-24** (`16a24e9` + §6.1 fix + Home redesign; each suite alone, fresh DB) | Backend ✅ **713 passed, 0 failed**, 21 skipped (Redis-only). Frontend ✅ **511/511**. Browser E2E ⚠️ **40/41**: one intermittent, network-timing test (`qa-remediation.spec.ts:34`, reaction picker) that passed 2/2 when re-run alone (production readiness §1.6). Type checks, builds, `prisma validate` and both migration diffs ✅. |
| **Pre-commit hardening, 2026-11-24** (the above + AUD-E2E-1 test fix + AUD-PII-1 privacy fix; each suite alone, fresh DB) | Backend ✅ **716 passed, 0 failed**, 21 skipped (Redis-only), 73 files, including the 3 new `invitation-privacy` tests. Frontend ✅ **511/511** (82 files). Browser E2E ✅ **41/41**. The stabilised `qa-remediation` spec passed 50/50 (`--repeat-each=10`) plus 20/20 for the desktop test alone. Type checks, both builds, `prisma validate`, migrate status, both migration diffs and `git diff --check` ✅. Details: production readiness §1.1, §1.3, §1.6. |

Builds were run with output redirected to a temporary folder, so the git-ignored `frontend/dist` and `backend/dist` were left as they were.

#### 6.1 Backend full suite, unloaded re-run

712 passed, 1 failed, 21 skipped, in 19 min. The failure:

- **Test:** `tests/member-email-privacy.test.ts` › *newly registered accounts in the Default Workspace / Organization (FA-SEC-03) › cannot harvest anyone's e-mail from any directory*.
- **What failed:** the test's own setup. `POST /api/auth/signup` answered 503 `SharedWorkspaceMissingError`, because the shared SmartConnect Collab workspace did not exist yet.
- **Why:** the server creates Collab at startup. In the test suite, only `p2-shared-workspace`, `stage1-hierarchy`, `stage2-team-leads` and `stage3-team-members` create it, as a side effect. On a fresh database, Vitest ran this file first, before any of them. In run 1 the file ran later and passed.
- **Pre-existing:** run alone on a fresh database, the test fails identically **with the baseline `ebd4317` code**, and with these changes. The file's other 9 tests pass in every run, including the profile e-mail-privacy tests that cover the changed endpoint.
- **Fix (applied in the final audit, 2026-11-24):** `beforeAll(() => reconcileSharedWorkspace())` in `tests/member-email-privacy.test.ts`, as those four files do. Test setup only; no expectation changed. The file then passed 10/10 alone on a fresh database, and the full suite 713/713.

Across both full runs, every backend test file passed at least once with these changes, and every failure was explained: 5 load timeouts in run 1 (re-run: 25/25) and this ordering dependency in run 2.

## 7. Deployment requirements

1. These changes are committed as `16a24e9` and pushed to `cubage/main`; `origin` (`6d5057b`) doesn't have them. Deploy backend and frontend **from the same commit**, and confirm which remote and branch Render and Vercel build from (production readiness §2, B1).
2. **Production database check (read-only)**, before or right after the backend deploy:

   ```sql
   SELECT migration_name, finished_at, rolled_back_at
   FROM "_prisma_migrations"
   WHERE migration_name = '20261120120000_qa_h4_profile_avatar';

   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'UserProfile' AND column_name = 'avatarAttachmentId';
   ```

   Or `npx prisma migrate status` with the production `DATABASE_URL`.

   - If the migration is missing, apply it with `npx prisma migrate deploy`. It's additive: one nullable column, an index and a foreign key. This is a production change for the owner to approve.
   - Also confirm the **actual** Render start command runs `npm run db:deploy` before `server.ts`, as `render.yaml` does. A service created by hand may not.
3. **Render (backend):** redeploy. No environment changes. Keep **one instance**: the polling fallback needs sticky sessions if the service is ever scaled out.
4. **Vercel (frontend):** redeploy. No environment changes. Confirm `VITE_BACKEND_URL` is the backend **origin with no path**. A path such as `/api` is read by Socket.IO as a namespace and the connection is refused.
5. **After deploy, smoke test** with two separate browsers, or a normal and a private window:
   - A ↔ B DM is live in both directions;
   - People → select a person → profile → Message opens the DM.
6. **Tell testers:** production allows one account per browser profile. To test several accounts at once, use separate browser profiles or private windows. Signing in as someone else in another tab now switches every tab of that profile at once.

## 8. Remaining limitations

- A network device that *accepts* the WebSocket upgrade and then drops the connection gives no polling fallback. Polling-first would cover it but needs sticky sessions with more than one instance.
- Switching accounts in another tab reloads all other tabs of that profile, so in-progress work there (for example an active call) ends. Drafts are kept per account.
- Issue B's production state isn't confirmed until the check in §7.2 is run. If the database turns out to be fully migrated, B is still fixed in code (narrow select plus a recoverable card). But the live failure would then have another trigger worth capturing: the browser console error and the response of `GET /api/workspaces/<id>/members/<userId>`.
- Not addressed (out of scope, already tracked in the QA report): API and database in different regions (latency, QA M18), and Render free-tier cold starts.
