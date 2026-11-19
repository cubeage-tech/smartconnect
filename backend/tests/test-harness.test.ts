import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';

// No test ever sends real e-mail: tests/setup.ts clears the e-mail settings
// (whatever backend/.env holds), and refuses any request to the real Brevo
// API. A test that needs "configured" sets a fake key and replaces the
// transport (the mailer, or fetch) itself.
describe('test environment: no real e-mail', () => {
  it('starts every test file with the Brevo settings empty', () => {
    expect(process.env.BREVO_API_KEY).toBe('');
    expect(process.env.BREVO_FROM_EMAIL).toBe('');
    expect(process.env.BREVO_FROM_NAME).toBe('');
  });

  it('refuses any request to the real Brevo API, even from a test that sets a key', async () => {
    await expect(fetch('https://api.brevo.com/v3/account')).rejects.toThrow(/real Brevo API/);
  });
});

/**
 * Regression test for the test harness itself (found during Sub-batch C).
 *
 * macOS hands out ephemeral ports sequentially, and supertest's
 * `request(app)` listens on the wildcard address (`listen(0)`) but connects to
 * 127.0.0.1. A wildcard listener may be given a port another local process
 * (IDE helpers, databases) already holds on 127.0.0.1 — the request then
 * reaches that process: random 401 / 404 / "Parse Error: Expected HTTP/"
 * failures in unrelated tests. tests/setup.ts binds those servers to
 * 127.0.0.1, where the kernel refuses duplicates.
 *
 * Here, "foreign" loopback listeners are placed just ahead of the allocation
 * cursor; every request must still be answered by the app. (On platforms with
 * randomized port allocation this simply passes.)
 */
describe('test harness', () => {
  const foreign: Server[] = [];
  afterAll(() => Promise.all(foreign.map((s) => new Promise((resolve) => s.close(resolve)))));

  const freePort = async (host?: string) => {
    const probe = createServer();
    await new Promise<void>((resolve) => (host ? probe.listen(0, host, resolve) : probe.listen({ port: 0 }, resolve)));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  };

  it('supertest requests are never answered by another loopback listener', async () => {
    const cursor = Math.min(await freePort(), await freePort('127.0.0.1'));
    for (let port = cursor + 1; foreign.length < 40 && port < 65535; port++) {
      const server = createServer((_req, res) => {
        res.writeHead(418);
        res.end('foreign');
      });
      const bound = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (bound) foreign.push(server);
    }

    for (let i = 0; i < 80; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status, `request ${i} was answered by a foreign listener`).toBe(200);
    }
  });
});
