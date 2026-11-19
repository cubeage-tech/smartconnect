# SMTP Production Audit: Brevo on Render

> **Update (2026-11-19):** superseded by the Brevo integration. E-mail now goes through Brevo's transactional HTTP API (`POST https://api.brevo.com/v3/smtp/email`, HTTPS) using `BREVO_API_KEY`, `BREVO_FROM_EMAIL` and `BREVO_FROM_NAME`, which is option B below. Resend, `RESEND_API_KEY` and `EMAIL_FROM` are no longer used, and SMTP is still not used. See `README.md` and `render.yaml` for the current settings. The findings below describe commit `7734bbd`.

- **Date:** 2026-11-17
- **Commit audited:** `7734bbd` (branch `main`)
- **Scope:** read-only. No code, database, environment or deployment changes. No emails were sent and no invitations were created. Secret values in `backend/.env` were not read; only key names and value lengths were checked. The Render dashboard was not accessed, so production env values are unverified.

## Verdict: NOT READY

1. **The code has no SMTP support.** It sends all email through **Resend's HTTP API**, keyed on `RESEND_API_KEY`. No code reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` or `SMTP_FROM_NAME`, so Brevo credentials have no effect.
2. **The backend build fails at the current commit**, so no fix can be deployed until that is corrected.
3. **The Render backend is on the free plan, which blocks outbound SMTP on ports 25, 465 and 587.**

---

## What's working

