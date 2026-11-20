# SmartConnect — QA Remediation Tracker

Source of truth: the QA report artifact (https://claude.ai/artifact/AQBwpGdKq6tZeZMTmrQdvd), 72 findings, IDs and severities preserved. The findings below are taken from the exact data that artifact was generated from (screenshots are in the artifact).

Status values: **Resolved** (fixed and covered by tests or a browser check) · **Resolved in code — production blocked on configuration** (the code is fixed; production needs a credential set on Render) · **Partially resolved** · **Deferred — product decision** · **Data fix by owner** · **Closed — not reproducible / not a defect / no code defect (verified)** · **Improved — infrastructure action required**.

| Status | Count |
|---|---:|
| Resolved | 63 |
| Resolved in code — production blocked on configuration | 2 |
| Closed — not reproducible / not a defect | 2 |
| Closed — no code defect (verified) | 1 |
| Deferred — product decision | 1 |
| Improved — infrastructure action required | 1 |
| Partially resolved | 1 |
| Data fix by owner (no code defect) | 1 |
| **Total** | **72** |

## Summary table

| ID | Severity | Role | Module | Finding | Status |
|---|---|---|---|---|---|
| C1 | Critical | All users | Uploads | File uploads fail for everyone | Resolved in code — production blocked on configuration |
| C2 | Critical | All users | Auth / E-mail | E-mail is not configured, so password reset never arrives | Resolved in code — production blocked on configuration |
| H1 | High | Team Lead, Member | Tasks | Task drawer’s Close, Share and Delete buttons are hidden under the top bar | Resolved |
| H2 | High | All users | Reactions | Reaction picker is cut off on recent messages | Resolved |
| H3 | High | All users | Channels | Channels say “No messages yet — say hello!” while they are still loading | Resolved |
| H4 | High | All users | Profile / Names | Full name from sign-up is never shown, and nobody can change their name or photo | Resolved |
| H5 | High | Admin | Admin | “Add Team Lead” button text spills out of the button | Resolved |
| H6 | High | Admin | Admin | Content Moderation shows raw HTML in results | Resolved |
| M1 | Medium | All users | Reactions | Reaction picker won’t close with Escape or by clicking another message | Resolved |
| M2 | Medium | All users | Dialogs | Dialog backdrops don’t cover the top bar | Resolved |
| M3 | Medium | All users | Toasts | Toasts sit on top of the Send button | Resolved |
| M4 | Medium | Team Lead | Tasks | Team Tasks list doesn’t update after a status change | Closed — no code defect (verified) |
| M5 | Medium | Team Lead, Member | Projects | Board’s inline “Add task” gives no feedback for up to 10 seconds | Resolved |
| M6 | Medium | All users | Mentions | @mention suggestions take about 3 seconds, with no loading state | Resolved |
| M7 | Medium | All users | Search | Ctrl+K search is slow even for channels already on screen | Resolved |
| M8 | Medium | Admin | Admin | Dashboard chart axis labels lose their first digit | Resolved |
| M9 | Medium | Admin | Admin | Admin user totals disagree between pages | Resolved |
| M10 | Medium | Admin | Admin | Channel Administration shows archived channels as Active and can’t tell workspaces apart | Resolved |
| M11 | Medium | Admin | Admin | Pending invitations count is wrong in Workspace Overview | Resolved |
| M12 | Medium | Team Lead, Member | Unread | No unread hint on other workspaces | Resolved |
| M13 | Medium | All users | Threads | Thread reply toolbar overflows its box | Resolved |
| M14 | Medium | All users | Composer | Message box placeholder never shows | Resolved |
| M15 | Medium | Member | Sign-up | Sign-up tells anyone which e-mails are registered | Deferred — product decision |
| M16 | Medium | All users | Login | “Forgot password?” fires immediately on click | Resolved |
| M17 | Medium | All users | Sidebar | Sign-out icon sits right next to the workspace name | Resolved |
| M18 | Medium | All users | Performance | The app is slow almost everywhere | Improved — infrastructure action required |
| L1 | Low | All users | Login | The same error is shown twice | Resolved |
| L2 | Low | All users | Theme | Toasts ignore dark theme | Resolved |
| L3 | Low | All users | Login | Login uses the browser’s own validation bubble | Resolved |
| L4 | Low | Member | Sign-up | A real person’s name is used as a placeholder | Resolved |
| L5 | Low | All users | Login | The URL doesn’t follow the screen | Resolved |
| L6 | Low | Member | Sign-up | Password fields look already filled | Resolved |
| L7 | Low | Member | Sign-up | Weak password rule | Partially resolved |
| L8 | Low | All users | Avatars | Avatar initials differ for the same person | Resolved |
| L9 | Low | All users | Avatars | Avatar colours change from screen to screen | Resolved |
| L10 | Low | All users | Messages | Links in messages aren’t clickable, and the preview starts as an empty box | Resolved |
| L11 | Low | All users | Composer | Double focus ring in the composer | Resolved |
| L12 | Low | All users | Channels | Channel doesn’t open scrolled to the bottom | Resolved |
| L13 | Low | All users | Reactions | Reaction picker frame is hard-coded white | Resolved |
| L14 | Low | All users | Reactions | Reactions appear seconds late and push the list down | Resolved |
| L15 | Low | All users | Messages | “(edited)” is tiny; toolbar overlaps the edit box | Resolved |
| L16 | Low | Member | Home | Brand-new users are greeted “Welcome back” | Resolved |
| L17 | Low | Member | More | More page: odd icon and an admin section for members | Resolved |
| L18 | Low | All users | Profile | Checkbox uses the browser’s blue | Resolved |
| L19 | Low | All users | Profile | Saved profile title isn’t shown anywhere | Resolved |
| L20 | Low | All users | Search | Search palette input has a harsh focus box | Resolved |
| L21 | Low | All users | Uploads | Upload error text is cut off | Resolved |
| L22 | Low | All users | Sidebar | Sidebar rows and badges don’t line up | Resolved |
| L23 | Low | All users | Dialogs | “New message” and “Create a channel” open as cramped popovers | Resolved |
| L24 | Low | All users | Mobile | Phone top bar: cut placeholder, ⌘ button, two search boxes | Resolved |
| L25 | Low | All users | Mobile | Channel order differs between phone and desktop | Resolved |
| L26 | Low | All users | Mobile | Small tap targets on phones | Resolved |
| L27 | Low | All users | Channels | Channel subtitle flickers | Resolved |
| L28 | Low | Team Lead | Tasks | Assignee names truncated with space to spare | Resolved |
| L29 | Low | Team Lead | Content | Typo in the workspace description | Data fix by owner (no code defect) |
| L30 | Low | Team Lead | Tasks | Create task: confusing Project hint | Resolved |
| L31 | Low | Team Lead, Member | Projects | Validation names the wrong field | Resolved |
| L32 | Low | Team Lead, Member | Projects | Board columns cut off with no scroll hint | Resolved |
| L33 | Low | Team Lead, Member | Projects | Old list stays on screen after creating a project | Resolved |
| L34 | Low | Team Lead | Settings | Workspace settings use a narrow column | Closed — not reproducible / not a defect |
| L35 | Low | Team Lead, Member | Channels | Channel names aren’t normalised | Resolved |
| L36 | Low | Team Lead | Dialogs | Archive uses the browser’s confirm() popup | Resolved |
| L37 | Low | Team Lead | Channels | Archiving: no progress, red “Restore”, still in sidebar | Resolved |
| L38 | Low | Team Lead | Invites | “Send invite” doesn’t send anything | Resolved |
| L39 | Low | Admin | Admin login | Non-admin on the admin form is silently signed into the app | Resolved |
| L40 | Low | Admin | Admin | Online users card: last row cut, two dots per row | Resolved |
| L41 | Low | Admin | Admin | Contradictory Team Lead badges | Resolved |
| L42 | Low | Admin | Admin | Admin pages use three different header styles | Resolved |
| L43 | Low | Admin | Admin | Audit log shows raw IDs and timestamps | Resolved |
| L44 | Low | Admin | Admin | Chart gridlines are glaring in dark theme | Resolved |
| L45 | Low | Admin | Admin | Admin header is cramped on phones | Resolved |
| V1 | Manual re-check | All users | Messages | Space after an emoji may be dropped | Closed — not reproducible / not a defect |

## Findings in detail

### C1 — File uploads fail for everyone

- **Original severity:** Critical
- **Affected role:** All users
- **Screen / module:** Uploads
- **Reproduction (as reported):** Attaching any file (I tried a PNG and a .txt) fails with “File uploads are not available on this server right now. Your file was not sent.” POST /api/upload returns 503. Admin › File Storage shows “file storage did not respond” three times. Voice messages and task attachments use the same upload path, so they are broken too.
- **Root cause:** Render Cloudinary values rejected by Cloudinary (401/403/404); code could not tell quota from outage; no startup check
- **Relevant files:** backend/config/env.ts, backend/lib/settings.ts, backend/lib/cloudinary.ts, backend/server.ts, backend/modules/uploads/message.routes.ts (reported: `backend/modules/uploads/message.routes.ts:114-133`)
- **Proposed correction (report):** The backend sends this exact 503 when Cloudinary rejects the server’s credentials (HTTP 401/403/404). Set valid CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on the Render service and redeploy. The server log line “storage rejected the server’s credentials” will confirm it.
- **Implementation status:** Resolved in code — production blocked on configuration (FIXED-CODE / BLOCKED-CONFIG)
- **Test coverage:** tests/t35-upload-storage-errors.test.ts (+4)
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19). Automated: tests/t35-upload-storage-errors.test.ts (+4).

