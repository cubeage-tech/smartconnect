# SmartConnect — Real-time / isolation / People remediation tracker

**Date:** 2026-11-23, final audit and pre-commit hardening 2026-11-24 · **Baseline:** `ebd4317`; fixes committed as `16a24e9` · Investigation: [SMARTCONNECT_REALTIME_SECURITY_INVESTIGATION.md](SMARTCONNECT_REALTIME_SECURITY_INVESTIGATION.md) · Report: [SMARTCONNECT_REALTIME_FINAL_REPORT.md](SMARTCONNECT_REALTIME_FINAL_REPORT.md)

Status values: **Fixed** (code changed, tests added, verified) · **Verified, no change** (behaviour already correct, now pinned by tests) · **Needs production check** (cannot be confirmed from the repository).

## Findings

| Id | Finding | Severity | Status | Changed files | Tests |
|----|---------|----------|--------|---------------|-------|
| RT-A1 | Socket.IO client never falls back to HTTP long-polling when the WebSocket handshake fails, so there are no live events and new messages show only after a reload | High | **Fixed** | `frontend/src/hooks/useSocket.ts` | `frontend/src/hooks/useSocket.test.ts`; E2E `realtime-isolation.spec.ts` › *network blocks WebSockets* |
| RT-A2 | Tabs of one browser profile are not kept on the shared sign-in. A stale tab silently becomes another account on reload; its sign-out ends the other account's session and keeps its own | Medium | **Fixed** | `frontend/src/lib/sharedSignIn.ts` (new), `frontend/src/contexts/AuthContext.tsx`, `frontend/src/lib/devTabSession.ts` (export only) | `frontend/src/lib/sharedSignIn.test.ts`, `frontend/src/contexts/AuthContext.crossTab.test.tsx`; E2E › *two tabs of ONE browser profile* |
| RT-SEC | Server-side message isolation (workspace / channel / private / DM / rooms / history / reconnect) | — | **Verified, no change** | — | `backend/tests/realtime-isolation.test.ts`; E2E › *separate people…outsider receives nothing* |
| RT-UI | Open conversation shows only its own messages (switching, duplicates, ordering, late acks, backfill) | — | **Verified, no change** | — | `frontend/src/components/chat/ChatArea.isolation.test.tsx` |
| PPL-B1 | Member profile loaded the whole `UserProfile` row. Any column missing from the database (e.g. pending migration `20261120120000_qa_h4_profile_avatar`) fails every profile with 500 while the list works | High | **Fixed** (code); **Needs production check** (DB state) | `backend/modules/members/members.service.ts` | `backend/tests/realtime-isolation.test.ts` › *does not depend on profile columns it does not show* |
| PPL-B2 | Failed profile load was a dead end (no retry, no Message) | Low | **Fixed** | `frontend/src/components/people/ProfileModal.tsx` | `frontend/src/components/people/people.test.tsx` (+3) |
| DEP-1 | Deployed commit unknown: local `main` (`ebd4317`) is not on `origin` (`origin/main` = `6d5057b`) | — | **Needs production check** | — | — |

## Requested test coverage

### Messaging

