import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AccountTier, Role } from '@prisma/client';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { resetEmailDeliveryHealth } from '../lib/emailDelivery';

// Random per-call identifiers instead of table truncation between tests —
// simplest way to keep every test's data isolated when the whole suite
// shares one database.
export const uniqueEmail = () => `test-${randomUUID()}@example.com`;
export const uniqueUsername = () => `user_${randomUUID().slice(0, 8)}`;

/**
 * Creates a user directly via Prisma (bypassing the OTP signup flow) and
 * logs them in through the real POST /api/auth/login endpoint, so tests that
 * only care about "an authenticated user" don't each need to drive the full
 * signup-request/verify-otp dance themselves.
 */
export const createAndLoginUser = async (overrides: { role?: Role } = {}) => {
  const email = uniqueEmail();
  const username = uniqueUsername();
  const password = 'Password123!';

  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: await bcrypt.hash(password, 12),
      role: overrides.role ?? 'USER',
    },
  });

  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Test helper login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { user, token: res.body.token as string };
};

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Stage 1: sets an account's company tier directly in the database — what the
 * reviewed backfill or a Company Admin grant will do. No row = MEMBER.
 */
export const grantTier = (userId: string, tier: AccountTier = 'TEAM_LEAD') =>
  prisma.accountTierGrant.upsert({ where: { userId }, update: { tier }, create: { userId, tier } });

/** A logged-in Team Lead (an ordinary USER account holding the TEAM_LEAD tier). */
export const createTeamLead = async () => {
  const lead = await createAndLoginUser();
  await grantTier(lead.user.id, 'TEAM_LEAD');
  return lead;
};

/**
 * QA C2: forgot-password answers 503 when no e-mail can be sent. Tests that
 * replace utils/mailer with a mock and exercise the reset flow switch on FAKE
 * Brevo settings around the calls (nothing is sent: the mailer is mocked, and
 * tests/setup.ts refuses any request to the real Brevo API).
 */
export const withFakeEmailSettings = async <T>(fn: () => Promise<T>): Promise<T> => {
  process.env.BREVO_API_KEY = 'test-brevo-key-not-real';
  process.env.BREVO_FROM_EMAIL = 'noreply@example.test';
  resetEmailDeliveryHealth();
  try {
    return await fn();
  } finally {
    process.env.BREVO_API_KEY = '';
    process.env.BREVO_FROM_EMAIL = '';
    resetEmailDeliveryHealth();
  }
};