### C2 — E-mail is not configured, so password reset never arrives

- **Original severity:** Critical
- **Affected role:** All users
- **Screen / module:** Auth / E-mail
- **Reproduction (as reported):** Settings › Invitations says “e-mail delivery isn’t configured on this server”. Forgot password still answers “If an account exists for that address, a password reset link has been sent.” Nothing can be sent, so a locked-out user has no way back in and is told the opposite.
- **Root cause:** forgotPassword awaited a mailer that silently returned when Brevo unset and always replied "has been sent"; refusals leaked account existence; admin force-reset claimed "sent"
- **Relevant files:** backend/lib/emailDelivery.ts, backend/utils/mailer.ts, backend/modules/auth/auth.service.ts, backend/modules/admin/admin.service.ts, frontend AuthForm.tsx (reported: `backend/lib/emailDelivery.ts · backend/modules/auth/auth.service.ts:451-463`)
- **Proposed correction (report):** Set BREVO_API_KEY and BREVO_FROM_EMAIL (a verified Brevo sender) on Render. Until then, have forgotPassword check emailDeliveryConfigured() and tell the user to contact an admin instead of claiming a link was sent.
- **Implementation status:** Resolved in code — production blocked on configuration (FIXED-CODE / BLOCKED-CONFIG)
- **Test coverage:** tests/qa-c2-password-reset.test.ts (8), AuthForm.login.test.tsx
- **Verification result:** Automated: tests/qa-c2-password-reset.test.ts (8), AuthForm.login.test.tsx.

### H1 — Task drawer’s Close, Share and Delete buttons are hidden under the top bar

- **Original severity:** High
- **Affected role:** Team Lead, Member
- **Screen / module:** Tasks
- **Reproduction (as reported):** Opening a task (Team Tasks › Open) slides in a drawer whose header buttons sit about 12 px from the top, underneath the global header. Clicking where the X should be hits “Invite people” or the account avatar instead. The only way out is the Escape key.
- **Root cause:** TaskDrawer rendered inside <main relative z-10> stacking context; header z-[100] above
- **Relevant files:** frontend/src/components/ui/Layer.tsx, TaskDrawer.tsx (reported: `frontend/src/components/layout/Header.tsx:104 · frontend/src/components/tasks/TaskDrawer.tsx:180-186`)
- **Proposed correction (report):** The header is z-[100] and the drawer is fixed inset-y-0 z-[70]. Put the drawer and its backdrop above the header (for example z-[110] and z-[105]) or start the drawer below it (top-12).
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** (layer tests TBD)
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: (layer tests TBD).

### H2 — Reaction picker is cut off on recent messages

- **Original severity:** High
- **Affected role:** All users
- **Screen / module:** Reactions
- **Reproduction (as reported):** Clicking React on a message near the bottom opens the emoji picker below the message, far from the React button. The message list clips it: only the search bar and category icons show, the emoji grid is hidden behind the composer, and the picker covers the message text. Recent messages are the ones people react to, so reactions are mostly unusable.
- **Root cause:** picker was absolute inside the message row in the scrolling (overflow) list -> clipped; placed left-0 far from button
- **Relevant files:** lib/reactions.ts (placePopover), components/chat/ReactionPicker.tsx, ChatArea.tsx, ui/EmojiPicker.tsx (reported: `frontend/src/components/chat/ChatArea.tsx:1104-1107`)
- **Proposed correction (report):** Render the picker in a portal with collision handling (flip above when there is no room below) and anchor it to the React button.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** lib/reactions.test.ts
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: lib/reactions.test.ts.

### H3 — Channels say “No messages yet — say hello!” while they are still loading

- **Original severity:** High
- **Affected role:** All users
- **Screen / module:** Channels
- **Reproduction (as reported):** On every channel open or reload the empty-state text shows for 3–10 seconds before the history appears. A new member, or the Team Lead right after login, sees what looks like an empty channel.
- **Root cause:** empty state rendered whenever messages.length===0, ignoring messagesLoaded; load errors went to a generic banner
- **Relevant files:** ChatArea.tsx (MessageListSkeleton, loadFailed, reloadKey Retry)
- **Proposed correction (report):** Track “loading” separately from “zero messages” and show a skeleton until the first page of messages returns.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** ChatArea.qa.test.tsx (3)
- **Verification result:** Automated: ChatArea.qa.test.tsx (3).

### H4 — Full name from sign-up is never shown, and nobody can change their name or photo

