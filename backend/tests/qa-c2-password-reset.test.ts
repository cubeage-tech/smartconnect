import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import { app } from '../app';
import { EmailSendError, resetEmailDeliveryHealth } from '../lib/emailDelivery';
import { FORGOT_PASSWORD_REPLY, PASSWORD_RESET_UNAVAILABLE } from '../modules/auth/auth.service';
import { RESET_EMAIL_UNAVAILABLE } from '../modules/admin/admin.service';
import { sendResetPasswordEmail } from '../utils/mailer';
import { authHeader, createAndLoginUser, uniqueEmail, withFakeEmailSettings } from './helpers';

/**
 * QA C2 — "Forgot password" claimed a reset link had been sent while the
 * server had no e-mail service configured, so nothing could ever arrive.
 * Now: no e-mail possible -> 503 with a plain message, identical for every
 * address; e-mail accepted by Brevo -> the neutral "on its way" reply; Brevo
 * refusing -> 503, and the same 503 for every address for a while afterwards.
 */
const forgot = (email: string) => request(app).post('/api/auth/forgot-password').send({ email });

afterEach(() => {
  vi.mocked(sendResetPasswordEmail).mockReset().mockResolvedValue({ sent: true });
  resetEmailDeliveryHealth();
});

describe('QA C2 — forgot-password tells the truth about e-mail', () => {
  it('with no e-mail service: 503 for known and unknown addresses alike, and nothing is attempted', async () => {
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockClear();
    const known = await forgot(user.email);
    const unknown = await forgot(uniqueEmail());
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(known.body).toEqual(unknown.body);
    expect(JSON.stringify(known.body)).toContain(PASSWORD_RESET_UNAVAILABLE);
    expect(JSON.stringify(known.body)).not.toMatch(/has been sent|on its way/);
    expect(sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it('with e-mail accepted by the provider: the same neutral 200 for known and unknown addresses, never "has been sent"', async () => {
    const { user } = await createAndLoginUser();
    await withFakeEmailSettings(async () => {
      const known = await forgot(user.email);
      const unknown = await forgot(uniqueEmail());
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body).toEqual(FORGOT_PASSWORD_REPLY);
      expect(unknown.body).toEqual(known.body);
      expect(known.body.message).not.toMatch(/has been sent/);
    });
    expect(sendResetPasswordEmail).toHaveBeenCalledTimes(1);
  });

  it('a provider refusal is a 503, and every address gets that same 503 until the failure window ends', async () => {
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockRejectedValue(new EmailSendError('Brevo API error (HTTP 401 unauthorized): Key not found', true));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await withFakeEmailSettings(async () => {
      const first = await forgot(user.email);
      expect(first.status).toBe(503);
      expect(JSON.stringify(first.body)).toContain(PASSWORD_RESET_UNAVAILABLE);
      expect(JSON.stringify(first.body)).not.toMatch(/Brevo|401|Key not found/);
      // An unknown address now answers exactly like a known one.
      const unknown = await forgot(uniqueEmail());
      expect(unknown.status).toBe(503);
      expect(unknown.body).toEqual(first.body);
    });
    // The log names the reason only — never a link or token.
    const logged = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/not sent/);
    expect(logged).not.toMatch(/reset-password\?token=/);
    err.mockRestore();
  });

  it('an outage (timeout, network) is also a 503, never a 500 or a false "sent"', async () => {
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockRejectedValue(new EmailSendError('Brevo did not respond within 10 s', false));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await withFakeEmailSettings(() => forgot(user.email).then((r) => r));
    expect(res.status).toBe(503);
    err.mockRestore();
  });

  it('a mailer that reports "not configured" is a 503 too', async () => {
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockResolvedValue({ sent: false, reason: 'not_configured' });
    const res = await withFakeEmailSettings(() => forgot(user.email).then((r) => r));
    expect(res.status).toBe(503);
  });
});

describe('QA C2 — admin "send reset e-mail" tells the truth too', () => {
  it('with no e-mail service: 503 pointing at "Set password…", nothing attempted', async () => {
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const { user } = await createAndLoginUser();
    vi.mocked(sendResetPasswordEmail).mockClear();
    const res = await request(app).post(`/api/admin/users/${user.id}/force-reset`).set(authHeader(admin.token));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain(RESET_EMAIL_UNAVAILABLE);
    expect(sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it('with e-mail: "accepted for delivery"; a provider refusal is a 502, not "sent"', async () => {
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const { user } = await createAndLoginUser();
    await withFakeEmailSettings(async () => {
      const ok = await request(app).post(`/api/admin/users/${user.id}/force-reset`).set(authHeader(admin.token));
      expect(ok.status).toBe(200);
      expect(ok.body.message).toMatch(/accepted for delivery/);
      vi.mocked(sendResetPasswordEmail).mockRejectedValue(new EmailSendError('Brevo API error (HTTP 400)', false));
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const refused = await request(app).post(`/api/admin/users/${user.id}/force-reset`).set(authHeader(admin.token));
      err.mockRestore();
      expect(refused.status).toBe(502);
      expect(JSON.stringify(refused.body)).not.toMatch(/sent to/);
    });
  });
});

describe('QA C2 — the real mailer reports what Brevo answered', () => {
  const stubBrevo = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('not configured -> { sent: false }; accepted -> { sent: true, messageId }; 401 -> EmailSendError(providerRejected)', async () => {
    const real = await vi.importActual<typeof import('../utils/mailer')>('../utils/mailer');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await real.sendResetPasswordEmail('a@example.test', 'https://app.example/reset')).toEqual({ sent: false, reason: 'not_configured' });
    warn.mockRestore();

    await withFakeEmailSettings(async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      stubBrevo(201, { messageId: '<abc@smtp-relay.brevo.com>' });
      expect(await real.sendResetPasswordEmail('a@example.test', 'https://app.example/reset')).toEqual({ sent: true, messageId: '<abc@smtp-relay.brevo.com>' });
      log.mockRestore();

      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      stubBrevo(401, { code: 'unauthorized', message: 'Key not found' });
      const rejected = await real.sendResetPasswordEmail('a@example.test', 'https://app.example/reset').catch((e: unknown) => e);
      expect(rejected).toBeInstanceOf(EmailSendError);
      expect((rejected as EmailSendError).providerRejected).toBe(true);
      expect((rejected as Error).message).not.toContain('test-brevo-key-not-real');

      stubBrevo(502, null);
      const outage = await real.sendResetPasswordEmail('a@example.test', 'https://app.example/reset').catch((e: unknown) => e);
      expect((outage as EmailSendError).providerRejected).toBe(false);
      err.mockRestore();
    });
  });
});