| # | Requirement | Covered by |
|---|---|---|
| 1 | Two authorized users receive a channel message without reload | backend `realtime-isolation` › *channel message reaches A and B live*; E2E *separate people*; existing `smoke.spec.ts` |
| 2 | User outside a workspace receives none of its channel events | backend › *C (another workspace) receives nothing*; › *outsider cannot subscribe…* |
| 3 | Cannot join another user's private conversation room | backend › *outsider cannot subscribe to a channel, a DM, a thread or an internal room* (`user:<id>`, `ws:<id>`, DM, thread) |
| 4 | DMs reach only their participants | backend › *a DM reaches only its two participants* (D in the workspace and C outside both receive nothing) |
| 5 | Switching channels removes the previous subscription (client) | `ChatArea.isolation` › *switching conversations…removes the old listeners*. Server subscriptions are per membership by design (all authorized rooms), not per open view |
| 6 | Switching DMs does not leak prior messages | `ChatArea.isolation` › *carries nothing over — not even a late send acknowledgement*; E2E *separate people* |
| 7 | Reconnection restores only authorized subscriptions | backend › *a reconnect restores exactly the authorized subscriptions*; existing `realtime.test.ts` |
| 8 | History API respects workspace and conversation authorization | backend › *participants read their conversations; an outsider gets 403* (messages, search, pinned, thread) |
| 9 | Duplicate events do not create duplicate UI messages | `ChatArea.isolation` › *renders a repeated event once*; backend › *retried send (same clientId) stored and delivered once* |
| 10 | Simultaneous conversations stay isolated | `ChatArea.isolation` › *ignores events for every other conversation*; backend DM/channel tests run several conversations at once |
| 11 | Pagination does not mix conversations | backend › *pages never mix conversations* (60 + 60 interleaved; foreign `cursor` / `after` refused with 400) |
| 12 | Attachments and voice messages still work | existing suites, run in full: backend `t32-attachments`, `t33-uploads`, `t35-upload-storage-errors`; frontend `MessageAttachment`, `voice/*`; E2E `t35-uploads.spec.ts` |

### People directory

| # | Requirement | Covered by |
|---|---|---|
| 1 | Directory loads for an authorized user | backend › *members load the directory*; `people.test.tsx` |
| 2 | Selecting a valid member succeeds | backend (full profile row); `people.test.tsx`; E2E *separate people* (People → profile → Message) |
| 3 | Existing DM opens | backend › *Message opens the existing DM* (both directions return the same id) |
| 4 | New DM created when none exists | backend (B ↔ D); E2E (A → B) |
| 5 | Invalid user id → controlled error | backend › *invalid and non-member ids get controlled errors* (400 / 404 with message); `people.test.tsx` 404 case |
| 6 | Cross-workspace access rejected | backend › *an outsider is refused* (403 list and profile); DM to a non-member → 403 |
| 7 | Incomplete optional profile fields don't crash the UI | `people.test.tsx` › *optional fields are all missing*; backend › profile with no profile row; E2E users have no profile row |
| 8 | Concurrent selection creates no duplicate conversation | backend › *concurrent opens create exactly one* (5 parallel requests from both sides, 1 row) |

### Cross-user security matrix (independent logins: A, B in W; D in W; C outside)

| Action by C (or D for the DM) | Expected | Result |
|---|---|---|
| Receive W/General `message:received` | none | none ✔ |
| Receive A–B DM events (C and D) | none | none ✔ |
| `channel:join` W/General, DM, `user:<B>`, `user:<A>`, `ws:<W>` | refused | refused ✔ |
| `thread:join` on a DM message | refused | refused ✔ |
| `message:send` into W/General or the DM | refused, nothing stored | refused, 0 rows ✔ |
| Typing events from the DM | none | none ✔ |
| `GET` messages / search / pinned of W/General or the DM | 403 | 403 ✔ |
| `GET` thread of a DM message | 403/404, no content | ✔ |
| `GET` W member list / profile | 403 | 403 ✔ |
| `POST /api/channels/dm` inside W | 403 | 403 ✔ |
| C's browser frames contain A↔B text (E2E) | never | never ✔ |

## Verification results