- **Original severity:** High
- **Affected role:** All users
- **Screen / module:** Profile / Names
- **Reproduction (as reported):** Sign-up asks for a full name and saves it (Admin › Users shows “QA Normal User”). Chat, the sidebar, DMs, mentions, People and the Home greeting all show the e-mail-derived username “qa.normal.user” instead. Team Tasks does show full names, so the same person appears under two names. Profile & preferences only offers Title, About, Time zone and Read receipts: there is no name, username or avatar field.
- **Root cause:** full name stored in UserProfile.displayName but /api/users returned only username; screens rendered username; no edit/photo
- **Relevant files:** backend: prisma schema + migration 20261120120000_qa_h4_profile_avatar, users.service/controller/routes (displayName, avatarId, GET /api/users/:id/avatar), lib/attachments.ts sweeper; frontend: lib/people.ts, Avatar.tsx, ChatArea, ThreadPanel, Sidebar, Header, HomeView, PeopleDirectory, ProfileModal, ProfileSettingsModal, WorkspaceLayout, types.ts, ChatsPage/CallsPage/MorePage/AddMemberModal (display names, found in verification)
- **Proposed correction (report):** Choose one display rule (full name, falling back to username) and use it everywhere. Add name and avatar fields to Profile & preferences.
- **Implementation status:** Resolved (FIXED (photo upload depends on C1 in prod))
- **Test coverage:** tests/qa-h4-profile.test.ts (5), lib/people.test.tsx (5), people.test.tsx
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19). Automated: tests/qa-h4-profile.test.ts (5), lib/people.test.tsx (5), people.test.tsx.

### H5 — “Add Team Lead” button text spills out of the button

- **Original severity:** High
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** In Admin › Team Management the long description squeezes the button to 116 px. “Add Team Lead” wraps onto three lines inside a 40 px tall button, so “Add” and “Lead” are clipped above and below.
- **Root cause:** header text block and Button both flex-shrinkable; long paragraph squeezed button to 116px
- **Relevant files:** TeamManagement.tsx (reported: `frontend/src/components/admin/TeamManagement.tsx:238-244`)
- **Proposed correction (report):** Give the button shrink-0 and whitespace-nowrap, and let the header row wrap (flex-wrap) on narrow screens.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check (final pass)
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### H6 — Content Moderation shows raw HTML in results

- **Original severity:** High
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** Searching “QA test” lists the stored markup, for example “<p>[QA test] thread reply from normal user</p>” and “<p><strong>…</strong></p>”. Each result is tagged “#GENERAL” with no workspace, and two workspaces both have a General channel.
- **Root cause:** MessageModeration rendered m.content (stored HTML) as text; API lacked workspace
- **Relevant files:** messages.service.ts searchMessagesGlobal (workspace, displayName), MessageModeration.tsx (sanitizeMessageHtml, ConfirmDialog)
- **Proposed correction (report):** Render results through the same sanitizer the chat uses (lib/sanitizeHtml) or strip tags to plain text. Add the workspace name to each result.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** MessageModeration.test.tsx (2)
- **Verification result:** Automated: MessageModeration.test.tsx (2).

### M1 — Reaction picker won’t close with Escape or by clicking another message

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Reactions
- **Reproduction (as reported):** Once open, the picker ignores Escape and ignores clicks on other messages. Only a click outside the message list (for example on the channel header) closes it, so it keeps covering messages and the reaction you just added.
- **Root cause:** message list container stopPropagation() swallowed outside clicks; no Escape handler
- **Relevant files:** ReactionPicker.tsx (pointerdown/Escape/scroll close) | (reported: `frontend/src/components/chat/ChatArea.tsx:1196`)
- **Proposed correction (report):** Close on Escape and on any outside pointerdown, including clicks on other message rows.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### M2 — Dialog backdrops don’t cover the top bar

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Dialogs
- **Reproduction (as reported):** With any dialog open (call lobby, Profile, Create task, New project) the global header stays sharp and clickable above the dimmed page. You can open the account menu or the search from behind a modal.
- **Root cause:** Modal rendered in place inside <main z-10>; CallLobby z-70 < header z-100
- **Relevant files:** Layer.tsx, Modal.tsx, CallLobby.tsx, BottomSheet.tsx, CommandPalette.tsx |
- **Proposed correction (report):** Same cause as H1: the header’s z-[100] is above every modal layer. Raise modal and backdrop layers above it.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### M3 — Toasts sit on top of the Send button

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Toasts
- **Reproduction (as reported):** Success toasts appear bottom-right, directly over the composer’s Send button, for about five seconds (seen after creating a channel).
- **Root cause:** ToastContainer position bottom-right over composer Send
- **Relevant files:** App.tsx, index.css |
- **Proposed correction (report):** Move toasts to the top-right, or raise their bottom offset above the composer.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### M4 — Team Tasks list doesn’t update after a status change

- **Original severity:** Medium
- **Affected role:** Team Lead
- **Screen / module:** Tasks
- **Reproduction (as reported):** Changing a task to “In progress” in the drawer saves, but the table keeps showing “To do” and the counter stays at “In progress 0” until the page is reloaded.
- **Root cause:** drawer save -> onChanged -> refresh() wiring is correct; production latency (PATCH 3-8s + reload) exceeded the 4s observation window
- **Relevant files:** (none yet)
- **Proposed correction (report):** Refetch or patch the list and counters when the drawer saves, or subscribe this page to the task socket events.
- **Implementation status:** Closed — no code defect (verified) (VERIFY-IN-BROWSER)
- **Test coverage:** E2E qa spec
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: E2E qa spec.

### M5 — Board’s inline “Add task” gives no feedback for up to 10 seconds

- **Original severity:** Medium
- **Affected role:** Team Lead, Member
- **Screen / module:** Projects
- **Reproduction (as reported):** After typing a title and pressing Enter, the text just stays in the input with no spinner for 6–10 seconds before the card appears. People will press Enter again and create duplicates.
- **Root cause:** QuickAdd disabled the input but showed nothing while createTask (6-10s in prod) ran
- **Relevant files:** KanbanBoard.tsx (cleared input + "Adding …" placeholder, restore on failure)
- **Proposed correction (report):** Add the card optimistically and clear the input at once, or disable the input and show a spinner.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** KanbanBoard.qa.test.tsx
- **Verification result:** Automated: KanbanBoard.qa.test.tsx.

### M6 — @mention suggestions take about 3 seconds, with no loading state

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Mentions
- **Reproduction (as reported):** Typing “@sa” shows nothing for roughly three seconds while GET /channels/:id/members runs, then the list appears. It looks broken at first.
- **Root cause:** mention list opened only once results arrived; no cache
- **Relevant files:** ChatArea.tsx (Searching people… row, per-channel/query cache, key guard while loading)
- **Proposed correction (report):** Show a “Searching…” row immediately and cache channel members on the client.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** E2E
- **Verification result:** Automated: E2E.

### M7 — Ctrl+K search is slow even for channels already on screen

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Search
- **Reproduction (as reported):** Typing “gen” shows “Searching…” for 3–6 seconds before “General” appears, although General is in the sidebar.
- **Root cause:** palette only showed server results (3-6s)
- **Relevant files:** CommandPalette.tsx (local channels + people directory first, merged), WorkspaceLayout passes channels
- **Proposed correction (report):** Match local channels and people instantly and merge server results when they arrive.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** CommandPalette.qa.test.tsx
- **Verification result:** Automated: CommandPalette.qa.test.tsx.

