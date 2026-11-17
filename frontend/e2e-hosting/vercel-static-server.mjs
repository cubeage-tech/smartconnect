/**
 * Local stand-in for Vercel's static hosting, used only by the e2e-hosting
 * suite (playwright.hosting.config.ts). It serves a production build the way
 * Vercel serves a static deployment, applying frontend/vercel.json:
 *
 *   1. a path that names a file in the build is served as that file
 *      ("/" is index.html) — the filesystem always wins;
 *   2. otherwise the first rewrite whose source matches the path is served;
 *   3. otherwise 404 with Vercel's "NOT_FOUND" answer;
 *
 * and every header rule whose source matches the path is added. Sources are
 * compiled as anchored regular expressions, which is how Vercel compiles the
 * plain regex-group sources this project uses (no :named segments — refused
 * here so a future change cannot be silently mis-emulated).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = resolve(process.env.HOSTING_DIST ?? join(frontendRoot, 'dist'));
const port = Number(process.env.HOSTING_PORT ?? 4190);
const config = JSON.parse(await readFile(join(frontendRoot, 'vercel.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const compile = (source) => {
  if (/\/:/.test(source)) throw new Error(`vercel-static-server: named segments are not emulated (${source})`);
  return new RegExp(`^${source}$`);
};
const rewrites = (config.rewrites ?? []).map((rule) => ({ test: compile(rule.source), destination: rule.destination }));
const headerRules = (config.headers ?? []).map((rule) => ({ test: compile(rule.source), headers: rule.headers }));

const fileFor = async (pathname) => {
  const full = normalize(join(dist, pathname === '/' ? '/index.html' : pathname));
  if (!full.startsWith(dist + sep)) return null; // never outside the build
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
};

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  for (const rule of headerRules) if (rule.test.test(pathname)) for (const { key, value } of rule.headers) res.setHeader(key, value);

  let file = await fileFor(pathname);
  if (!file) {
    const rewrite = rewrites.find((rule) => rule.test.test(pathname));
    if (rewrite) file = await fileFor(rewrite.destination);
  }
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Vercel-Error': 'NOT_FOUND' }).end('404: NOT_FOUND');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
}).listen(port, '127.0.0.1', () => console.log(`vercel-static-server: ${dist} on http://127.0.0.1:${port}`));
