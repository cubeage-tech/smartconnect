import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corsOrigins, DEV_APP_URL, LOCAL_DEV_ORIGINS, normalizeAppUrl, trustProxySetting } from '../config/deployment';

/**
 * Render deployment settings (config/deployment.ts) and e-mail: the mailer
 * (utils/mailer.ts) over Brevo's transactional HTTP API, and its settings
 * (lib/emailDelivery.ts). Pure unit tests: no database, no app import and no
 * network — every Brevo answer here is a stub.
 */

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const TEST_KEY = 'xkeysib-test-not-a-real-key';
const SENDER = 'no-reply@verified.example';

interface BrevoBody {
  sender: { name: string; email: string };
  to: { email: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
}
/** Every request made to the stubbed Brevo API. */
const requests: { url: string; method?: string; headers: Record<string, string>; body: BrevoBody }[] = [];
/** The same messages, in the shape the template tests read. */
const sent: Array<Record<string, string>> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ACCEPTED = () => json(201, { messageId: '<test-message@smtp-relay.mailin.fr>' });

/** Replaces fetch: records each request and answers with `respond` (default: 201, accepted). */
const stubBrevo = (respond: (init: RequestInit) => Response | Promise<Response> = ACCEPTED) => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as BrevoBody;
    requests.push({ url: String(input), method: init.method, headers: init.headers as Record<string, string>, body });
    sent.push({
      from: `${body.sender.name} <${body.sender.email}>`,
      to: body.to.map((r) => r.email).join(','),
      subject: body.subject,
      html: body.htmlContent,
      text: body.textContent ?? '',
    });
    return respond(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const EMAIL_ENV = ['BREVO_API_KEY', 'BREVO_FROM_EMAIL', 'BREVO_FROM_NAME', 'NODE_ENV'] as const;
const savedEnv = Object.fromEntries(EMAIL_ENV.map((name) => [name, process.env[name]]));
const restoreEnv = () => {
  for (const name of EMAIL_ENV) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};
/** Sets the Brevo settings; `null` removes one. */
const configure = (key: string | null = TEST_KEY, from: string | null = SENDER, name: string | null = null) => {
  for (const [variable, value] of [['BREVO_API_KEY', key], ['BREVO_FROM_EMAIL', from], ['BREVO_FROM_NAME', name]] as const) {
    if (value === null) delete process.env[variable];
    else process.env[variable] = value;
  }
};
const resetEmail = () => {
  requests.length = 0;
  sent.length = 0;
  configure();
};
const restoreEmail = () => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
};

describe('APP_URL normalisation', () => {
  it('accepts absolute http(s) URLs, trimming whitespace and trailing slashes', () => {
    expect(normalizeAppUrl('https://smartconnect-frontend.onrender.com')).toBe('https://smartconnect-frontend.onrender.com');
    expect(normalizeAppUrl('  https://smartconnect-frontend.onrender.com//  ')).toBe('https://smartconnect-frontend.onrender.com');
    expect(normalizeAppUrl('http://localhost:5174/')).toBe('http://localhost:5174');
  });

  it('rejects missing, relative and non-http values', () => {
    for (const value of [undefined, '', '   ', 'smartconnect-frontend.onrender.com', '/app', 'ftp://example.com', 'javascript:alert(1)']) {
      expect(normalizeAppUrl(value)).toBeNull();
    }
  });

  it('defaults locally to the Vite dev server origin', () => {
    expect(DEV_APP_URL).toBe('http://localhost:5174');
  });
});

describe('CORS origins', () => {
  const appUrl = 'https://smartconnect-frontend.onrender.com';

  it('production allows only APP_URL — never a localhost origin', () => {
    expect(corsOrigins('production', appUrl)).toEqual([appUrl]);
  });

  it('outside production also allows the local dev origins (Vite dev 5174/5173, preview 4173), without duplicates', () => {
    const origins = corsOrigins('development', 'http://localhost:5174');
    expect(origins[0]).toBe('http://localhost:5174');
    for (const origin of ['http://localhost:5174', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5174']) {
      expect(origins).toContain(origin);
    }
    expect(new Set(origins).size).toBe(origins.length);
    expect(corsOrigins('test', appUrl)).toEqual([appUrl, ...LOCAL_DEV_ORIGINS]);
  });
});

describe('Express trust proxy', () => {
  it('trusts exactly one hop (Render\'s load balancer) in production and nothing elsewhere', () => {
    expect(trustProxySetting('production', undefined)).toBe(1);
    expect(trustProxySetting('production', '')).toBe(1);
    expect(trustProxySetting('development', undefined)).toBe(false);
    expect(trustProxySetting('test', undefined)).toBe(false);
  });

  it('TRUST_PROXY overrides it with a hop count, a boolean or an Express trust value', () => {
    expect(trustProxySetting('production', '2')).toBe(2);
    expect(trustProxySetting('production', 'false')).toBe(false);
    expect(trustProxySetting('development', 'true')).toBe(true);
    expect(trustProxySetting('production', 'loopback')).toBe('loopback');
  });
});

describe('e-mail branding', () => {
  beforeEach(() => {
    resetEmail();
    stubBrevo();
  });
  afterEach(restoreEmail);

  it('every e-mail is SmartConnect-branded and comes from BREVO_FROM_EMAIL (no invented domain)', async () => {
    const { sendInviteEmail, sendOtpEmail, sendResetPasswordEmail } = await import('../utils/mailer');
    await sendInviteEmail('a@example.com', 'https://app.example/invite/x', 'Design');
    await sendOtpEmail('a@example.com', '123456');
    await sendResetPasswordEmail('a@example.com', 'https://app.example/reset-password?token=t&id=i');
    expect(sent).toHaveLength(3);
    for (const message of sent) {
      expect(message.from).toBe(`SmartConnect <${SENDER}>`);
      expect(`${message.subject} ${message.html}`).not.toContain('Slick');
    }
    expect(sent.map((m) => m.subject)).toEqual([
      "You've been invited to join Design on SmartConnect",
      '123456 is your SmartConnect verification code',
      'Password Reset Request - SmartConnect',
    ]);
  });

  it('BREVO_FROM_NAME names the sender; every setting is trimmed', async () => {
    configure(`  ${TEST_KEY}  `, `  ${SENDER}  `, '  SmartConnect Team  ');
    const { sendResetPasswordEmail } = await import('../utils/mailer');
    await sendResetPasswordEmail('a@example.com', 'https://app.example/reset-password?token=t&id=i');
    expect(requests[0].body.sender).toEqual({ name: 'SmartConnect Team', email: SENDER });
    expect(requests[0].headers['api-key']).toBe(TEST_KEY);
  });
});

describe('e-mail configuration: Brevo needs BREVO_API_KEY and BREVO_FROM_EMAIL', () => {
  afterEach(restoreEmail);

  it('in every environment both are required (Brevo has no shared test sender); BREVO_FROM_NAME is optional', async () => {
    const { emailDeliveryConfigured, missingEmailSettings } = await import('../lib/emailDelivery');
    for (const env of ['production', 'development', 'test']) {
      process.env.NODE_ENV = env;
      configure(TEST_KEY, SENDER);
      expect(emailDeliveryConfigured()).toBe(true);
      expect(missingEmailSettings()).toEqual([]);
      configure(null, SENDER);
      expect(emailDeliveryConfigured()).toBe(false);
      expect(missingEmailSettings()).toEqual(['BREVO_API_KEY']);
      configure(TEST_KEY, null);
      expect(emailDeliveryConfigured()).toBe(false);
      expect(missingEmailSettings()).toEqual(['BREVO_FROM_EMAIL']);
      configure('   ', '   ', '   ');
      expect(emailDeliveryConfigured()).toBe(false);
      expect(missingEmailSettings()).toEqual(['BREVO_API_KEY', 'BREVO_FROM_EMAIL']);
    }
  });

  it('BREVO_FROM_EMAIL must be a plain address (the name has its own setting) — otherwise e-mail is reported as not configured, never "sent"', async () => {
    const { emailDeliveryConfigured, missingEmailSettings } = await import('../lib/emailDelivery');
    for (const invalid of ['SmartConnect <no-reply@verified.example>', 'no-reply', 'no reply@verified.example']) {
      configure(TEST_KEY, invalid);
      expect(emailDeliveryConfigured()).toBe(false);
      expect(missingEmailSettings()).toEqual(['BREVO_FROM_EMAIL']);
    }
  });

  it('names what is missing — never a value', async () => {
    const { missingEmailSettings } = await import('../lib/emailDelivery');
    configure(null, 'not-an-address-but-maybe-private');
    expect(missingEmailSettings().join(' ')).not.toContain('not-an-address');
  });
});

describe('Brevo transactional e-mail API', () => {
  beforeEach(resetEmail);
  afterEach(restoreEmail);

  const account = {
    to: 'mia@example.com',
    loginId: 'mia@example.com',
    temporaryPassword: 'Kp7Qm-3xTzR-hW9aB-c4NvE',
    activationUrl: 'https://app.example/activate#token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
    expiresAt: new Date('2026-12-01T10:00:00Z'),
    role: 'MEMBER' as const,
    workspaceName: 'Design',
  };
  const inviteLink = 'https://app.example/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70';
  const spyLogs = () => [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
  const logged = (spies: ReturnType<typeof spyLogs>) => spies.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');

  it('POSTs over HTTPS to /v3/smtp/email with the api-key header and the JSON body Brevo expects', async () => {
    stubBrevo();
    const { sendAccountInvitationEmail } = await import('../utils/mailer');
    await sendAccountInvitationEmail(account);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe(BREVO_URL);
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'api-key': TEST_KEY });
    expect(req.body).toEqual({
      sender: { name: 'SmartConnect', email: SENDER },
      to: [{ email: 'mia@example.com' }],
      subject: "You've been invited to Design on SmartConnect",
      htmlContent: expect.stringContaining(`href="${account.activationUrl}"`),
      textContent: expect.stringContaining(`Temporary password: ${account.temporaryPassword}`),
    });
  });

  it("returns Brevo's message id for a sent invitation — the only thing logged", async () => {
    const logs = spyLogs();
    stubBrevo();
    const { sendInviteEmail } = await import('../utils/mailer');
    await expect(sendInviteEmail('sam@example.com', inviteLink, 'Design')).resolves.toEqual({
      success: true,
      messageId: '<test-message@smtp-relay.mailin.fr>',
    });
    expect(logged(logs)).not.toContain('3f1c2a9e');
    expect(logged(logs)).not.toContain(TEST_KEY);
  });

  it('not configured: nothing is sent, and each e-mail keeps its existing answer', async () => {
    configure(null, SENDER);
    const fetchMock = stubBrevo();
    const { sendAccountInvitationEmail, sendInviteEmail, sendOtpEmail, sendResetPasswordEmail } = await import('../utils/mailer');
    await expect(sendInviteEmail('sam@example.com', inviteLink, 'Design')).resolves.toEqual({ success: false, message: 'Email service not configured' });
    await expect(sendResetPasswordEmail('sam@example.com', 'https://app.example/reset-password?token=t&id=i')).resolves.toBeUndefined();
    await expect(sendAccountInvitationEmail(account)).rejects.toThrow('Email service is not configured.');
    await expect(sendOtpEmail('sam@example.com', '123456')).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an API error fails the send with the HTTP status and Brevo's reason — and logs no key, password or token", async () => {
    const logs = spyLogs();
    stubBrevo(() => json(401, { code: 'unauthorized', message: 'Key not found' }));
    const { sendAccountInvitationEmail, sendInviteEmail } = await import('../utils/mailer');
    await expect(sendAccountInvitationEmail(account)).rejects.toThrow(
      'Failed to send the account invitation email: Brevo API error (HTTP 401 unauthorized): Key not found'
    );
    await expect(sendInviteEmail('sam@example.com', inviteLink, 'Design')).rejects.toThrow(
      'Failed to send invitation email: Brevo API error (HTTP 401 unauthorized): Key not found'
    );
    const text = logged(logs);
    expect(text).toContain('HTTP 401');
    for (const secret of [TEST_KEY, account.temporaryPassword, 'AbCdEfGhIjKlMnOpQrStUvWxYz', '3f1c2a9e']) expect(text).not.toContain(secret);
  });

  it('an error message that echoes the API key never repeats it', async () => {
    stubBrevo(() => json(400, { code: 'invalid_parameter', message: `api-key ${TEST_KEY} is malformed` }));
    const { sendResetPasswordEmail } = await import('../utils/mailer');
    const error = await sendResetPasswordEmail('a@example.com', 'https://app.example/reset-password?token=t&id=i').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 400 invalid_parameter');
    expect((error as Error).message).not.toContain(TEST_KEY);
  });

  it('a non-JSON error page still fails with its HTTP status', async () => {
    stubBrevo(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const { sendOtpEmail } = await import('../utils/mailer');
    await expect(sendOtpEmail('a@example.com', '123456')).rejects.toThrow('Failed to send verification email: Brevo API error (HTTP 502)');
  });

  it('times out: a request Brevo never answers is aborted after BREVO_TIMEOUT_MS and reported as failed', async () => {
    vi.useFakeTimers();
    stubBrevo(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        })
    );
    const { BREVO_TIMEOUT_MS, sendInviteEmail } = await import('../utils/mailer');
    expect(BREVO_TIMEOUT_MS).toBe(10_000);
    let settled = false;
    const pending = sendInviteEmail('sam@example.com', inviteLink, 'Design');
    pending.catch(() => undefined).finally(() => (settled = true));
    const failed = expect(pending).rejects.toThrow('Failed to send invitation email: Brevo did not respond within 10 s');
    await vi.advanceTimersByTimeAsync(BREVO_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
  });

  it('a network failure is reported as failed, with the cause code only', async () => {
    stubBrevo(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })));
    const { sendAccountInvitationEmail } = await import('../utils/mailer');
    await expect(sendAccountInvitationEmail(account)).rejects.toThrow(
      'Failed to send the account invitation email: Could not reach Brevo (ECONNRESET)'
    );
  });
});

