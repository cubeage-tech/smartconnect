import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { invitationFor } from './collab-helpers';
import { authHeader, uniqueEmail, uniqueUsername } from './helpers';

vi.mock('../utils/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendOtpEmail } from '../utils/mailer';

const mockedSendOtpEmail = vi.mocked(sendOtpEmail);

// Sign-up joins SmartConnect Collab, which the server creates at startup. This
// file uses the app in-process (no startup), so create it here — otherwise the
// result depends on whether an earlier file in the run happened to create it.
beforeAll(async () => {
  await ensureSharedWorkspace();
});

beforeEach(() => {
  mockedSendOtpEmail.mockClear();
});

describe('signup -> verify -> login -> me', () => {
  it('completes the full OTP signup flow and issues a working token', async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    const password = 'Password123!';
    const inviteToken = await invitationFor(email); // optional: sign-up is public; this also exercises the invitation path

    const signupRes = await request(app)
      .post('/api/auth/signup-request')
      .send({ username, email, password, inviteToken });
    expect(signupRes.status).toBe(200);
    expect(mockedSendOtpEmail).toHaveBeenCalledTimes(1);

    // The mock captures the exact code auth.service.ts generated — the real
    // email is never sent in tests, so this is the only way to get it.
    const code = mockedSendOtpEmail.mock.calls[0][1];

    const verifyRes = await request(app).post('/api/auth/verify-otp').send({ email, code, inviteToken });
    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.token).toBeTruthy();
    expect(verifyRes.body.user).toMatchObject({ username, email, role: 'USER' });

    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();

    const meRes = await request(app).get('/api/auth/me').set(authHeader(loginRes.body.token));
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ username, email });
  });

  it('rejects verify-otp with a wrong code', async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();

    const inviteToken = await invitationFor(email);
    await request(app).post('/api/auth/signup-request').send({ username, email, password: 'Password123!', inviteToken });

    const res = await request(app).post('/api/auth/verify-otp').send({ email, code: '000000', inviteToken });
    expect(res.status).toBe(400);
  });

  it('rejects signup-request for an already-registered email', async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    const password = 'Password123!';

    const inviteToken = await invitationFor(email);
    await request(app).post('/api/auth/signup-request').send({ username, email, password, inviteToken });
    const code = mockedSendOtpEmail.mock.calls[0][1];
    await request(app).post('/api/auth/verify-otp').send({ email, code, inviteToken });

    // A fresh, live invitation: the registered address itself is what is refused.
    const secondAttempt = await request(app)
      .post('/api/auth/signup-request')
      .send({ username: uniqueUsername(), email, password, inviteToken: await invitationFor(email) });
    expect(secondAttempt.status).toBe(400);
    // The first invitation was accepted by that sign-up and opens no second account.
    expect((await request(app).post('/api/auth/signup-request').send({ username: uniqueUsername(), email, password, inviteToken })).status).toBe(400);
  });
});

describe('direct signup (no OTP)', () => {
  it('creates an account and issues a working token with no email round-trip', async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    const password = 'Password123!';

    const inviteToken = await invitationFor(email);
    const res = await request(app).post('/api/auth/signup').send({ username, email, password, inviteToken });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ username, email, role: 'USER' });
    expect(mockedSendOtpEmail).not.toHaveBeenCalled();

    const meRes = await request(app).get('/api/auth/me').set(authHeader(res.body.token));
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ username, email });

    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
  });

  it('rejects a duplicate email the same as the OTP path does', async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    const password = 'Password123!';

    const inviteToken = await invitationFor(email);
    await request(app).post('/api/auth/signup').send({ username, email, password, inviteToken });
    // A fresh, live invitation: the registered address itself is what is refused.
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: uniqueUsername(), email, password, inviteToken: await invitationFor(email) });
    expect(res.status).toBe(400);
    // The first invitation was accepted by that sign-up and opens no second account.
    expect((await request(app).post('/api/auth/signup').send({ username: uniqueUsername(), email, password, inviteToken })).status).toBe(400);
  });

  it('rejects a too-short password', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: uniqueUsername(), email, password: '123', inviteToken: await invitationFor(email) });
    expect(res.status).toBe(400);
  });
});

describe('login', () => {
  it('rejects an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: uniqueEmail(), password: 'whatever123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set(authHeader('not-a-real-token'));
    // T.32 (audit H1): every authentication failure is 401 (was 403) — the
    // client's single "session over" signal; 403 means "signed in, not allowed".
    expect(res.status).toBe(401);
  });
});