### M8 — Dashboard chart axis labels lose their first digit

- **Original severity:** Medium
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** The message-activity Y-axis reads 6, 2, 8, 4, 0 from top to bottom. The real values are 16 and 12; their first digit is cut off.
- **Root cause:** AreaChart margin left -16 + YAxis width 32 clipped 2-digit ticks
- **Relevant files:** AdminDashboard.tsx (reported: `frontend/src/components/admin/AdminDashboard.tsx:161,170`)
- **Proposed correction (report):** The chart uses margin left −16 with a 32 px Y-axis, which leaves no room for two digits. Use left: 0 and width 40, or let Recharts size the axis.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### M9 — Admin user totals disagree between pages

- **Original severity:** Medium
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** The dashboard says 10 total users, User Management lists 9 accounts, and Workspace Overview says 8 active plus 1 suspended.
- **Root cause:** analytics/stats used prisma.user.count() incl. system + deleted-user sentinel; list excludes them
- **Relevant files:** lib/systemAccounts.ts (shared RESERVED_LOGINS/realUsers), admin.service.ts, userProvisioning.service.ts, members.service.ts (reported: `backend/modules/admin/admin.service.ts:45`)
- **Proposed correction (report):** The dashboard counts with a raw prisma.user.count(). Apply the same filter as the user list, or label exactly what is counted.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** tests/qa-admin-data.test.ts
- **Verification result:** Automated: tests/qa-admin-data.test.ts.

### M10 — Channel Administration shows archived channels as Active and can’t tell workspaces apart

- **Original severity:** Medium
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** The archived “QA Test Channel!” is listed with Status “Active”. Two rows are both called “General”, with only a short id to tell them apart.
- **Root cause:** UI hard-coded "Active"; type showed Public for every non-DM; API had no workspace
- **Relevant files:** channels.service listAllChannelsAdmin (+workspace), ChannelManagement.tsx (Workspace column, visibility, archived, ConfirmDialog)
- **Proposed correction (report):** Show the archived state, and add a Workspace column.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** tests/qa-admin-data.test.ts
- **Verification result:** Automated: tests/qa-admin-data.test.ts.

### M11 — Pending invitations count is wrong in Workspace Overview

- **Original severity:** Medium
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** The tile says Pending invitations 0 and SmartUnifolio’s Pending column says 0, while SmartUnifolio › Settings › Invitations shows Pending 1. The tile only counts Team Lead invitations.
- **Root cause:** overview counted AccountInvitation only, not workspace e-mail Invitation rows
- **Relevant files:** companyOverview.service.ts (+workspaceInvitations, per-workspace sum), CompanyOverview.tsx, lib/api/companyOverview.ts
- **Proposed correction (report):** Include workspace e-mail invitations, or rename the tile “Team Lead invitations”.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** tests/qa-admin-data.test.ts, stage4 test extended
- **Verification result:** Automated: tests/qa-admin-data.test.ts, stage4 test extended.

### M12 — No unread hint on other workspaces

- **Original severity:** Medium
- **Affected role:** Team Lead, Member
- **Screen / module:** Unread
- **Reproduction (as reported):** The Team Lead had an unread DM in SmartConnect Collab, but the Collab icon on the left rail showed no dot or badge. The DM only appeared after switching workspaces.
- **Root cause:** no API for unread across workspaces; rail had no indicator
- **Relevant files:** readState.service getUnreadByWorkspace + GET /api/me/unread-by-workspace; WorkspaceSwitcher.tsx (dot + label, refresh on switch/focus/socket/45s)
- **Proposed correction (report):** Show an unread dot or count on each rail icon, using the per-workspace unread data.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** tests/qa-unread-workspaces.test.ts (2)
- **Verification result:** Automated: tests/qa-unread-workspaces.test.ts (2).

### M13 — Thread reply toolbar overflows its box

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Threads
- **Reproduction (as reported):** In the thread panel, 14 formatting buttons (409 px) are squeezed into 277 px. Five are hidden behind a horizontal scroll with no hint, and one icon is cut in half at the edge.
- **Root cause:** toolbar always overflow-x-auto no-scrollbar; 14 buttons in ~277px
- **Relevant files:** RichTextEditor.tsx (compact => flex-wrap)
- **Proposed correction (report):** Use the compact toolbar in the thread composer, or wrap or collapse the extra buttons into a “More” menu.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### M14 — Message box placeholder never shows

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Composer
- **Reproduction (as reported):** The composer sets data-placeholder “Message #General (Type '/' for commands)”, but nothing is visible. The box looks like an empty strip with no hint where to type.
- **Root cause:** Tiptap Placeholder sets data-placeholder but index.css had no ::before rule
- **Relevant files:** index.css (reported: `frontend/src/components/chat/RichTextEditor.tsx:162 · frontend/src/index.css (rule missing)`)
- **Proposed correction (report):** TipTap’s Placeholder extension needs CSS: .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--color-fg-subtle) }
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### M15 — Sign-up tells anyone which e-mails are registered

- **Original severity:** Medium
- **Affected role:** Member
- **Screen / module:** Sign-up
- **Reproduction (as reported):** Entering an existing address shows “An account with this email address already exists.” Forgot password deliberately hides this, so the two screens disagree on account privacy.
- **Root cause:** public signup must say why it failed; enumeration-proof signup needs e-mail verification (blocked by C2 config); directSignupLimiter 10/15min exists
- **Relevant files:** — |
- **Proposed correction (report):** Use a neutral response on sign-up, or keep it as a product decision and add rate limiting to the endpoint.
- **Implementation status:** Deferred — product decision (DEFERRED (product decision))
- **Test coverage:** —
- **Verification result:** Reviewed in code; see final report.

### M16 — “Forgot password?” fires immediately on click

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Login
- **Reproduction (as reported):** One click sends a reset request for whatever is in the e-mail box. There is no confirmation step or separate screen, and the password field stays filled. My clicks sent two reset requests for admin@smartconnect.com (nothing arrived, because of C2).
- **Root cause:** Forgot link called the API directly with the login e-mail
- **Relevant files:** AuthForm.tsx
- **Proposed correction (report):** Open a small “Reset password” step with its own e-mail field and a Send button.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### M17 — Sign-out icon sits right next to the workspace name

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Sidebar
- **Reproduction (as reported):** The icon beside “SmartConnect Collab” at the top of the sidebar signs you out in one click with no confirmation. It looks like a workspace action and is easy to hit by mistake.
- **Root cause:** Sidebar header had a one-click LogOut icon beside the workspace name
- **Relevant files:** Sidebar.tsx (removed; account menu + mobile More keep Sign out); e2e/helpers signOut + smoke/t37/t38 updated
- **Proposed correction (report):** Remove it there (Sign out is already in the account menu) or ask for confirmation.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** E2E
- **Verification result:** Automated: E2E.

### M18 — The app is slow almost everywhere

