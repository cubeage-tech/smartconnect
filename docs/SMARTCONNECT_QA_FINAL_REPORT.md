# SmartConnect — QA Remediation Final Report

Date: 2026-11-20 · Branch `main` · Base commit `31af1f6` · **Nothing has been committed, pushed or deployed.** All changes are in the working tree.

Source: the QA report (https://claude.ai/artifact/AQBwpGdKq6tZeZMTmrQdvd), 72 findings. Each finding’s full record (reproduction, root cause, files, tests, verification) is in `docs/SMARTCONNECT_QA_REMEDIATION_TRACKER.md`; deployment steps and the test-data cleanup manifest are in `docs/SMARTCONNECT_PRODUCTION_READINESS.md`.

## At a glance

| Outcome | Count | Findings |
|---|---:|---|
| **Resolved** — Fixed in code and verified by an automated test or a browser measurement | 63 | H1, H2, H3, H4, H5, H6, M1, M2, M3, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M16, M17, L1, L2, L3, L4, L5, L6, L8, L9, L10, L11, L12, L13, L14, L15, L16, L17, L18, L19, L20, L21, L22, L23, L24, L25, L26, L27, L28, L30, L31, L32, L33, L35, L36, L37, L38, L39, L40, L41, L42, L43, L44, L45 |
| **Closed, no defect** — Investigated and measured: no code defect | 3 | M4, L34, V1 |
| **Blocked (code done)** — Code fixed and tested; production stays broken until Render credentials are corrected | 2 | C1, C2 |
| **Partially resolved** — Improved; the remainder needs a product or infrastructure decision | 2 | M18, L7 |
| **Unresolved** — Not changed: a product decision or the owner’s own production data | 2 | M15, L29 |
| **Total** | **72** | |

Tests: backend 697 passed · 0 failed · 21 skipped (718) — the 21 skips are the same as at the baseline · frontend 481 passed, 0 failed (77 files) · browser E2E 38 of 38 tests pass across 19 spec files (final run: 37 passed + 1 environment failure that passed on re-run) · type checks clean · production builds succeed. Details in §14–§18.

## 1. Total original issues

72 — 2 Critical, 6 High, 18 Medium, 45 Low and 1 marked “manual re-check” (V1). IDs and severities are unchanged from the QA report.

## 2. Resolved issues

**63 resolved** by a code change, each verified by an automated test or a browser measurement: H1, H2, H3, H4, H5, H6, M1, M2, M3, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M16, M17, L1, L2, L3, L4, L5, L6, L8, L9, L10, L11, L12, L13, L14, L15, L16, L17, L18, L19, L20, L21, L22, L23, L24, L25, L26, L27, L28, L30, L31, L32, L33, L35, L36, L37, L38, L39, L40, L41, L42, L43, L44, L45.

A further **3 closed without a code change** after investigation: M4 (the table does refresh after a drawer edit — the QA observation window was shorter than the production round trip; proven in a browser test), V1 (a space typed after an emoji is kept; the QA observation came from synthetic keystroke injection; proven in a browser test) and L34 (the settings page is centred — measured; the QA estimate came from a scaled screenshot).

## 3. Partially resolved issues

- **M18 — slow server calls.** Serial database round trips per request cut by 14–69% per endpoint (median 56%, §13) and duplicate client requests removed. The remaining latency is the distance between the API and the database; it goes away only when they run in the same region (manual action, §22).
- **L7 — weak password accepted.** A live strength hint now guides people to a stronger password. The minimum length (6) is a documented product rule (`backend/lib/passwordPolicy.ts`) and was not raised without a decision; raising it is a one-line change plus a migration plan for existing users.

## 4. Unresolved issues

- **M15 — sign-up tells anyone which e-mails are registered.** Deferred as a product decision. Making sign-up enumeration-proof means confirming the address by e-mail before saying anything, which depends on working e-mail (C2) and changes the sign-up flow for everyone. The existing sign-up rate limit (10 per 15 minutes per IP) still applies.
- **L29 — “Embroidary” typo in the SmartUnifolio description.** This is production data typed by the workspace owner, not code. The owner can correct it in Workspace settings; it was not edited because production data is out of scope.

## 5. Blocked issues

- **C1 — file uploads fail.** The code now reads the Cloudinary settings robustly, checks them at startup (logging variable names only), and tells people the real reason (rejected credentials, quota, outage) with the right status codes. **Uploads in production stay off until valid `CLOUDINARY_*` values are set on Render.** H4’s profile photo upload depends on this too.
- **C2 — password reset e-mail never arrives.** The server no longer claims a reset e-mail was sent when it was not: with no e-mail service, or after Brevo refuses or times out, people get an honest “can’t be sent right now” message, still without revealing which addresses have accounts. **Reset e-mails in production need a valid `BREVO_API_KEY` and a verified `BREVO_FROM_EMAIL` on Render.** Until then, administrators can use “Set password…” in User Management.

## 6. Original severity distribution

| Severity | Reported | Resolved | Closed, no defect | Blocked (code done) | Partially resolved | Unresolved |
|---|---:|---:|---:|---:|---:|---:|
| Critical | 2 | 0 | 0 | 2 | 0 | 0 |
| High | 6 | 6 | 0 | 0 | 0 | 0 |
| Medium | 18 | 15 | 1 | 0 | 1 | 1 |
| Low | 45 | 42 | 1 | 0 | 1 | 1 |
| Re-check | 1 | 0 | 1 | 0 | 0 | 0 |
| **Total** | **72** | **63** | **3** | **2** | **2** | **2** |

All 6 High findings are resolved. Of the 18 Medium findings, 15 are resolved, M4 is closed with no defect, M18 is partially resolved and M15 is deferred.

## 7. Root cause for every issue

| ID | Sev. | Finding | Root cause | Outcome |
|---|---|---|---|---|
| C1 | Critical | File uploads fail for everyone | Render Cloudinary values rejected by Cloudinary (401/403/404); code could not tell quota from outage; no startup check | Blocked (code done) |
| C2 | Critical | E-mail is not configured, so password reset never arrives | forgotPassword awaited a mailer that silently returned when Brevo unset and always replied "has been sent"; refusals leaked account existence; admin force-reset claimed "sent" | Blocked (code done) |
| H1 | High | Task drawer’s Close, Share and Delete buttons are hidden under the top bar | TaskDrawer rendered inside &lt;main relative z-10&gt; stacking context; header z-[100] above | Resolved |
| H2 | High | Reaction picker is cut off on recent messages | picker was absolute inside the message row in the scrolling (overflow) list -&gt; clipped; placed left-0 far from button | Resolved |
| H3 | High | Channels say “No messages yet — say hello!” while they are still loading | empty state rendered whenever messages.length===0, ignoring messagesLoaded; load errors went to a generic banner | Resolved |
| H4 | High | Full name from sign-up is never shown, and nobody can change their name or photo | full name stored in UserProfile.displayName but /api/users returned only username; screens rendered username; no edit/photo | Resolved |
| H5 | High | “Add Team Lead” button text spills out of the button | header text block and Button both flex-shrinkable; long paragraph squeezed button to 116px | Resolved |
| H6 | High | Content Moderation shows raw HTML in results | MessageModeration rendered m.content (stored HTML) as text; API lacked workspace | Resolved |
| M1 | Medium | Reaction picker won’t close with Escape or by clicking another message | message list container stopPropagation() swallowed outside clicks; no Escape handler | Resolved |
| M2 | Medium | Dialog backdrops don’t cover the top bar | Modal rendered in place inside &lt;main z-10&gt;; CallLobby z-70 &lt; header z-100 | Resolved |
| M3 | Medium | Toasts sit on top of the Send button | ToastContainer position bottom-right over composer Send | Resolved |
| M4 | Medium | Team Tasks list doesn’t update after a status change | drawer save -&gt; onChanged -&gt; refresh() wiring is correct; production latency (PATCH 3-8s + reload) exceeded the 4s observation window | Closed, no defect |
| M5 | Medium | Board’s inline “Add task” gives no feedback for up to 10 seconds | QuickAdd disabled the input but showed nothing while createTask (6-10s in prod) ran | Resolved |
| M6 | Medium | @mention suggestions take about 3 seconds, with no loading state | mention list opened only once results arrived; no cache | Resolved |
| M7 | Medium | Ctrl+K search is slow even for channels already on screen | palette only showed server results (3-6s) | Resolved |
| M8 | Medium | Dashboard chart axis labels lose their first digit | AreaChart margin left -16 + YAxis width 32 clipped 2-digit ticks | Resolved |
| M9 | Medium | Admin user totals disagree between pages | analytics/stats used prisma.user.count() incl. system + deleted-user sentinel; list excludes them | Resolved |
| M10 | Medium | Channel Administration shows archived channels as Active and can’t tell workspaces apart | UI hard-coded "Active"; type showed Public for every non-DM; API had no workspace | Resolved |
| M11 | Medium | Pending invitations count is wrong in Workspace Overview | overview counted AccountInvitation only, not workspace e-mail Invitation rows | Resolved |
| M12 | Medium | No unread hint on other workspaces | no API for unread across workspaces; rail had no indicator | Resolved |
| M13 | Medium | Thread reply toolbar overflows its box | toolbar always overflow-x-auto no-scrollbar; 14 buttons in ~277px | Resolved |
| M14 | Medium | Message box placeholder never shows | Tiptap Placeholder sets data-placeholder but index.css had no ::before rule | Resolved |
| M15 | Medium | Sign-up tells anyone which e-mails are registered | public signup must say why it failed; enumeration-proof signup needs e-mail verification (blocked by C2 config); directSignupLimiter 10/15min exists | Unresolved |
| M16 | Medium | “Forgot password?” fires immediately on click | Forgot link called the API directly with the login e-mail | Resolved |
| M17 | Medium | Sign-out icon sits right next to the workspace name | Sidebar header had a one-click LogOut icon beside the workspace name | Resolved |
| M18 | Medium | The app is slow almost everywhere | API (Render, default Oregon) and DB (Neon ap-southeast-1) in different regions: every query ~175ms RTT; Prisma loaded relations with extra queries; client fired duplicate requests | Partially resolved |
| L1 | Low | The same error is shown twice | AuthForm showed inline message AND toast.error | Resolved |
| L2 | Low | Toasts ignore dark theme | react-toastify v11 injects its CSS at runtime after index.css; its :root vars won | Resolved |
| L3 | Low | Login uses the browser’s own validation bubble | login form had native required validation (noValidate only for signup) | Resolved |
| L4 | Low | A real person’s name is used as a placeholder | hard-coded placeholder | Resolved |
| L5 | Low | The URL doesn’t follow the screen | tab/admin switch changed state only; no /admin/login route | Resolved |
| L6 | Low | Password fields look already filled | dot placeholders; one shared eye | Resolved |
| L7 | Low | Weak password rule | min length 6 is a documented product decision (passwordPolicy.ts) | Partially resolved |
| L8 | Low | Avatar initials differ for the same person | Header used initials={2}, sidebar 1; initials taken from the first characters of the username; (found in verification) the 20px avatar still showed one letter | Resolved |
| L9 | Low | Avatar colours change from screen to screen | colour hashed from whatever name string; ThreadPanel/People/Profile used hard-coded teal; (found in verification) task assignee avatars (Team tasks, My tasks, board), task comments, phone Chats/Calls, Add member, admin Users and workspace Add members still coloured by name or a fixed colour | Resolved |
| L10 | Low | Links in messages aren’t clickable, and the preview starts as an empty box | editor auto-link only runs on a following space/Enter, so a URL sent last stayed text; preview loading state was a bare grey box | Resolved |
| L11 | Low | Double focus ring in the composer | global :focus-visible rule was unlayered -&gt; beat Tailwind v4 layered outline-none on the editor | Resolved |
| L12 | Low | Channel doesn’t open scrolled to the bottom | initialTopMostItemIndex aligned the last item's top; the re-pin after late growth (link preview) was gated on Virtuoso's at-bottom flag, which turns false as soon as the item grows, and align:'end' (computed from summed, rounded item sizes) stopped ~6px short, so 'Jump to latest' showed over the newest message | Resolved |
| L13 | Low | Reaction picker frame is hard-coded white | wrapper hard-coded bg-white | Resolved |
| L14 | Low | Reactions appear seconds late and push the list down | reactions waited for socket echo | Resolved |
| L15 | Low | “(edited)” is tiny; toolbar overlaps the edit box | "(edited)" span after a block element at 11px; toolbar shown while editing | Resolved |
| L16 | Low | Brand-new users are greeted “Welcome back” | static "Welcome back" + username | Resolved |
| L17 | Low | More page: odd icon and an admin section for members | Zap icon; Administration section unconditional | Resolved |
| L18 | Low | Checkbox uses the browser’s blue | no accent-color set | Resolved |
| L19 | Low | Saved profile title isn’t shown anywhere | People list not refreshed after profile save | Resolved |
| L20 | Low | Search palette input has a harsh focus box | same root cause as L11 (palette input focus:outline-none ignored) | Resolved |
| L21 | Low | Upload error text is cut off | error in a w-56 chip with truncate | Resolved |
| L22 | Low | Sidebar rows and badges don’t line up | DM section used px-3 list padding, smaller header/toggle/row padding than Channels | Resolved |
| L23 | Low | “New message” and “Create a channel” open as cramped popovers | Modal inside sidebar whose wrapper is transformed (translate-x) =&gt; containing block for fixed | Resolved |
| L24 | Low | Phone top bar: cut placeholder, ⌘ button, two search boxes | long placeholder clipped w/o ellipsis; Jump-to (⌘) button on phones; header search + page filter stacked on Chats | Resolved |
| L25 | Low | Channel order differs between phone and desktop | listChannelsForWorkspace/listChannelsForUser had no orderBy (nondeterministic) | Resolved |
| L26 | Low | Small tap targets on phones | h-6 (24px) reply link / reaction pills; admin phone tabs py-1; (found in verification) the enlarged hit area was painted under the next message and cut by the list edge for the newest message (measured 29px) | Resolved |
| L27 | Low | Channel subtitle flickers | placeholder Channel before details | Resolved |
| L28 | Low | Assignee names truncated with space to spare | fixed column widths gave Task 31% / Assigned 16% | Resolved |
| L29 | Low | Typo in the workspace description | the SmartUnifolio workspace description was typed "Embroidary" by its owner | Unresolved |
| L30 | Low | Create task: confusing Project hint | empty option labelled "Team tasks" while hint said "Left empty" | Resolved |
| L31 | Low | Validation names the wrong field | project form validation said "due date" for the Target date field | Resolved |
| L32 | Low | Board columns cut off with no scroll hint | overflow-x board with invisible overlay scrollbars and no affordance | Resolved |
| L33 | Low | Old list stays on screen after creating a project | router navigations run in a transition; old page stayed while the lazy ProjectPage chunk downloaded | Resolved |
| L34 | Low | Workspace settings use a narrow column | PageFrame is max-w-4xl mx-auto: centred (gap difference &lt;= 24px) and &gt; 700px wide at 1470px; the QA estimate came from a scaled screenshot | Closed, no defect |
| L35 | Low | Channel names aren’t normalised | placeholder suggested slugs while names are free text (built-in channels are "General" etc.) | Resolved |
| L36 | Low | Archive uses the browser’s confirm() popup | window.confirm() for archive / make owner / remove member (and admin moderation + channel delete) | Resolved |
| L37 | Low | Archiving: no progress, red “Restore”, still in sidebar | no busy state; restore styled hover:text-red; open archived channel unmarked in sidebar (hidden once closed — by design) | Resolved |
| L38 | Low | “Send invite” doesn’t send anything | header Invite dialog didn't know e-mail was off; list said "Sent" | Resolved |
| L39 | Low | Non-admin on the admin form is silently signed into the app | admin form called the same login(); no role check | Resolved |
| L40 | Low | Online users card: last row cut, two dots per row | list max-h-60 cut 4th row; emoji status + always-green pulse dot | Resolved |
| L41 | Low | Contradictory Team Lead badges | "Awaiting activation" computed for any non-accepted invitation incl. REVOKED/EXPIRED | Resolved |
| L42 | Low | Admin pages use three different header styles | each admin page had its own header style | Resolved |
| L43 | Low | Audit log shows raw IDs and timestamps | details shown verbatim (UUIDs/ISO); no filters (paging existed); subtitle "this workspace" | Resolved |
| L44 | Low | Chart gridlines are glaring in dark theme | hard-coded #f1f0f5 grid / #9ca3af ticks / white tooltip | Resolved |
| L45 | Low | Admin header is cramped on phones | dashboard title + status badge in one non-wrapping row; phone tab row cut without hint | Resolved |
| V1 | Re-check | Space after an emoji may be dropped | real typing keeps the space; the QA observation came from CDP keystroke injection | Closed, no defect |

## 8. Files modified

105 files modified and 26 added (paths relative to the repository root).

**Backend** (25)

- `backend/config/env.ts`
- `backend/lib/attachments.ts`
- `backend/lib/cloudinary.ts`
- `backend/lib/emailDelivery.ts`
- `backend/lib/settings.ts` (new)
- `backend/lib/systemAccounts.ts` (new)
- `backend/modules/admin/admin.controller.ts`
- `backend/modules/admin/admin.service.ts`
- `backend/modules/admin/userProvisioning.service.ts`
- `backend/modules/auth/auth.service.ts`
- `backend/modules/channels/channels.service.ts`
- `backend/modules/companyOverview/companyOverview.service.ts`
- `backend/modules/invitations/invitations.service.ts`
- `backend/modules/members/members.service.ts`
- `backend/modules/messages/messages.service.ts`
- `backend/modules/readState/readState.routes.ts`
- `backend/modules/readState/readState.service.ts`
- `backend/modules/uploads/message.routes.ts`
- `backend/modules/users/users.controller.ts`
- `backend/modules/users/users.routes.ts`
- `backend/modules/users/users.service.ts`
- `backend/prisma/migrations/20261120120000_qa_h4_profile_avatar/` (new)
- `backend/prisma/schema.prisma`
- `backend/server.ts`
- `backend/utils/mailer.ts`

**Backend tests** (17)

- `backend/tests/auth.test.ts`
- `backend/tests/deployment-config.test.ts`
- `backend/tests/deployment-http.test.ts`
- `backend/tests/email-validation-dos.test.ts`
- `backend/tests/helpers.ts`
- `backend/tests/p2-shared-workspace.test.ts`
- `backend/tests/qa-admin-data.test.ts` (new)
- `backend/tests/qa-c2-password-reset.test.ts` (new)
- `backend/tests/qa-h4-profile.test.ts` (new)
- `backend/tests/qa-unread-workspaces.test.ts` (new)
- `backend/tests/read-state.test.ts`
- `backend/tests/setup.ts`
- `backend/tests/stage2-team-leads.test.ts`
- `backend/tests/stage4-company-overview.test.ts`
- `backend/tests/t32-hardening.test.ts`
- `backend/tests/t32-sessions.test.ts`
- `backend/tests/t35-upload-storage-errors.test.ts`

**Frontend** (66)

- `frontend/src/App.tsx`
- `frontend/src/components/admin/AdminDashboard.tsx`
- `frontend/src/components/admin/AdminLayout.tsx`
- `frontend/src/components/admin/AdminPageHeader.tsx` (new)
- `frontend/src/components/admin/AuditLogViewer.tsx`
- `frontend/src/components/admin/ChannelManagement.tsx`
- `frontend/src/components/admin/CompanyOverview.tsx`
- `frontend/src/components/admin/FileStorageManagement.tsx`
- `frontend/src/components/admin/MessageModeration.tsx`
- `frontend/src/components/admin/TeamManagement.tsx`
- `frontend/src/components/admin/UserManagement.tsx`
- `frontend/src/components/auth/AuthForm.tsx`
- `frontend/src/components/chat/AddMemberModal.tsx`
- `frontend/src/components/chat/CallLobby.tsx`
- `frontend/src/components/chat/ChannelSettingsModal.tsx`
- `frontend/src/components/chat/ChatArea.tsx`
- `frontend/src/components/chat/LinkPreview.tsx`
- `frontend/src/components/chat/ReactionPicker.tsx` (new)
- `frontend/src/components/chat/RichTextEditor.tsx`
- `frontend/src/components/chat/ThreadPanel.tsx`
- `frontend/src/components/chat/upload/AttachmentTray.tsx`
- `frontend/src/components/layout/ChannelSearch.tsx`
- `frontend/src/components/layout/Header.tsx`
- `frontend/src/components/layout/HomeView.tsx`
- `frontend/src/components/layout/InviteMemberModal.tsx`
- `frontend/src/components/layout/MoreView.tsx`
- `frontend/src/components/palette/CommandPalette.tsx`
- `frontend/src/components/people/PeopleDirectory.tsx`
- `frontend/src/components/people/ProfileModal.tsx`
- `frontend/src/components/profile/ProfileSettingsModal.tsx`
- `frontend/src/components/sidebar/CreateChannelModal.tsx`
- `frontend/src/components/sidebar/Sidebar.tsx`
- `frontend/src/components/sidebar/WorkspaceSwitcher.tsx`
- `frontend/src/components/tasks/KanbanBoard.tsx`
- `frontend/src/components/tasks/TaskBits.tsx`
- `frontend/src/components/tasks/TaskDrawer.tsx`
- `frontend/src/components/tasks/TaskForms.tsx`
- `frontend/src/components/tasks/TaskViews.tsx`
- `frontend/src/components/tasks/team/CreateTeamTaskModal.tsx`
- `frontend/src/components/ui/Avatar.tsx`
- `frontend/src/components/ui/BottomSheet.tsx`
- `frontend/src/components/ui/EmojiPicker.tsx`
- `frontend/src/components/ui/Layer.tsx` (new)
- `frontend/src/components/ui/Modal.tsx`
- `frontend/src/components/workspaceAdmin/AddMembersModal.tsx`
- `frontend/src/components/workspaceAdmin/InvitationsPanel.tsx`
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/hooks/useHierarchy.ts`
- `frontend/src/index.css`
- `frontend/src/lib/api/companyOverview.ts`
- `frontend/src/lib/firstVisit.ts` (new)
- `frontend/src/lib/people.ts` (new)
- `frontend/src/lib/reactions.ts` (new)
- `frontend/src/lib/sanitizeHtml.ts`
- `frontend/src/lib/signupValidation.ts`
- `frontend/src/lib/workspaceEvents.ts` (new)
- `frontend/src/pages/auth/LoginPage.tsx`
- `frontend/src/pages/projects/ProjectsPage.tsx`
- `frontend/src/pages/projects/TeamTasksPage.tsx`
- `frontend/src/pages/workspace/CallsPage.tsx`
- `frontend/src/pages/workspace/ChatsPage.tsx`
- `frontend/src/pages/workspace/MorePage.tsx`
- `frontend/src/pages/workspace/WorkspaceLayout.tsx`
- `frontend/src/routes/ProtectedRoute.tsx`
- `frontend/src/routes/router.tsx`
- `frontend/src/types.ts`

**Frontend tests** (13)

- `frontend/src/components/admin/AuditLogViewer.test.tsx` (new)
- `frontend/src/components/admin/MessageModeration.test.tsx` (new)
- `frontend/src/components/admin/TeamManagement.test.tsx`
- `frontend/src/components/auth/AuthForm.login.test.tsx` (new)
- `frontend/src/components/chat/ChatArea.qa.test.tsx` (new)
- `frontend/src/components/chat/channels.test.tsx`
- `frontend/src/components/layout/layout.test.tsx`
- `frontend/src/components/palette/CommandPalette.qa.test.tsx` (new)
- `frontend/src/components/people/people.test.tsx`
- `frontend/src/components/tasks/KanbanBoard.qa.test.tsx` (new)
- `frontend/src/lib/people.test.tsx` (new)
- `frontend/src/lib/reactions.test.ts` (new)
- `frontend/src/lib/sanitizeHtml.test.ts`

**Browser (E2E) tests** (7)

- `frontend/e2e/helpers.ts`
- `frontend/e2e/qa-remediation.spec.ts` (new)
- `frontend/e2e/smoke.spec.ts`
- `frontend/e2e/stage2-team-lead.spec.ts`
- `frontend/e2e/t37-multi-tab.spec.ts`
- `frontend/e2e/t38-team-tasks.spec.ts`
- `frontend/e2e/workspace-invitations.spec.ts`

**Documentation** (3)

- `docs/SMARTCONNECT_PRODUCTION_READINESS.md` (new)
- `docs/SMARTCONNECT_QA_FINAL_REPORT.md` (new)
- `docs/SMARTCONNECT_QA_REMEDIATION_TRACKER.md` (new)

## 9. API changes

All changes are additive or make an existing answer truthful; no endpoint was removed and no request field became required.

| Endpoint | Change | Finding |
|---|---|---|
| `POST /api/auth/forgot-password` | Same neutral 200 for every address when the e-mail is accepted (new wording: “…is on its way”). **New: 503** with a “can’t be sent right now” message when e-mail is not configured or recently failing — decided before the account lookup, so it is identical for every address. | C2 |
| `POST /api/admin/users/:id/force-reset` | **New: 503** when e-mail is not configured, **502** when Brevo refuses; success now says “accepted for delivery”. | C2 |
| `POST /api/upload` (message attachments) | **New: 503 + `Retry-After: 300`** when Cloudinary reports quota/rate limit (420/429), separate from rejected credentials (503) and outages (503). File problems keep their 400. | C1 |
| `GET /api/users` | Each person now includes `displayName`, `title` and `avatarId` (nullable). | H4, L19 |
| `GET /api/users/me/profile`, `PATCH /api/users/me/profile` | Profile includes `displayName` and `avatarId`; PATCH accepts `displayName` (sign-up name rules, max 80) and `avatarId` (the user’s own uploaded, unsent JPEG/PNG/WebP/GIF ≤ 5 MB, or `null` to remove). | H4 |
| `GET /api/users/:id/avatar` (new) | A short-lived photo link for people who share a workspace with that person; 404 otherwise. `Cache-Control: private, no-store`; 600 requests/min limit. | H4 |
| `GET /api/me/unread-by-workspace` (new) | Unread totals for each of the caller’s own workspaces (no-store). | M12 |
| `GET /api/workspaces/:id/channels`, user channel lists | Stable order: by name, then id. | L25 |
| `GET /api/channels/admin/all` | Each channel includes its workspace. | M10 |
| `GET /api/admin/messages/search` | Results include the channel’s workspace and the sender’s display name. | H6 |
| `GET /api/admin/audit-logs` | New optional `action` and `q` filters; the response adds the list of action types and a readable `targetLabel`. | L43 |
| `GET /api/company-overview/summary`, `/workspaces` | Adds `workspaceInvitations.pending`; each workspace’s Pending now counts both invitation kinds. | M11 |
| `GET /api/admin/stats`, `/api/admin/analytics` | User counts exclude internal system accounts (same rule as the user list). | M9 |

## 10. Database changes

- `UserProfile.avatarAttachmentId` — new nullable column, unique, foreign key to `Attachment(id)` with `ON DELETE SET NULL` (QA H4: profile photo). Existing rows get `NULL`; nothing is rewritten.
- `Attachment` gains the inverse relation `avatarOf` (no column). The orphan-attachment sweeper now keeps attachments used as a profile photo.
- Prisma client: `previewFeatures = ["relationJoins"]` (QA M18). This changes how Prisma loads relations (one SQL query with joins instead of one query per relation), not the schema.

## 11. Migrations

One additive migration: `backend/prisma/migrations/20261120120000_qa_h4_profile_avatar/migration.sql` — `ALTER TABLE "UserProfile" ADD COLUMN "avatarAttachmentId" TEXT`, a unique index and the foreign key. No data is changed or deleted; it is safe while the old version is still running (the old code ignores the column). Render applies it automatically: the start command runs `npm run db:deploy` (`prisma migrate deploy`) before `server.ts`. A `prisma migrate diff` between the migrations and the schema is empty.

## 12. Security improvements

- **Truthful password-reset delivery without account discovery (C2).** The “can’t send” answer is decided before the account lookup, from configuration and from a delivery-health window that applies to every address (10 min after Brevo rejects the key or sender, 2 min after an outage). Residual, documented in the code: the first failed send in a window answers 503 for that one existing address while an unknown address still gets 200; every later request in the window gets the same 503. Reset tokens and links are never logged; tested in `qa-c2-password-reset.test.ts` (8 tests).
- **Secrets never logged (C1, C2).** The storage check and the mailer log variable names, HTTP status and the provider’s reason only; tests assert the API key, passwords and tokens never appear in logs.
- **Profile photos (H4).** Only the uploader’s own, unsent image attachments can become a photo (SVG, other people’s uploads, files already sent in a message and oversize files are refused — tested); a photo link is issued only to people who share a workspace with that person, others get 404 (tested).
- **Admin sign-in (L39).** The admin form now refuses a non-admin account instead of signing it in to the member app; server-side role checks were already in place and are unchanged.
- **Stored HTML in moderation (H6).** Message content is rendered through the existing sanitiser instead of being shown raw; links built from text are created as DOM nodes (no HTML string assembly).
- **Destructive actions confirmed in the app (L36).** Archive, ownership transfer, member removal, admin channel delete and message delete use the app’s confirmation dialog.
- **Test safety.** The backend suite now refuses to run against a non-local database (`backend/.env` points at the hosted database); E2E already did.
- **Permission model verified, not changed.** No authorization rule was relaxed. The full backend suite (role, tier, workspace-isolation, invitation, session, upload-ownership and e-mail-privacy tests: `stage1`–`stage6c`, `roles-onboarding`, `member-email-privacy`, `t32-*`, `t35-*`, `workspace-invitations`, …) passes; the new endpoints are covered for isolation (`qa-h4-profile`, `qa-unread-workspaces`: another person’s unread counts are never returned; a session is required).

## 13. Performance measurements

**Method.** Server time was measured on a local stack (same code, local Postgres): 2–8 ms per request — the server itself is not slow. Production latency (1.3–3.5 s per call in the QA report) therefore comes from the time each database round trip takes. The hosted database that `backend/.env` points to is a Neon database in AWS ap-southeast-1 (Singapore); `render.yaml` sets no `region`, so unless it was changed in the dashboard the API runs in Render’s default region (Oregon) — every query then crosses the Pacific. To measure round trips, a proxy added 50 ms in each direction (100 ms per round trip) between the API and Postgres; `(time at 100 ms − time at 0 ms) / 100 ms` ≈ serial database round trips per request.

| Endpoint | Before: ms at 100 ms RTT | Round trips | After: ms at 100 ms RTT | Round trips | Change |
|---|---:|---:|---:|---:|---:|
| `/api/auth/me` | 322 | 3.2 | 214 | 2.1 | −34% |
| `/api/workspaces` | 1050 | 10.4 | 642 | 6.4 | −39% |
| `/api/workspaces/:ws/channels` | 740 | 7.3 | 316 | 3.1 | −57% |
| `/api/workspaces/:ws/dms` | 736 | 7.3 | 324 | 3.2 | −56% |
| `/api/workspaces/:ws/unread` | 733 | 7.3 | 319 | 3.2 | −57% |
| `/api/users` | 422 | 4.2 | 319 | 3.2 | −25% |
| `/api/workspaces/:ws/notifications` | 638 | 6.3 | 551 | 5.4 | −14% |
| `/api/me/hierarchy` | 424 | 4.2 | 218 | 2.2 | −49% |
| `/api/channels/:ch/messages` | 740 | 7.4 | 331 | 3.3 | −56% |
| `/api/channels/:ch/details` | 1251 | 12.4 | 438 | 4.3 | −65% |
| `/api/channels/:ch/pinned` | 736 | 7.3 | 326 | 3.2 | −56% |
| `/api/channels/:ch/members?q=pe&limit=8` | 1053 | 10.5 | 435 | 4.3 | −59% |
| `/api/workspaces/:ws/members` | 1347 | 13.4 | 424 | 4.2 | −69% |
| `/api/me/unread-by-workspace` | 322 | 3.2 | 220 | 2.2 | −32% |

Client side: the workspace shell loaded notifications 3 times and the hierarchy 6 times on every page load; now once each (shared 60-second cache keyed by session). The command palette and mention list show local results immediately instead of waiting for the server (M6, M7), and adding a task shows a pending card at once (M5).

Expected effect in production, if the API→database round trip is ~170–180 ms (Oregon↔Singapore; an estimate, not measured on Render): a request that needed 12 serial round trips (~2.1 s) now needs ~4 (~0.7 s). **Co-locating the API and the database** (same region) removes most of the remainder; that is an infrastructure change (§22). No latency target is promised beyond these measurements.

## 14. Backend test results

Vitest against a disposable local Postgres (never the hosted database).

| Run | Files | Tests |
|---|---|---|
| Baseline, commit `31af1f6` (clean worktree) | 63 passed · 2 failed · 1 skipped (66) | 666 passed · 7 failed · 21 skipped (694) |
| After remediation, first full run | 66 passed · 3 failed · 1 skipped (70) | 689 passed · 8 failed · 21 skipped (718) |
| **Final full run** | 69 passed · 1 skipped (70) | **697 passed · 0 failed · 21 skipped (718)** |

The 7 baseline failures (`auth.test.ts`, `email-validation-dos.test.ts`) were test-order dependence, not product defects: they need the shared SmartConnect Collab workspace, which only server startup or another test file created, and one file deleted it afterwards. Both causes are fixed (the files create it in `beforeAll`, like the other sign-up tests; `p2-shared-workspace` restores it). The 8th failure in the first run was `deployment-config.test.ts` asserting the old behaviour that caused C2 (the reset mailer silently returning `undefined` with no e-mail service); it now asserts the truthful `{ sent: false, reason: "not_configured" }` and still asserts nothing is sent. 24 tests were added (C1 ×4, C2 ×8, H4 ×5, M9/M10/M11/L43 ×4, M12/L25 ×3); no existing test was removed or loosened.

## 15. Frontend test results

Vitest + Testing Library (jsdom): **481 passed, 0 failed (77 files)** (baseline at `31af1f6`: 445 passed in 69 files; +36 tests, +8 files). New: `AuthForm.login` (including sign-in with an administrator-issued identifier), `ChatArea.qa`, `lib/reactions`, `lib/people`, `MessageModeration`, `AuditLogViewer`, `CommandPalette.qa`, `KanbanBoard.qa`, plus additions to `sanitizeHtml`. Updated to intended behaviour changes: `layout.test` (the account menu is found by its role; L8 changed its initials), `channels.test` (confirmations now use the app dialog, L36; new placeholder, L35), `TeamManagement.test` (only a pending invitation shows “Awaiting activation”, L41), `people.test` (display names, H4).

## 16. Browser E2E results

Playwright (Chromium), real API + Vite + local Postgres + local storage stand-in; no e-mail, no cloud credentials. **38 of 38 tests pass across 19 spec files (final run: 37 passed + 1 environment failure that passed on re-run)**.

- **First full run** (before the last fixes): 32 passed, 6 failed. Three failed in my new `signOut` helper (it looked for a button where the account menu has a `menuitem`); two specs still found the sign-up name field by the old placeholder that L4 replaced (they now use its label); and `p2-collaboration` exposed a real regression from the L3 fix — administrator-provisioned accounts sign in with an identifier that is not a full e-mail address, and the new check refused it (§19). After the fixes, all 9 tests in those 6 specs passed.
- **Final full run** on a fresh database with the final code: **37 passed, 1 failed with `ENOSPC`** — the disk briefly filled while Playwright wrote that test’s trace, after all of its assertions had passed. Re-running its spec file (`t39-mobile`, 4 tests) on its own: **4/4 passed**.
- Coverage: public sign-up and sign-in, SmartConnect Collab as the default workspace, Team Lead provisioning and single-use activation, invitations, cross-workspace isolation, chat, mentions, drafts, search, uploads (local storage stand-in), team tasks with per-member visibility, multi-tab sessions, admin login and theme, phone/tablet layouts at 11 viewports, the new QA checks (`qa-remediation`, 5 tests), and calls (`call-security`: signalling only between participants, spoofed rings rejected; `call-self-view`: self view alone and with the other person).

## 17. Type-check results

- Frontend `tsc --noEmit` (the project’s `lint` script): clean.
- Backend `tsc --noEmit` (the project’s `lint` script): clean.
- `prisma validate`: valid. The repository has no ESLint configuration; `lint` is the type check in both packages.

## 18. Production build results

- Frontend `tsc -p tsconfig.json && vite build`: succeeds (`tsc` + `vite build`). Main bundle 625.6 kB (gzip 196.7 kB) vs 614.6 kB (gzip 193.4 kB) at the baseline; Vite’s advisory that a chunk exceeds 500 kB was already present at the baseline.
- Backend `tsc -p tsconfig.json`: succeeds.
- Builds were written to a scratch directory, not over `dist/`.

## 19. Manual verification results

Verified on the local stack with the current code (local database and throwaway accounts — **the production site was not changed or re-tested**, because nothing is deployed). Roles: a public sign-up **Member**, a **Team Lead** (team-lead tier) and an **Admin**. Viewports: desktop 1440×900 / 1280×800 and phone 390×844 (touch). Themes: light and dark.

| Check | Role · viewport · theme | Result |
|---|---|---|
| H1 task drawer Close/Share above the header; Close works | Team Lead · desktop · light | Pass (E2E) |
| M2 dialog backdrop covers the header | Team Lead · desktop · light | Pass (E2E) |
| H2/M1 reaction picker on the newest message fully on screen; Escape closes | Team Lead · desktop · light | Pass (E2E) |
| M4 drawer status change shows in the table without reload | Team Lead · desktop · light | Pass (E2E) — no code defect |
| M14 composer placeholder; L11 one focus ring; L10 URL becomes a link; L15 “(edited)” beside the time | Team Lead · desktop · light | Pass (E2E) |
| L12 channel opens at its very end, no “Jump to latest” | Team Lead · desktop · light | Pass (E2E + measurement: 0 px from the end) |
| M8 chart Y-axis labels inside the chart; H5 “Add Team Lead” on one line | Admin · desktop · light | Pass (E2E) |
| L24 no ⌘ button and a short search placeholder on phones; one search box on Chats; no sideways scroll on Home/Chats/More | Member · phone 390 · light | Pass (E2E) |
| V1 space after an emoji kept | Member · desktop · light | Pass (E2E) — not reproducible |
| L34 settings content centred (gap difference ≤ 24 px, width > 700 px at 1470 px) | Member · desktop · light | Pass (E2E) — not a defect |
| M13 thread composer toolbar wraps | Team Lead · desktop · light | Pass — 0 px hidden overflow |
| L22 sidebar Channels and Direct messages rows aligned | Team Lead · desktop · light | Pass — both rows start at x = 68 px |
| L23 Create channel opens as a centred dialog | Team Lead · desktop · light | Pass — 448 px wide, centred |
| L21/C1 failed upload shows the full reason | Team Lead · desktop · light (storage credentials invalid, as in production) | Pass — “File uploads are not available on this server right now. Your file was not sent.” |
| L2/M3 toast follows the theme and sits top-right, clear of Send | Team Lead · desktop · dark | Pass — background rgb(27,34,35), top 56 px; Send at 845 px |
| L32 project board shows a fade when more columns exist | Team Lead · 1280 · light | Pass |
| L44 dashboard chart grid uses the dark theme colour | Admin · desktop · dark | Pass — stroke #263032 (was #f1f0f5) |
| L45 admin dashboard on a phone | Admin · phone 390 · light | Pass — 0 px sideways overflow |
| H4/L8/L9 one name, the same two initials and colour in header, sidebar, messages, thread, DM list, Team tasks and People | Team Lead · desktop · light | Pass — Mateo's avatar: DM list 20px "MR" rgb(168, 69, 107); Team tasks 20px "MR" rgb(168, 69, 107); People 44px "MR" rgb(168, 69, 107); letters fit: true |
| L40 dashboard online list: avatar, status-coloured dot, rows not cut | Admin · desktop · dark | Pass (screenshot) |
| L16 first visit “Welcome”, then “Welcome back” | Member · desktop · light | Pass — first visit "Welcome, Mateo Rivera-Castellanos", next visit "Welcome back, Mateo Rivera-Castellanos" |
| L19 saved title shows on the People card without reload | Member · desktop · light | Pass — People card shows the saved title without a reload: true |
| L33 project page preloaded from the Projects list | Team Lead · desktop · light | Pass — project page code requested while the Projects list is open, before any click: true (/src/pages/projects/ProjectPage.tsx?t=1795164568708) |
| L31 project date error names “Target date” | Team Lead · desktop · light | Pass — error names the Target date field: true; mentions of "due date": 0 |
| L28 Team tasks columns; full assignee name | Team Lead · desktop · light | Pass — Task 26.0% / Assigned to 21.0% of the table; "Mateo Rivera-Castellanos" truncated: false |
| L30 Create task Project choice wording | Team Lead · desktop · light | Pass — empty Project choice reads "No project (Team tasks list)": true; hint lines: ["No project (Team tasks list)"] |
| L18 checkboxes use the brand colour | Team Lead · desktop · light | Pass — checkbox accent-color=rgb(11, 124, 134) (brand token #0b7c86; browser default is "auto") |
| L20 palette input has no harsh focus box | Team Lead · desktop · light | Pass — palette input focused=true, outline=none 2px (no edge-to-edge ring) |
| L27 channel subtitle does not flash “Channel” | Team Lead · desktop · light | Pass — subtitle while details load: "" (was "Channel"), after: "Public channel" |
| L13 reaction picker has no white frame | Team Lead · desktop · dark | Pass — picker frame rgb(20, 26, 27); white backgrounds inside: 0 |
| L26 reaction pill tap area on phones | Team Lead · phone 390 · light | Pass — reaction pill drawn 24px; tappable 43px on the newest message, 43px on one mid-list (phone) |
| L42 one header style on all admin pages | Admin · desktop · light | Pass — title style on 7 admin pages: 24px/700 (System Overview / Users / Team Management / Channel Administration / Audit Logs / Content Moderation / File storage); Channel search has an icon: true |
| L26 admin tab height on phones | Admin · phone 390 · light | Pass — admin phone tab heights: [44]px (count 8) |

**What verification caught.** Four fixes did not hold up on first measurement and were completed before this report: **L12** (the channel still opened 6–38 px short of its end, with “Jump to latest” over the newest message → now 0 px, and a browser regression test), **L26** (the enlarged phone tap area was covered by the next message — 29 px → 43 px), **L8** (the 20 px avatar still showed one letter → two letters at every size) and **L9** (task assignees, task comments, phone Chats/Calls, Add member and two admin lists were still coloured by name or a fixed colour → every avatar is now coloured by the person’s id; measured identical in the DM list, Team tasks and People). The browser E2E suite also caught a regression introduced by the L3 fix: the new sign-in check required a full e-mail address, which would have locked out administrator-provisioned accounts that sign in with an issued identifier (such as `name@2003`). Sign-in now only requires the field to be filled; a unit test and the E2E suite cover it.

Not verified here: a real Cloudinary upload and a real Brevo e-mail (they need the production credentials, which tests must not use) — the provider responses are covered by tests with stubs; and calls with real cameras across devices (the call E2E specs use Chromium’s fake media devices).

## 20. Required Render environment changes

Set on the API service (values from the providers’ consoles — never commit them):

| Variable | Needed for | Notes |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | C1 uploads, H4 photos | The three values of one Cloudinary account (Dashboard → API Keys). Production currently rejects them. Stray spaces or quotes are now tolerated. After deploy, the startup log says either “File storage: Cloudinary accepted the server credentials.” or “File storage is OFF: Cloudinary rejected this server’s credentials…”. |
| `BREVO_API_KEY` | C2 reset e-mails, invitations | A Brevo **API v3** key (not an SMTP key). |
| `BREVO_FROM_EMAIL` | C2 | A sender address **verified in Brevo** (Senders & IP). `BREVO_FROM_NAME` is optional. |
| `APP_URL` (existing) | reset and invitation links | Must stay the public frontend URL (the Vercel site). |

No new variables were introduced. Not an environment variable but recommended: run the API in the same region as the Neon database (M18).

## 21. Required Vercel environment changes

None. No frontend environment variable was added or renamed. The new `/admin/login` route is already served by the existing SPA rewrite in `frontend/vercel.json`.

## 22. Required manual actions

1. Review the working-tree changes, then commit and push (not done — not authorized).
2. On Render: correct the Cloudinary values and set the Brevo values (§20); deploy the backend. The build runs `prisma generate` (install) and the start command already runs `prisma migrate deploy`, which applies the one additive migration.
3. Deploy the frontend on Vercel (no settings change).
4. Run the post-deploy checks in `docs/SMARTCONNECT_PRODUCTION_READINESS.md` (upload, forgot-password, admin login, photo, unread dot, calls).
5. Test data: review the cleanup manifest in the readiness document and confirm which records to suspend, revoke, archive or delete; nothing has been changed.
6. Credentials: suspend the QA test account (its password appeared in the QA report). The administrator and team-lead passwords were also shared in plain text during the QA session — rotate them.
7. Decide M15 (e-mail-verified sign-up) and L7 (minimum password length); ask the SmartUnifolio owner to fix the description typo (L29).
8. Infrastructure (M18): move the API and the database into the same region.

## 23. Remaining deployment risks

- **Until Render credentials are corrected, uploads and reset e-mails stay unavailable** — now with honest messages instead of silent failure. Forgot-password returns 503 (“can’t be sent right now”) while e-mail is unconfigured; administrators can still set a password from User Management.
- **`relationJoins` is a Prisma preview feature** (Prisma 6.19.3). The full backend suite passes with it; if a problem appears, removing the one `previewFeatures` line and regenerating restores the previous query strategy with no schema change.
- **New migration** adds one nullable column with a unique index and a foreign key; it is additive and quick on a small table. Render’s start command applies it before the server starts; if it failed, the new version would not start.
- **Behaviour changes users will notice:** the sidebar sign-out icon moved into the account menu (M17); the admin sign-in form refuses non-admin accounts (L39); toasts appear top-right (M3); a new person’s first Home visit says “Welcome” (L16); people appear under their display name with two-letter initials and one colour everywhere (H4, L8, L9).
- **Residual enumeration signal** on the first failed reset send per failure window (§12).
- **Not verified against production**: production was not re-tested after the changes because nothing is deployed; the post-deploy checklist covers it.

