# SmartConnect — Production Readiness

Date: 2026-11-20 · Base commit `31af1f6` on `main`. The remediation is committed and pushed as `3f2b820`; the CI concurrency fix on top of it is **not committed**. **Nothing is deployed.**

Companion documents: `docs/SMARTCONNECT_QA_FINAL_REPORT.md` (results, root causes, tests) and `docs/SMARTCONNECT_QA_REMEDIATION_TRACKER.md` (all 72 findings).

## Verdict

**The code is ready to review and deploy.** Type checks, builds and the test suites pass (final report §14–§18). The change set is backwards compatible, and its one migration only adds a column.

Two production features stay off after deploy until Render is given valid credentials:

| Feature | Without the credential fix | With it |
|---|---|---|
| File uploads, voice messages, task attachments, profile photos (C1, H4) | Every upload fails with an honest “File uploads are not available on this server right now” message (503). The startup log says the credentials were rejected. | Uploads work. |
| Password-reset e-mail (C2) | Forgot-password answers “Password reset e-mails can’t be sent right now…” (503) instead of claiming it was sent. Administrators can still use **Set password…** in User Management. | Reset e-mails are sent, and the reply stays neutral for every address. |

## 1. Before deploying

- [ ] Commit the CI concurrency fix (`backend/lib/policy/context.ts`, `backend/modules/invitations/invitations.service.ts`, new `backend/tests/signup-concurrency-small-pool.test.ts`) and the updated documents. The rest of the remediation is already in `3f2b820`.
- [ ] Confirm the GitHub Actions backend job is green on that commit. `3f2b820` itself failed CI on two concurrent sign-up tests, and this fix addresses them (final report §14).
- [ ] Render → API service → Environment:
  - [ ] Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` to the three values of one Cloudinary account (Cloudinary console → Dashboard → API Keys). Production currently rejects the values it has.
  - [ ] Set `BREVO_API_KEY` to a Brevo **API v3** key, not an SMTP key.
  - [ ] Set `BREVO_FROM_EMAIL` to a sender **verified in Brevo** (Senders, Domains & Dedicated IPs). Optionally set `BREVO_FROM_NAME`.
  - [ ] Leave `APP_URL` unchanged: the public frontend URL. Reset and invitation links are built from it.
- [ ] Vercel: no change. The SPA rewrite in `frontend/vercel.json` already serves the new `/admin/login` route.
- [ ] Optional, recommended (M18): run the API in the same region as the database. The database is Neon in AWS ap-southeast-1. `render.yaml` sets no region, so the API is on Render’s default (Oregon) unless it was changed in the dashboard.

## 2. Deploy order

1. **Backend (Render).**
   - The build (`npm ci --include=dev && npm run build`) runs `prisma generate`, which picks up the `relationJoins` preview feature.
   - The start command (`npm run db:deploy && npx tsx server.ts`) applies the one new migration (`20261120120000_qa_h4_profile_avatar`) before the server starts. It is additive: one nullable column, a unique index and a foreign key.
2. **Check the startup log** for one of these lines (variable names only; values are never logged):
   - `File storage: Cloudinary accepted the server credentials.` means uploads are on.
   - `File storage is OFF: Cloudinary rejected this server's credentials…` means you need to fix the three `CLOUDINARY_*` values and redeploy.
   - `File storage: Cloudinary reports its usage or rate limit is reached…` or `…could not be reached at startup…` means a quota or network problem, not configuration.
3. **Frontend (Vercel).** Deploy as usual.

## 3. After deploying: production checks

Use the real roles: an Admin, a Team Lead and a newly signed-up Member account. Check desktop and phone, and light and dark themes.

| # | Check | Expected | Findings |
|---|---|---|---|
| 1 | Member: attach an image and a PDF in a channel, record a voice message, attach a file to a task | Upload succeeds. If it fails, the message names the real reason. | C1 |
| 2 | Signed out: **Forgot password** with your own address | “If an account exists for that address, a password reset link is on its way…”, and the e-mail arrives (check spam). With e-mail still unconfigured, it shows “can’t be sent right now” instead. | C2, M16 |
| 3 | Reset link from that e-mail → set a new password → sign in | Works. The link can’t be used twice. Other sessions are signed out. | C2 |
| 4 | Admin: User Management → force reset a test account | “Accepted for delivery”, or a clear 503/502 reason | C2 |
| 5 | Open `/admin/login` and sign in with a Member account | Refused: “This account isn’t an administrator…” | L5, L39 |
| 6 | Member: Profile & preferences → change the name, set a title, add a photo | Name and photo appear in the sidebar, header, messages, People and threads. The title shows on the People card. | H4, L8, L9, L19 |
| 7 | Open a busy channel whose newest message has a link | Opens at the very end, the preview is fully visible, and there is no “Jump to latest” | L12 |
| 8 | React to the newest message | The picker opens fully on screen and closes with Escape or an outside click | H2, M1 |
| 9 | Team Lead: open a team task from the table; change its status | The drawer’s Close, Share and Delete buttons sit above the header. The table updates. | H1, M4 |
| 10 | Message in another workspace you belong to | The workspace rail shows an unread dot | M12 |
| 11 | Admin dashboard, Channel Management, Content Moderation, Audit Logs, in dark theme and on a phone | Consistent headers, readable charts, no sideways scrolling, 44 px tabs on phones | H5, H6, M8–M11, L40–L45 |
| 12 | Start a video call between two accounts; switch the camera; share the screen | Self view and the remote video show. In call code, only the pre-join lobby changed: it now layers above the app header (M2). | regression |
| 13 | Time a few page loads (browser dev tools → Network) | Fewer requests per page (notifications and hierarchy load once). Each API call makes 14–69% fewer serial database round trips (median 56%). Most of the remaining time is the API↔database distance. | M18 |

## 4. Rollback

- **Code:** redeploy the previous commit (`31af1f6`) on Render and Vercel.
- **Database:** no rollback is needed. The new `UserProfile.avatarAttachmentId` column is nullable, and the old code ignores it. Leave the column in place rather than dropping it, because dropping it would delete profile-photo links.
- **`relationJoins` only:** remove `previewFeatures = ["relationJoins"]` from `backend/prisma/schema.prisma` and redeploy. This restores the previous query strategy with no schema change.

## 5. Test-data cleanup manifest (needs your confirmation)

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

## 6. Known limitations carried into production

- **M15:** sign-up still reveals whether an e-mail is registered. This is a product decision; it needs e-mail verification first (C2).
- **L7:** the minimum password length stays at 6 (a documented product rule). People now see a strength hint.
- **L29:** the SmartUnifolio description typo is the owner’s data to fix.
- **M18:** serial database round trips fall by 14–69% per call (median 56%). Co-locating the API and the database is what removes the rest.
- **`relationJoins`** is a Prisma preview feature (see Rollback).