- **Original severity:** Medium
- **Affected role:** All users
- **Screen / module:** Performance
- **Reproduction (as reported):** Every API call takes 1.3–3.5 s. Measured: first load after sign-up about 13 s, channel history 3–10 s, People list over 7 s, creating a task about 8 s, opening a task about 5 s, archiving about 8 s, admin Workspace Overview about 10 s. One channel open requests /notifications three times and /me/hierarchy twice, and /api/users loads every user on each page load.
- **Root cause:** API (Render, default Oregon) and DB (Neon ap-southeast-1) in different regions: every query ~175ms RTT; Prisma loaded relations with extra queries; client fired duplicate requests
- **Relevant files:** schema.prisma previewFeatures relationJoins (14-69% fewer serial round trips, median 56%), WorkspaceLayout notifications load once (3->1), useHierarchy shared cache (6->1)
- **Proposed correction (report):** This looks like the Render free tier sleeping plus a database in another region. Keep the service warm or upgrade, put the database in the same region, de-duplicate requests with a shared cache, and paginate /api/users.
- **Implementation status:** Improved — infrastructure action required (IMPROVED (infra action required))
- **Test coverage:** perf/results-before.txt, results-after.txt
- **Verification result:** Automated: perf/results-before.txt, results-after.txt.

### L1 — The same error is shown twice

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Login
- **Reproduction (as reported):** A wrong password or an existing sign-up e-mail shows the message as a red inline banner and again as a toast.
- **Root cause:** AuthForm showed inline message AND toast.error
- **Relevant files:** AuthForm.tsx
- **Proposed correction (report):** Keep the inline message and drop the toast on auth forms.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L2 — Toasts ignore dark theme

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Theme
- **Reproduction (as reported):** In dark mode, toasts stay white with grey text.
- **Root cause:** react-toastify v11 injects its CSS at runtime after index.css; its :root vars won
- **Relevant files:** index.css, App.tsx (theme prop) |
- **Proposed correction (report):** Pass the resolved theme to ToastContainer (theme="dark" / "light").
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L3 — Login uses the browser’s own validation bubble

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Login
- **Reproduction (as reported):** Submitting an empty login form shows Chrome’s native “Please fill in this field” bubble, which overlaps the Password label and the Forgot password link. Sign-up uses neat inline errors instead.
- **Root cause:** login form had native required validation (noValidate only for signup)
- **Relevant files:** AuthForm.tsx, signupValidation.ts
- **Proposed correction (report):** Use the same inline validation as sign-up (noValidate on the form).
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L4 — A real person’s name is used as a placeholder

- **Original severity:** Low
- **Affected role:** Member
- **Screen / module:** Sign-up
- **Reproduction (as reported):** The Full name field’s placeholder is “Samarth Karale”.
- **Root cause:** hard-coded placeholder
- **Relevant files:** AuthForm.tsx
- **Proposed correction (report):** Use a generic example such as “Jane Doe”.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L5 — The URL doesn’t follow the screen

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Login
- **Reproduction (as reported):** The Sign Up tab and the Administrator console both keep the address at /login, so neither can be linked or bookmarked. (/signup exists as a route but the tab doesn’t switch to it.)
- **Root cause:** tab/admin switch changed state only; no /admin/login route
- **Relevant files:** AuthForm.tsx, router.tsx, LoginPage.tsx, ProtectedRoute.tsx
- **Proposed correction (report):** Navigate to /signup and an /admin/login route when switching.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L6 — Password fields look already filled

- **Original severity:** Low
- **Affected role:** Member
- **Screen / module:** Sign-up
- **Reproduction (as reported):** Every password field’s placeholder is “••••••••”, which looks like a saved password. Confirm password has no show/hide eye.
- **Root cause:** dot placeholders; one shared eye
- **Relevant files:** AuthForm.tsx
- **Proposed correction (report):** Use a text placeholder (or none) and add the eye to Confirm password.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L7 — Weak password rule

- **Original severity:** Low
- **Affected role:** Member
- **Screen / module:** Sign-up
- **Reproduction (as reported):** The only rule is “At least 6 characters”, with no strength hint.
- **Root cause:** min length 6 is a documented product decision (passwordPolicy.ts)
- **Relevant files:** signupValidation.ts (passwordStrength), AuthForm.tsx
- **Proposed correction (report):** Require 8+ characters and show a strength meter.
- **Implementation status:** Partially resolved (PARTIAL)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L8 — Avatar initials differ for the same person

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Avatars
- **Reproduction (as reported):** The top-bar avatar shows “QA”, the sidebar avatar shows “Q”.
- **Root cause:** Header used initials={2}, sidebar 1; initials taken from the first characters of the username; (found in verification) the 20px avatar still showed one letter
- **Relevant files:** Avatar.tsx (two letters at every size, 9px on the 20px avatar) + lib/people initialsOf
- **Proposed correction (report):** Use one initials helper everywhere.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** lib/people.test.tsx; local browser measurement (same initials and colour in DM list, Team tasks, People)
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19). Verified in the local browser pass for low-severity items (measurements in final report §19).

### L9 — Avatar colours change from screen to screen

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Avatars
- **Reproduction (as reported):** The same user is orange in the channel, teal in the thread panel, teal again in People (where everyone is teal) and a different colour again in Team Tasks.
- **Root cause:** colour hashed from whatever name string; ThreadPanel/People/Profile used hard-coded teal; (found in verification) task assignee avatars (Team tasks, My tasks, board), task comments, phone Chats/Calls, Add member, admin Users and workspace Add members still coloured by name or a fixed colour
- **Relevant files:** Avatar (colour by userId), ThreadPanel/PeopleDirectory/ProfileModal use Avatar; TaskBits AssigneeAvatar, TaskDrawer, TaskViews, AddMemberModal, ChatsPage, CallsPage, MorePage, UserManagement, AddMembersModal pass the person's id
- **Proposed correction (report):** Derive the colour from the user id in one shared helper.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** lib/people.test.tsx; local browser measurement (same initials and colour in DM list, Team tasks, People)
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19). Verified in the local browser pass for low-severity items (measurements in final report §19).

### L10 — Links in messages aren’t clickable, and the preview starts as an empty box

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Messages
- **Reproduction (as reported):** https://example.com in a message is plain text. The link preview first shows as an empty dark box until it loads.
- **Root cause:** editor auto-link only runs on a following space/Enter, so a URL sent last stayed text; preview loading state was a bare grey box
- **Relevant files:** lib/sanitizeHtml.ts (render-time linkify of http(s) text, DOM-built anchors), LinkPreview.tsx (card skeleton)
- **Proposed correction (report):** Auto-link URLs when rendering messages, and give the preview a skeleton.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** lib/sanitizeHtml.test.ts (+3)
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: lib/sanitizeHtml.test.ts (+3).

