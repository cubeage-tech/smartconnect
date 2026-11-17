import { describe, expect, it } from 'vitest';
import repoRootVercelConfig from '../../../vercel.json';
import vercelConfig from '../../vercel.json';
import routerSource from './router.tsx?raw';

/**
 * Production hosting (Vercel) for the single-page app.
 *
 * Vercel serves the build output as static files and answers 404 NOT_FOUND
 * for any path that is not a file, unless vercel.json rewrites it to
 * index.html. The Vite dev and preview servers fall back to index.html on
 * their own, so the component and E2E suites could never notice: opening or
 * reloading any deep link (/login, /activate#token=…, /invite/…, /admin,
 * /<workspace>/…) 404'd in production.
 *
 * Vercel reads vercel.json from the project's Root Directory only, so the
 * same file sits at both places that can be: frontend/ (the Vite app) and the
 * repository root. They must stay identical.
 *
 * Vercel checks the filesystem first and applies rewrites only to paths that
 * are not files. The sources used here are plain regular-expression groups
 * (no :named or wildcard segments), which match a request path exactly as an
 * anchored RegExp does. Query strings and #fragments never take part in
 * matching (a fragment is not even sent to the server). A real-server check
 * of the built app lives in e2e-hosting/ (npm run test:hosting).
 */

type Rewrite = { source: string; destination: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const config = vercelConfig as { rewrites?: Rewrite[]; headers?: HeaderRule[] };

const matches = (source: string, path: string) => {
  expect(source, 'emulation covers regex-group sources only').not.toMatch(/\/:/);
  return new RegExp(`^${source}$`).test(path);
};
const rewriteOf = (path: string) => config.rewrites?.find((rule) => matches(rule.source, path))?.destination ?? null;
const headersOf = (path: string) =>
  Object.fromEntries(
    (config.headers ?? []).filter((rule) => matches(rule.source, path)).flatMap((rule) => rule.headers.map(({ key, value }) => [key.toLowerCase(), value]))
  );

/** Every route in router.tsx as a concrete request path (children live under /:workspaceId). */
const routerPaths = [...routerSource.matchAll(/path:\s*'([^']+)'/g)]
  .map(([, path]) => (path === '*' ? '/no/such/page' : path.startsWith('/') ? path : `/:workspaceId/${path}`))
  .map((path) => path.replace(/:[A-Za-z]+/g, '3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70'));

/** The links the backend builds from APP_URL, as the host sees them (path only). */
const emailedAndSharedLinks = [
  '/activate', // teamLeads.service activationUrl: /activate#token=…
  '/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70', // invitations.service: /invite/<uuid>
  '/reset-password', // auth.service: /reset-password?token=…&id=…
  '/join-workspace', // invitations.service: /join-workspace?token=…
];

describe('Vercel hosting: one configuration for either Root Directory', () => {
  it('the repository-root vercel.json is identical to frontend/vercel.json', () => {
    expect(repoRootVercelConfig).toEqual(vercelConfig);
  });
});

describe('Vercel hosting: single-page app routing', () => {
  it('finds the routes it is checking', () => {
    expect(routerPaths).toEqual(expect.arrayContaining(['/login', '/activate', '/reset-password', '/join-workspace', '/admin']));
    expect(routerPaths.length).toBeGreaterThanOrEqual(25);
  });

  it.each(emailedAndSharedLinks)('serves the app for the emailed/shared link %s', (path) => {
    expect(rewriteOf(path)).toBe('/index.html');
  });

  it('serves the app for every client-side route, so deep links and reloads never 404', () => {
    const unserved = routerPaths.filter((path) => rewriteOf(path) !== '/index.html');
    expect(unserved).toEqual([]);
  });

  it.each(['/dashboard', '/admin/users', '/channels', '/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70', '/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70/c/general', '/'])(
    'serves the app for %s (unknown paths too: the router redirects them itself)',
    (path) => {
      expect(rewriteOf(path)).toBe('/index.html');
    }
  );

  it.each(['/assets/index-0ld-chunk.js', '/assets/ActivateAccountPage-x1y2z3.js', '/assets/', '/assets/no-extension', '/icons/missing.png', '/favicon-old.ico', '/robots.txt', '/admin/report.csv'])(
    'never answers a missing file (%s) with the HTML page: it stays a 404',
    (path) => {
      expect(rewriteOf(path)).toBeNull();
    }
  );
});

describe('Vercel hosting: security headers (same as render.yaml, T.32)', () => {
  it.each(['/', '/activate', '/reset-password', '/invite/sample-id', '/assets/index-abc.js'])('sends the baseline headers on %s', (path) => {
    expect(headersOf(path)).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
  });

  it('keeps camera, microphone and screen sharing available to the app itself (calls), and nothing else', () => {
    expect(headersOf('/')['permissions-policy']).toBe('camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()');
  });
});