| Check | Result |
|---|---|
| New tests on the pre-fix code | The bug-reproducing tests fail (3 cross-tab unit, profile schema drift, WebSocket-blocked E2E, two-tab E2E); the isolation tests pass (behaviour already correct) |
| Frontend: type check / unit (81 files, 505 tests) / production build | ✅ / ✅ / ✅ |
| Browser E2E full suite / hosting suite | ✅ 41 passed / ✅ 15 passed |
| Backend: type check / production build / `prisma validate` / migration diff | ✅ / ✅ / ✅ / ✅ no drift |
| Backend full suite, run 1 (concurrent with E2E) | 708 passed, 5 load timeouts. Those files re-run alone: 25/25 ✅ |
| Backend full suite, run 2 (unloaded) | 712 passed, 1 failed: **pre-existing** test-order dependency in `member-email-privacy.test.ts`, which also fails on baseline `ebd4317` (final report §6.1) |
| Backend full suite, **final audit 2026-11-24** (fresh DB, serial, alone) | ✅ **713 passed, 0 failed**, 21 skipped (Redis-only suites), 72 files |
| Frontend unit, **final audit** | ✅ **82 files, 511 tests** (includes 6 new Home page tests) |
| Browser E2E, **final audit** | ⚠️ **40/41**. The 1 failure is intermittent (`qa-remediation.spec.ts:34`) and passed 2/2 when re-run alone (AUD-E2E-1) |
| Type checks, builds, `prisma validate`, migrate status, both migration diffs, **final audit** | ✅ all |
| Backend full suite, **pre-commit hardening 2026-11-24** (fresh DB, serial, alone) | ✅ **716 passed, 0 failed**, 21 skipped (Redis-only suites), 73 files (includes 3 new `invitation-privacy` tests) |
| Frontend unit, **pre-commit hardening** | ✅ **82 files, 511 tests** |
| Browser E2E, **pre-commit hardening** | ✅ **41/41** (15.3 min). `qa-remediation.spec.ts` repeated: ✅ 50/50, plus ✅ 20/20 for the desktop test |
| Type checks, builds, `prisma validate`, migrate status, both migration diffs, `git diff --check`, **pre-commit hardening** | ✅ all |

## Final audit and pre-commit hardening items (2026-11-24)

| Id | Item | Severity | Status | Files |
|---|---|---|---|---|
| TEST-ORDER-1 | `member-email-privacy.test.ts` relied on another file having created SmartConnect Collab, so it failed when it ran first on a fresh DB | Test infra | **Fixed** (test setup only: `beforeAll(() => reconcileSharedWorkspace())`; no expectation changed). 10/10 alone on a fresh DB; full suite 713/713 | `backend/tests/member-email-privacy.test.ts` |
| HOME-1 | Home page redesign (live unread summary, online people, recent conversations, channels by unread) | Feature | **Done**, uncommitted. Covered by 6 unit tests plus the E2E theme/viewport sweep | `frontend/src/components/layout/HomeView.tsx`, `HomeView.test.tsx` (new), `frontend/src/pages/workspace/HomePage.tsx` |
| AUD-E2E-1 | Intermittent E2E: reaction picker step in `qa-remediation.spec.ts:34`. The trace shows the picker opened, then closed about 80 ms later when the message list scrolled up about one message (the picker closes on list scroll by design). The test depended on live `example.com` link previews, which grow messages late. The exact trigger of that scroll could not be reproduced (0 of 22 targeted runs) | Test flakiness | **Fixed** (test only, pre-commit hardening): `/api/preview` answered in the browser (`page.route`, as in `stage4-company-overview.spec.ts`); asserts that the late preview card renders; waits for a still list before the end-of-list check and before opening the picker. Picker assertions unchanged. No product code changed. Results: production readiness §1.1 | `frontend/e2e/qa-remediation.spec.ts` |
| AUD-PII-1 | Invited person's address (1) in the failed account-invitation e-mail log line, (2) in the wrong-account 403 (also logged by the error handler), and (3), found while fixing, in Brevo's rejection reason when it repeats the address (logged by the mailer and the invitation services) | Low | **Fixed** (pre-commit hardening). The log line names the role; the 403 reads *"This invitation was sent to a different account. Sign in with the invited e-mail address, or ask for a new invitation."*; the provider reason has the address replaced by `[recipient]`. Failures are still logged and reported to the sender. The 3 new tests fail on `16a24e9` and pass now | `backend/modules/teamManagement/teamLeads.service.ts`, `backend/modules/invitations/invitations.service.ts`, `backend/utils/mailer.ts`, `backend/tests/invitation-privacy.test.ts` (new) |
| AUD-DEP-1…5 | Deployment blockers: deploy source branch, production migration state, actual Render start command, Cloudinary/Brevo credentials, frontend backend URL / `APP_URL` | Deployment | **Owner action**, no code (production readiness §2) | — |