### L11 — Double focus ring in the composer

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Composer
- **Reproduction (as reported):** After sending, a second teal outline appears inside the already highlighted composer.
- **Root cause:** global :focus-visible rule was unlayered -> beat Tailwind v4 layered outline-none on the editor
- **Relevant files:** index.css (rule moved into @layer base)
- **Proposed correction (report):** Remove the inner ProseMirror outline (outline: none) and keep the container’s focus style.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### L12 — Channel doesn’t open scrolled to the bottom

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Channels
- **Reproduction (as reported):** The last message’s preview card is cut off and “Jump to latest” floats over it right after opening.
- **Root cause:** initialTopMostItemIndex aligned the last item's top; the re-pin after late growth (link preview) was gated on Virtuoso's at-bottom flag, which turns false as soon as the item grows, and align:'end' (computed from summed, rounded item sizes) stopped ~6px short, so 'Jump to latest' showed over the newest message
- **Relevant files:** ChatArea.tsx (stick-to-bottom intent changed only by the reader's own wheel/touch/scrollbar/key scrolling; pins the scroller's real end on later growth; jump-to-message clears it; send/Jump to latest set it; new messages keep the smooth follow)
- **Proposed correction (report):** Scroll to the bottom again after images and previews finish loading.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** e2e/qa-remediation.spec.ts L12 step; local browser measurement (0px from the end, no Jump to latest)
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Verified in the local browser pass for low-severity items (measurements in final report §19).

### L13 — Reaction picker frame is hard-coded white

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Reactions
- **Reproduction (as reported):** The picker wrapper uses bg-white, so it shows white edges in dark theme.
- **Root cause:** wrapper hard-coded bg-white
- **Relevant files:** ReactionPicker.tsx uses bg-surface | (reported: `frontend/src/components/chat/ChatArea.tsx:1105`)
- **Proposed correction (report):** Use the surface token (bg-surface).
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L14 — Reactions appear seconds late and push the list down

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Reactions
- **Reproduction (as reported):** The reaction pill appears only after the server confirms, a few seconds later, and shifts every message below it. A second click can land on the wrong thing.
- **Root cause:** reactions waited for socket echo
- **Relevant files:** lib/reactions.ts toggleReactionLocally, ChatArea handleReact (rollback on error)
- **Proposed correction (report):** Add the reaction optimistically and roll back on error.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** lib/reactions.test.ts
- **Verification result:** Automated: lib/reactions.test.ts.

### L15 — “(edited)” is tiny; toolbar overlaps the edit box

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Messages
- **Reproduction (as reported):** The “(edited)” marker is about 9 px and sits on its own line. While editing, the hover toolbar overlaps the edit box’s top-right corner.
- **Root cause:** "(edited)" span after a block element at 11px; toolbar shown while editing
- **Relevant files:** ChatArea.tsx (marker next to time, 12px; toolbar hidden while editing), ThreadPanel.tsx
- **Proposed correction (report):** Put “(edited)” inline after the text at normal caption size, and hide the hover toolbar while editing.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** chat tests
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: chat tests.

### L16 — Brand-new users are greeted “Welcome back”

- **Original severity:** Low
- **Affected role:** Member
- **Screen / module:** Home
- **Reproduction (as reported):** On the very first visit the Home page says “Welcome back, qa.normal.user”, using the username rather than the name.
- **Root cause:** static "Welcome back" + username
- **Relevant files:** HomeView.tsx, lib/firstVisit.ts |
- **Proposed correction (report):** Say “Welcome” on first visit and use the display name.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L17 — More page: odd icon and an admin section for members

- **Original severity:** Low
- **Affected role:** Member
- **Screen / module:** More
- **Reproduction (as reported):** “Direct Messages” uses a lightning icon while the sidebar uses a chat bubble. A plain member sees an ADMINISTRATION section (it opens settings read-only).
- **Root cause:** Zap icon; Administration section unconditional
- **Relevant files:** MoreView.tsx (MessageSquare; section only with capabilities.canManage)
- **Proposed correction (report):** Reuse the sidebar icon and hide Administration for people without admin rights.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** layout.test.tsx
- **Verification result:** Automated: layout.test.tsx.

### L18 — Checkbox uses the browser’s blue

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Profile
- **Reproduction (as reported):** The Read receipts checkbox is browser-default blue, not the app’s teal.
- **Root cause:** no accent-color set
- **Relevant files:** index.css |
- **Proposed correction (report):** Set accent-color: var(--brand) on checkboxes and radios.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L19 — Saved profile title isn’t shown anywhere

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Profile
- **Reproduction (as reported):** Saving Title “QA Engineer” works (toast “Profile saved”) but the People card doesn’t show it.
- **Root cause:** People list not refreshed after profile save
- **Relevant files:** PeopleDirectory reads title via people store; ProfileSettingsModal updatePerson |
- **Proposed correction (report):** Show the title under the name on People cards and the profile popover.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L20 — Search palette input has a harsh focus box

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Search
- **Reproduction (as reported):** The Ctrl+K input draws a hard rectangular focus ring edge to edge that touches the search icon and the close button.
- **Root cause:** same root cause as L11 (palette input focus:outline-none ignored)
- **Relevant files:** index.css
- **Proposed correction (report):** Drop the input’s own ring inside the palette; the panel already shows focus.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L21 — Upload error text is cut off

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Uploads
- **Reproduction (as reported):** The failed attachment chip shows only “File uploads …”; the reason is visible only as a hover tooltip.
- **Root cause:** error in a w-56 chip with truncate
- **Relevant files:** AttachmentTray.tsx (failed chip w-72, line-clamp-4)
- **Proposed correction (report):** Let the error wrap to two lines or show it under the tray.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L22 — Sidebar rows and badges don’t line up

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Sidebar
- **Reproduction (as reported):** DM rows are indented about 12 px more than channel rows, and the DM unread badge sits about 14 px left of the “DMs” badge above it.
- **Root cause:** DM section used px-3 list padding, smaller header/toggle/row padding than Channels
- **Relevant files:** Sidebar.tsx (DM section spacing = Channels)
- **Proposed correction (report):** Use the same row component and padding for channels and DMs.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L23 — “New message” and “Create a channel” open as cramped popovers

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Dialogs
- **Reproduction (as reported):** Both open as 316 px popovers pinned over the sidebar instead of centred dialogs. In Create a channel, the Public and Private cards wrap to three lines.
- **Root cause:** Modal inside sidebar whose wrapper is transformed (translate-x) => containing block for fixed
- **Relevant files:** Layer.tsx, Modal.tsx |
- **Proposed correction (report):** Use the standard centred Modal at about 480 px.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L24 — Phone top bar: cut placeholder, ⌘ button, two search boxes

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Mobile
- **Reproduction (as reported):** At 390 px the top search placeholder is cut mid-word (“Search messages in S”), a ⌘ keyboard-shortcut button shows on phones, and a second “Filter conversations” box sits right below it.
- **Root cause:** long placeholder clipped w/o ellipsis; Jump-to (⌘) button on phones; header search + page filter stacked on Chats
- **Relevant files:** ChannelSearch.tsx (phone placeholder, text-ellipsis), Header.tsx (⌘ hidden < md, hideSearchOnPhone), WorkspaceLayout.tsx (Chats)
- **Proposed correction (report):** Shorten the placeholder or add an ellipsis, hide ⌘ on touch screens, and keep one search box.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack).

### L25 — Channel order differs between phone and desktop

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Mobile
- **Reproduction (as reported):** Desktop lists Announcements, General, Random; the phone lists General, Announcements, Random.
- **Root cause:** listChannelsForWorkspace/listChannelsForUser had no orderBy (nondeterministic)
- **Relevant files:** channels.service.ts orderBy name,id
- **Proposed correction (report):** Use one sort order.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** tests/qa-unread-workspaces.test.ts
- **Verification result:** Automated: tests/qa-unread-workspaces.test.ts.