describe('onboarding e-mails', () => {
  beforeEach(() => {
    resetEmail();
    stubBrevo();
  });
  afterEach(restoreEmail);

  const account = {
    to: 'mia@example.com',
    loginId: 'mia@example.com',
    temporaryPassword: 'Kp7Qm-3xTzR-hW9aB-c4NvE',
    activationUrl: 'https://app.example/activate#token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
    expiresAt: new Date('2026-12-01T10:00:00Z'),
  };

  it('a new Member gets the workspace, their login, the temporary password and the activation link — and nothing is logged', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const { sendAccountInvitationEmail } = await import('../utils/mailer');
    await sendAccountInvitationEmail({ ...account, role: 'MEMBER', workspaceName: 'SmartUnifolio' });
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message.to).toBe('mia@example.com');
    expect(message.subject).toBe("You've been invited to SmartUnifolio on SmartConnect");
    for (const part of ['SmartUnifolio', account.loginId, account.temporaryPassword, `href="${account.activationUrl}"`]) expect(message.html).toContain(part);
    expect(message.text).toContain(account.temporaryPassword);
    const logged = logs.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
    expect(logged).not.toContain(account.temporaryPassword);
    expect(logged).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('a new Team Lead gets an activation e-mail naming the role', async () => {
    const { sendAccountInvitationEmail } = await import('../utils/mailer');
    await sendAccountInvitationEmail({ ...account, role: 'TEAM_LEAD', workspaceName: null });
    expect(sent[0].subject).toBe('Activate your SmartConnect Team Lead account');
    expect(sent[0].html).toContain('Team Lead');
    expect(sent[0].html).toContain(account.temporaryPassword);
  });

  it('names come from users, so every e-mail escapes them', async () => {
    const { sendAccountInvitationEmail, sendInviteEmail } = await import('../utils/mailer');
    const hostile = 'Design <a href="https://evil.example">click</a> & "Co"';
    await sendAccountInvitationEmail({ ...account, role: 'MEMBER', workspaceName: hostile });
    await sendInviteEmail('sam@example.com', 'https://app.example/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70', hostile);
    for (const message of sent) {
      expect(message.html).not.toContain('<a href="https://evil.example">');
      expect(message.html).toContain('Design &lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt; &amp; &quot;Co&quot;');
    }
  });

  it('a workspace invitation (existing or new account) names the workspace and the invited address — never a password', async () => {
    const { sendInviteEmail } = await import('../utils/mailer');
    const link = 'https://app.example/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70';
    await sendInviteEmail('sam@example.com', link, 'Project Alpha');
    expect(sent[0].subject).toBe("You've been invited to join Project Alpha on SmartConnect");
    for (const part of ['Project Alpha', 'sam@example.com', `href="${link}"`]) expect(sent[0].html).toContain(part);
    expect(sent[0].html).not.toMatch(/password/i);
  });
});
