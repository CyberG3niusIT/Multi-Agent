/**
 * Cloud Run / local Hono server for dossier.ruv.io.
 *
 * Mirrors v3/goal_ui/functions/server.ts security stack (ADR-094):
 *   1. CORS allowlist via RUFLO_ALLOWED_ORIGINS (defaults include
 *      dossier.ruv.io + localhost:5183 / :8080).
 *   2. Token check — X-RuFlo-Token header MUST equal
 *      RUFLO_FUNCTIONS_TOKEN. Default `dev-token-change-me` for local
 *      dev; production deploys MUST override via Secret Manager.
 *   3. Per-IP token-bucket rate limit — 60 req/min default,
 *      configurable via RUFLO_RATE_LIMIT_PER_MIN.
 *
 * Routes (v1):
 *   GET  /healthz               — health check
 *   GET  /functions/v1/dossiers — list dossier index
 *   GET  /functions/v1/dossiers/:slug — fetch a dossier JSON
 *   GET  /*                     — SPA serve (dist/index.html fallback)
 *
 * In v1 the dossier endpoints just read from `public/dossiers/`
 * (synced at build by scripts/sync-dossiers.mjs). v2 will add
 * server-side recursive expansion via @ruflo/research's research-step.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? process.env.FUNCTIONS_PORT ?? '8787');

const ALLOWED_ORIGINS = (
  process.env.RUFLO_ALLOWED_ORIGINS ??
  'http://localhost:5183,http://localhost:8080,https://dossier.ruv.io,https://goal.ruv.io'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SERVER_TOKEN = process.env.RUFLO_FUNCTIONS_TOKEN ?? 'dev-token-change-me';
const RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.RUFLO_RATE_LIMIT_PER_MIN ?? '60'));
const RATE_WINDOW_MS = 60_000;

const buckets = new Map<string, { tokens: number; refilledAt: number }>();

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim().split(':')[0] || 'unknown';
  return c.req.header('x-real-ip') || 'unknown';
}

function takeToken(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: RATE_LIMIT_PER_MIN, refilledAt: now };
    buckets.set(ip, b);
  }
  const elapsed = now - b.refilledAt;
  if (elapsed > 0) {
    const refill = (elapsed / RATE_WINDOW_MS) * RATE_LIMIT_PER_MIN;
    b.tokens = Math.min(RATE_LIMIT_PER_MIN, b.tokens + refill);
    b.refilledAt = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const app = new Hono();

app.use('*', cors({
  origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ''),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-RuFlo-Token'],
  maxAge: 600,
}));

app.get('/healthz', (c) => c.json({ ok: true, service: 'ruflo-dossier-fns', allowedOrigins: ALLOWED_ORIGINS.length }));

// Function endpoints — token + rate-limit gated
app.use('/functions/v1/*', async (c, next) => {
  const token = c.req.header('x-ruflo-token');
  if (token !== SERVER_TOKEN) return c.json({ error: 'unauthorized' }, 401);
  const ip = clientIp(c);
  if (!takeToken(ip)) return c.json({ error: 'rate_limited' }, 429);
  await next();
});

app.get('/functions/v1/dossiers', async (c) => {
  const dossiersDir = resolve(process.cwd(), 'dist', 'dossiers');
  const fallback = resolve(process.cwd(), 'public', 'dossiers');
  const dir = existsSync(dossiersDir) ? dossiersDir : fallback;
  const indexPath = resolve(dir, 'index.json');
  if (!existsSync(indexPath)) return c.json({ dossiers: [] });
  const { readFile } = await import('node:fs/promises');
  const json = await readFile(indexPath, 'utf-8');
  return c.body(json, 200, { 'Content-Type': 'application/json' });
});

app.get('/functions/v1/dossiers/:slug', async (c) => {
  const slug = c.req.param('slug').replace(/[^a-z0-9-]/gi, '');
  if (!slug) return c.json({ error: 'invalid_slug' }, 400);
  const dossiersDir = resolve(process.cwd(), 'dist', 'dossiers');
  const fallback = resolve(process.cwd(), 'public', 'dossiers');
  const dir = existsSync(dossiersDir) ? dossiersDir : fallback;
  const file = resolve(dir, slug, `${slug}.json`);
  if (!existsSync(file)) return c.json({ error: 'not_found' }, 404);
  const { readFile } = await import('node:fs/promises');
  const json = await readFile(file, 'utf-8');
  return c.body(json, 200, { 'Content-Type': 'application/json' });
});

// SPA serve (Cloud Run combined-deploy mode)
const DIST_DIR = resolve(process.cwd(), 'dist');
if (existsSync(DIST_DIR)) {
  app.get('/*', serveStatic({ root: './dist' }));
  app.notFound((c) => {
    const indexHtml = resolve(DIST_DIR, 'index.html');
    if (existsSync(indexHtml)) {
      return c.html(require('node:fs').readFileSync(indexHtml, 'utf-8'));
    }
    return c.text('not found', 404);
  });
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`[dossier-fns] listening on :${info.port}`);
  console.log(`[dossier-fns] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[dossier-fns] token: ${SERVER_TOKEN === 'dev-token-change-me' ? '⚠️  default dev token' : '✓ configured'}`);
});