### L26 — Small tap targets on phones

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Mobile
- **Reproduction (as reported):** “1 reply” links and reaction pills are 24 px tall; admin tabs on phones are also 24 px. Touch guidelines ask for about 44 px.
- **Root cause:** h-6 (24px) reply link / reaction pills; admin phone tabs py-1; (found in verification) the enlarged hit area was painted under the next message and cut by the list edge for the newest message (measured 29px)
- **Relevant files:** ChatArea.tsx (invisible ~44px hit area < md, z-1 above the next message, list footer room), AdminLayout.tsx (min-h-11 tabs)
- **Proposed correction (report):** Increase the hit area with padding on touch screens.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** local browser measurement (pill tappable 43px newest + mid-list; admin tabs 44px)
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L27 — Channel subtitle flickers

- **Original severity:** Low
- **Affected role:** All users
- **Screen / module:** Channels
- **Reproduction (as reported):** The channel header first says “Channel”, then changes to “Public channel” once details load.
- **Root cause:** placeholder Channel before details
- **Relevant files:** ChatArea.tsx |
- **Proposed correction (report):** Render nothing until details arrive.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L28 — Assignee names truncated with space to spare

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Tasks
- **Reproduction (as reported):** Team Tasks cuts “Tejas Rajesh Diw…” while the Task column has lots of empty space.
- **Root cause:** fixed column widths gave Task 31% / Assigned 16%
- **Relevant files:** TeamTasksPage.tsx (26% / 21%, title tooltip)
- **Proposed correction (report):** Rebalance column widths.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L29 — Typo in the workspace description

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Content
- **Reproduction (as reported):** “The Embroidary Platform” should be “Embroidery”.
- **Root cause:** the SmartUnifolio workspace description was typed "Embroidary" by its owner
- **Relevant files:** —
- **Proposed correction (report):** Edit the description in workspace settings.
- **Implementation status:** Data fix by owner (no code defect) (DATA (no code))
- **Test coverage:** owner edits it in Workspace settings (not changed: production data)
- **Verification result:** Automated: owner edits it in Workspace settings (not changed: production data).

### L30 — Create task: confusing Project hint

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Tasks
- **Reproduction (as reported):** The Project field already shows “Team tasks” while the hint says “Left empty, it goes to the workspace’s private ‘Team tasks’ list”.
- **Root cause:** empty option labelled "Team tasks" while hint said "Left empty"
- **Relevant files:** CreateTeamTaskModal.tsx ("No project (Team tasks list)" + matching hint) |
- **Proposed correction (report):** Show “None (Team tasks list)” as the empty option, or reword the hint.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L31 — Validation names the wrong field

- **Original severity:** Low
- **Affected role:** Team Lead, Member
- **Screen / module:** Projects
- **Reproduction (as reported):** The error says “The due date is before the start date” but the field is labelled “Target date”.
- **Root cause:** project form validation said "due date" for the Target date field
- **Relevant files:** TaskForms.tsx
- **Proposed correction (report):** Say “target date”.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L32 — Board columns cut off with no scroll hint

- **Original severity:** Low
- **Affected role:** Team Lead, Member
- **Screen / module:** Projects
- **Reproduction (as reported):** Only four of seven columns fit; “IN REVIEW” is cut at the right edge (its count badge is clipped), and Blocked, Done and Cancelled are off-screen with no hint.
- **Root cause:** overflow-x board with invisible overlay scrollbars and no affordance
- **Relevant files:** KanbanBoard.tsx (left/right fades when more columns)
- **Proposed correction (report):** Show a fade or arrow at the scroll edge, or narrow the columns.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L33 — Old list stays on screen after creating a project

- **Original severity:** Low
- **Affected role:** Team Lead, Member
- **Screen / module:** Projects
- **Reproduction (as reported):** After “Create project” the address changes to the new project, but the old Projects list (without the new project) stays visible for about five seconds.
- **Root cause:** router navigations run in a transition; old page stayed while the lazy ProjectPage chunk downloaded
- **Relevant files:** ProjectsPage.tsx (preloads ./ProjectPage)
- **Proposed correction (report):** Show the project page’s loading state immediately on navigation.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L34 — Workspace settings use a narrow column

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Settings
- **Reproduction (as reported):** Settings content is a ~620 px column pinned left, leaving most of a wide screen empty.
- **Root cause:** PageFrame is max-w-4xl mx-auto: centred (gap difference <= 24px) and > 700px wide at 1470px; the QA estimate came from a scaled screenshot
- **Relevant files:** —
- **Proposed correction (report):** Centre it or widen it to the page container.
- **Implementation status:** Closed — not reproducible / not a defect (NOT A DEFECT (measured))
- **Test coverage:** e2e/qa-remediation.spec.ts "QA L34"
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: e2e/qa-remediation.spec.ts "QA L34".

### L35 — Channel names aren’t normalised

- **Original severity:** Low
- **Affected role:** Team Lead, Member
- **Screen / module:** Channels
- **Reproduction (as reported):** “QA Test Channel!” is accepted with capitals, spaces and punctuation, although the placeholder suggests slug style (“product-launch”).
- **Root cause:** placeholder suggested slugs while names are free text (built-in channels are "General" etc.)
- **Relevant files:** CreateChannelModal.tsx placeholder "e.g. Product launch"
- **Proposed correction (report):** Slugify on input (lowercase, hyphens) or drop the slug-style placeholder.
- **Implementation status:** Resolved (FIXED (by design choice))
- **Test coverage:** channels.test.tsx
- **Verification result:** Automated: channels.test.tsx.

### L36 — Archive uses the browser’s confirm() popup

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Dialogs
- **Reproduction (as reported):** Archiving a channel (and making someone channel owner) uses window.confirm(), while deleting a message uses the app’s styled dialog.
- **Root cause:** window.confirm() for archive / make owner / remove member (and admin moderation + channel delete)
- **Relevant files:** ChannelSettingsModal.tsx, MessageModeration.tsx, ChannelManagement.tsx (ConfirmDialog) (reported: `frontend/src/components/chat/ChannelSettingsModal.tsx:78,89`)
- **Proposed correction (report):** Use the app’s ConfirmDialog everywhere.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** channels.test.tsx, MessageModeration.test.tsx
- **Verification result:** Automated: channels.test.tsx, MessageModeration.test.tsx.

### L37 — Archiving: no progress, red “Restore”, still in sidebar

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Channels
- **Reproduction (as reported):** Archive takes about 8 s with no loading state. “Restore channel” is red, the colour for destructive actions. The archived channel still sits in the sidebar like an active one.
- **Root cause:** no busy state; restore styled hover:text-red; open archived channel unmarked in sidebar (hidden once closed — by design)
- **Relevant files:** ChannelSettingsModal.tsx (Archiving…/Restoring…, brand hover for Restore), Sidebar.tsx (Archived marker)
- **Proposed correction (report):** Add a busy state, style Restore as a normal action, and move archived channels out of the main list.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** channels.test.tsx
- **Verification result:** Automated: channels.test.tsx.