| Area | Evidence |
|---|---|
| **Live frontend URL.** All emailed links use `APP_URL`. The server refuses to start in production without it, rejects non-http(s) values and strips trailing slashes. Production never falls back to localhost. | [config/env.ts:19-28](../backend/config/env.ts#L19-L28), [config/deployment.ts:18-28](../backend/config/deployment.ts#L18-L28) |
| **Link targets exist in the frontend router:** `/invite/:token`, `/reset-password?token=&id=`, `/activate#token=`, `/join-workspace?token=` | [invitations.service.ts:110](../backend/modules/invitations/invitations.service.ts#L110), [auth.service.ts:310](../backend/modules/auth/auth.service.ts#L310), [teamLeads.service.ts:89](../backend/modules/teamManagement/teamLeads.service.ts#L89), [router.tsx:61-71](../frontend/src/routes/router.tsx#L61-L71) |
| **Workspace email invites handle failures honestly.** If no provider is configured, the response is `emailSent:false, emailUnavailable:true`. If the provider fails, the response is `emailSent:false`. In both cases the invitation is still saved, and the UI shows a warning plus a "not configured" banner. | [invitations.service.ts:116-145](../backend/modules/invitations/invitations.service.ts#L116-L145), [workspaces.service.ts:227](../backend/modules/workspaces/workspaces.service.ts#L227), [InvitationsPanel.tsx:65-67](../frontend/src/components/workspaceAdmin/InvitationsPanel.tsx#L65-L67) |
| **Team Lead and Team Member onboarding works without email.** Activation links and temporary passwords are shown once to the creator. | [teamLeads.service.ts:139-166](../backend/modules/teamManagement/teamLeads.service.ts#L139-L166), [OneTimeCredentialsModal.tsx](../frontend/src/components/ui/OneTimeCredentialsModal.tsx) |
| **Secrets are not committed.** `backend/.env` is gitignored and untracked, and `render.yaml` marks every secret `sync: false`. | `.gitignore:24`, [render.yaml](../render.yaml) |

## What's broken or missing

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Critical** | **Brevo SMTP is not implemented.** `nodemailer` is not installed and the only mail dependency is `resend`. Email is "configured" only when `RESEND_API_KEY` is non-empty. The local `.env` sets all six `SMTP_*` keys, but `RESEND_API_KEY` is **empty** and `EMAIL_FROM` is absent, so email is off. The same is true on Render unless `RESEND_API_KEY` is set there. | [utils/mailer.ts:1-22](../backend/utils/mailer.ts#L1-L22), [lib/emailDelivery.ts:8](../backend/lib/emailDelivery.ts#L8) |
| 2 | **Critical** | **The backend build fails.** `"ignoreDeprecations": "6.0"` is invalid for TypeScript 5.8.3 (the version in the lockfile). `tsc` reports TS5103 and exits with code 2, and Render's build command runs that same `tsc` (`npm run build`). The setting was added in `0b7cd32` (2026-06-10). With only this option overridden, the type-check passes with 0 errors. | [backend/tsconfig.json:6](../backend/tsconfig.json#L6), [render.yaml:13](../render.yaml#L13) |
| 3 | **High** | **Render's free plan blocks SMTP ports 25, 465 and 587.** SMTP on 587 or 465 would time out even after it is implemented. Port 2525 (which Brevo supports) is not on Render's block list, but it has not been tested from Render. The mailer's own comment records earlier Gmail SMTP timeouts on Render. | [render.yaml:6](../render.yaml#L6), [mailer.ts:4-8](../backend/utils/mailer.ts#L4-L8) |
| 4 | **High (gap)** | **Team Lead and Team Member invitations never send email, by design.** `POST /api/team-management/team-leads` and `POST /api/workspaces/:id/member-invitations` return the credentials to the creator, who must pass them on manually. Only these flows send email: workspace invites (`POST /api/workspaces/:id/invites`), forgot-password, admin force-reset, and OTP signup (currently unused). | [teamLeads.service.ts:146-166](../backend/modules/teamManagement/teamLeads.service.ts#L146-L166), [teamMembers.service.ts](../backend/modules/teamManagement/teamMembers.service.ts) |
| 5 | Medium | **Admin force-reset claims success when nothing was sent.** It returns "Password reset email sent to …" even though the mailer only logs a warning and returns when no provider is configured. | [admin.service.ts:260-264](../backend/modules/admin/admin.service.ts#L260-L264), [mailer.ts:98-101](../backend/utils/mailer.ts#L98-L101) |
| 6 | Medium | **A provider failure in forgot-password returns 500 only for real accounts.** The mailer throws an error with no status code, which becomes a generic 500. Unknown addresses still get 200, which breaks the design that gives the same reply whether or not an account exists, and the user sees an error. | [auth.service.ts:311](../backend/modules/auth/auth.service.ts#L311), [auth.service.ts:316-328](../backend/modules/auth/auth.service.ts#L316-L328), [error.middleware.ts:57](../backend/middleware/error.middleware.ts#L57) |
| 7 | Low | **The workspace name goes into the email HTML and subject without escaping.** It is only trimmed, so a workspace manager can inject markup or links into SmartConnect-branded email. | [mailer.ts:35-39](../backend/utils/mailer.ts#L35-L39), [workspaces.service.ts:55](../backend/modules/workspaces/workspaces.service.ts#L55) |
| 8 | Low | **Provider error text is returned in the invite API response** as `emailError`. The frontend discards it. | [invitations.service.ts:142](../backend/modules/invitations/invitations.service.ts#L142) |
| 9 | Low | **Email verification at signup is off in production.** The active route is the unverified `/signup`. The OTP route returns a generic 500 when email isn't configured. | [auth.routes.ts:33-41](../backend/modules/auth/auth.routes.ts#L33-L41), [auth.service.ts:180](../backend/modules/auth/auth.service.ts#L180) |
| 10 | Low | **Stale documentation.** `frontend/.env.example` still says invitations use "nodemailer". | [frontend/.env.example:11](../frontend/.env.example#L11) |

**STARTTLS / Brevo authentication:** there is no SMTP transport, so neither can be checked. When one is implemented, the correct Brevo settings are:
- Host: `smtp-relay.brevo.com`
- Port and TLS: 587 with STARTTLS (`secure:false`, `requireTLS:true`), 465 with TLS (`secure:true`), or 2525
- Username: the Brevo **SMTP login**
- Password: an **SMTP key** (`xsmtpsib-…`), not an API key (`xkeysib-…`)
- `SMTP_FROM_EMAIL` must be a verified Brevo sender or domain.

## Render environment variables

**Backend (`smartconnect-backend`)**

| Variable | Status | Notes |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required | The server exits without them. |
| `APP_URL` | Required | The exact `https://` frontend URL. It is the base of every emailed link. |
| `NODE_ENV=production`, `NODE_VERSION=22.14.0` | Required | Already in `render.yaml`. |
| `RESEND_API_KEY` | **Required for any email with the current code** | |
| `EMAIL_FROM` | Effectively required | Use an address on a domain verified in Resend. Without it, mail comes from `onboarding@resend.dev`, which delivers only to the Resend account owner. |
| *Brevo, only after a code change (Fix 2B or 2C):* `BREVO_API_KEY`, **or** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`; plus `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Not read today | `BREVO_API_KEY` is a proposed name; the code reads none of these yet. |
| `TEAM_LEAD_INVITATION_TTL_HOURS` (default 72), `TRUST_PROXY`, `REDIS_URL`, `CALL_TURN_*`, `HTTP_REQUEST_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `PRESENCE_HEARTBEAT_MS`, `CALL_MAX_PARTICIPANTS`, `CALL_RING_TIMEOUT_MS` | Optional | |
| `BOOTSTRAP_*`, `RESET_*`, `PRIVATIZE_CONFIRM` | **Do not set** | Used only by one-off scripts. |

**Frontend (`smartconnect-frontend`):** `VITE_API_URL` and `VITE_BACKEND_URL` (read at build time; redeploy after changing them), and `NODE_VERSION`.

## Fixes required, in priority order

1. **Fix the backend build.** Remove `"ignoreDeprecations": "6.0"` from [backend/tsconfig.json:6](../backend/tsconfig.json#L6), or set it to `"5.0"`. With the option overridden, the type-check already passes with 0 errors.
2. **Choose an email path** (your decision):
   - **A. No code change (fastest).** Keep Resend: verify a sending domain in Resend, set `RESEND_API_KEY` and `EMAIL_FROM` in Render, and redeploy. It uses HTTPS on port 443, so it works on the free plan.
   - **B. Brevo, recommended if Brevo is required.** Replace the Resend client in `utils/mailer.ts` with Brevo's transactional HTTP API (`POST https://api.brevo.com/v3/smtp/email`, header `api-key`, HTTPS on port 443, so it works on the free plan; `axios` is already a dependency). Point `lib/emailDelivery.ts` at the new key, and update `render.yaml`, `.env.example` and the mailer tests (`deployment-config`, `t36`).
   - **C. Brevo SMTP via nodemailer.** Only use this on a paid Render instance (ports 587/465), or after confirming port 2525 is reachable from Render. Set connection and greeting timeouts so a blocked port fails fast instead of hanging the request.
3. **Configure Render.** Set `APP_URL` to the exact frontend URL and the email variables for the chosen option, then redeploy the backend. Check `/api/health`, then send one invite to an address you own.
4. **Make admin force-reset honest.** Check `emailDeliveryConfigured()` first and report "not configured" instead of "sent" ([admin.service.ts:260-264](../backend/modules/admin/admin.service.ts#L260-L264)).
5. **Make forgot-password tolerate provider errors.** Catch and log mailer errors, then return the same reply as for unknown addresses ([auth.service.ts:327](../backend/modules/auth/auth.service.ts#L327)).
6. **HTML-escape `workspaceName`** in email templates ([mailer.ts:35-39](../backend/utils/mailer.ts#L35-L39)).
7. **Decide whether Team Lead and Team Member activation should be emailed.** If so, email only the activation link and keep the temporary password on the separate manual hand-off.
8. **Housekeeping.** Drop `emailError` from the invite response, fix the `frontend/.env.example` comment, remove the unused local `SMTP_*` keys (or wire them up via Fix 2C), and re-enable OTP signup once email works.

## Tests run

| Command | Result |
|---|---|
| `cd backend && npm run lint` (`tsc --noEmit`, the same check as the Render build) | **FAIL**: TS5103 at `tsconfig.json(6,27)`, exit code 2 |
| `cd backend && npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 5.0` (diagnostic only) | Pass, 0 errors |
| `tests/deployment-config.test.ts` (mailer sender and subjects with Resend mocked, APP_URL normalisation, CORS, trust proxy), run through a scratch config with no database or migrations ¹ | **9/9 passed** |
| `cd frontend && npx vitest run src/lib/api/api.test.ts src/components/workspaceAdmin/t36-addMembers.test.tsx src/components/admin/TeamManagement.test.tsx src/components/workspaceAdmin/teamMembers.test.tsx` | **4 files, 25/25 passed** |

¹ The scratch config was not added to the repo. `tests/setup.ts` was bypassed because it runs `prisma migrate deploy`.

**Not run: the database-backed backend suites** (`t36-members-without-smtp`, `deployment-http` (reset link uses `APP_URL`), `stage2-team-leads`, `stage3-team-members`, `stage2-invite-only-signup`, `auth`). They run migrations and create users and invitations in whatever `DATABASE_URL` resolves to. `config/env.ts` loads `backend/.env`, and its database could not be confirmed as disposable without reading the secret. To run them safely, point them at a disposable database. A shell variable takes precedence over `.env`:

```sh
cd backend && DATABASE_URL=postgresql://<user>@localhost:5432/<disposable_test_db> RESEND_API_KEY= \
  npx vitest run tests/t36-members-without-smtp.test.ts tests/deployment-http.test.ts \
  tests/stage2-team-leads.test.ts tests/stage3-team-members.test.ts
```

## Sources
- [Render changelog: free web services block outbound SMTP ports 25, 465 and 587](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)
- [Brevo SMTP relay integration (ports, SMTP key vs API key)](https://developers.brevo.com/docs/smtp-integration)