### L38 — “Send invite” doesn’t send anything

- **Original severity:** Low
- **Affected role:** Team Lead
- **Screen / module:** Invites
- **Reproduction (as reported):** The Invite people dialog says “Send invite” with no warning that e-mail is off (the Settings tab does warn). Afterwards it only shows a link to copy, and the invitations list says “Sent 20 Nov 2026”.
- **Root cause:** header Invite dialog didn't know e-mail was off; list said "Sent"
- **Relevant files:** InviteMemberModal.tsx (reads settings.emailInvitationsAvailable: "Create invitation" + hint), InvitationsPanel.tsx ("Invited")
- **Proposed correction (report):** While e-mail is off, label the button “Create invite link” and show “Link created” in the list.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** workspaceAdmin tests
- **Verification result:** Automated: workspaceAdmin tests.

### L39 — Non-admin on the admin form is silently signed into the app

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin login
- **Reproduction (as reported):** Signing into “Administrator console” with the Team Lead account gives no “not an administrator” message; it signs into the regular app. No admin access is granted, but it is confusing.
- **Root cause:** admin form called the same login(); no role check
- **Relevant files:** AuthContext.tsx, AuthForm.tsx
- **Proposed correction (report):** Show “This account isn’t an administrator” and stay on the form.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** AuthForm.login.test.tsx
- **Verification result:** Automated: AuthForm.login.test.tsx.

### L40 — Online users card: last row cut, two dots per row

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** The fourth online user is cut off at the card’s bottom, and each row shows two green status dots.
- **Root cause:** list max-h-60 cut 4th row; emoji status + always-green pulse dot
- **Relevant files:** AdminDashboard.tsx (Avatar, status-coloured dot, row-height list)
- **Proposed correction (report):** Let the card grow or scroll with a fade, and keep one status dot.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L41 — Contradictory Team Lead badges

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** One Team Lead shows both “REVOKED” and “AWAITING ACTIVATION”.
- **Root cause:** "Awaiting activation" computed for any non-accepted invitation incl. REVOKED/EXPIRED
- **Relevant files:** TeamManagement.tsx (only PENDING awaits activation; otherwise the invitation badge alone)
- **Proposed correction (report):** Show only the current state.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** TeamManagement.test.tsx (updated to the corrected rule)
- **Verification result:** Automated: TeamManagement.test.tsx (updated to the corrected rule).

### L42 — Admin pages use three different header styles

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** System Overview and Channel Administration use a big icon tile and a very large title; Users and Team Management use a plain title with a description; File storage uses a small title. Channel search has no icon.
- **Root cause:** each admin page had its own header style
- **Relevant files:** components/admin/AdminPageHeader.tsx used by AdminDashboard, ChannelManagement (+search icon), MessageModeration, AuditLogViewer, FileStorageManagement |
- **Proposed correction (report):** Use one page-header component across the admin console.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** —
- **Verification result:** Verified in the local browser pass for low-severity items (measurements in final report §19).

### L43 — Audit log shows raw IDs and timestamps

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** Entries read “Approved join request of user 7bd7b365-bb66-…” and “invitation expires 2026-11-20T10:36:14.300Z”. There is no search, filter or paging, and the subtitle says “in this workspace” although the log is company-wide.
- **Root cause:** details shown verbatim (UUIDs/ISO); no filters (paging existed); subtitle "this workspace"
- **Relevant files:** admin.service getAuditLogs (action/q filters, actions list, targetLabel), admin.controller, invitations.service (join approval names the user), AuditLogViewer.tsx (search, action filter, readableDetails, Avatar, company-wide subtitle)
- **Proposed correction (report):** Resolve IDs to names, format dates, and add filters and paging.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** qa-admin-data.test.ts, AuditLogViewer.test.tsx
- **Verification result:** Automated: qa-admin-data.test.ts, AuditLogViewer.test.tsx.

### L44 — Chart gridlines are glaring in dark theme

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** In dark mode the chart grid stays bright white dashes, and the tick colour is hard-coded #9ca3af.
- **Root cause:** hard-coded #f1f0f5 grid / #9ca3af ticks / white tooltip
- **Relevant files:** AdminDashboard.tsx (token colours via useResolvedTheme)
- **Proposed correction (report):** Take grid and tick colours from theme tokens.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### L45 — Admin header is cramped on phones

- **Original severity:** Low
- **Affected role:** Admin
- **Screen / module:** Admin
- **Reproduction (as reported):** At 390 px the wrapped “System Overview” title runs into the “All Systems Operational” badge, and the tab row is cut (“Team Managemen”) with no scroll hint.
- **Root cause:** dashboard title + status badge in one non-wrapping row; phone tab row cut without hint
- **Relevant files:** AdminPageHeader (stacks < lg), AdminLayout tab row fade (see below)
- **Proposed correction (report):** Stack the badge under the title on small screens and add a fade to the tab row.
- **Implementation status:** Resolved (FIXED)
- **Test coverage:** browser check
- **Verification result:** Verified in the local visual pass (screenshots + measurements, final report §19).

### V1 — Space after an emoji may be dropped

- **Original severity:** Manual re-check
- **Affected role:** All users
- **Screen / module:** Messages
- **Reproduction (as reported):** Messages typed as “user 👋 this” were stored as “user 👋this” in the channel, the thread and Content Moderation. The text was typed by automation, so please re-check by hand before fixing.
- **Root cause:** real typing keeps the space; the QA observation came from CDP keystroke injection
- **Relevant files:** —
- **Proposed correction (report):** If it reproduces, check the editor’s input rules for emoji handling.
- **Implementation status:** Closed — not reproducible / not a defect (NOT REPRODUCIBLE (closed))
- **Test coverage:** e2e/qa-remediation.spec.ts "QA V1"
- **Verification result:** Verified in a real browser (e2e/qa-remediation.spec.ts, local stack). Automated: e2e/qa-remediation.spec.ts "QA V1".

## Additional fixes found during remediation (not in the original 72)

- **Test infrastructure:** p2-shared-workspace.test deleted SmartConnect Collab in afterAll -> order-dependent 503s in auth.test / email-validation-dos (7 baseline failures) → tests/p2-shared-workspace.test.ts
- **Test infrastructure:** auth.test / email-validation-dos assumed SmartConnect Collab already existed (created only by server startup or another file); on a fresh database, where vitest runs previously-failed files first, they got 503 → tests/auth.test.ts, tests/email-validation-dos.test.ts (beforeAll ensureSharedWorkspace, as public-signup/stage6a do)
- **Test infrastructure:** backend tests/setup.ts did not refuse a non-local DATABASE_URL (backend/.env points at hosted Neon) → tests/setup.ts |
- **Admin Channel Administration "Type" column** showed every non-DM channel as "Public" (found while fixing M10) → now shows the real visibility.
- **Mention key handling** could throw on Enter while the suggestion list was empty (introduced risk while fixing M6) → guarded and covered.
- **Phone tap areas under the next message** (found while verifying L26): the enlarged hit area of reaction pills and reply links was covered by the following message → lifted above it on phones; measured 43px.
