/**
 * Local Hono dev server mounting all `functions/<name>` handlers.
 *
 * `npm run functions:dev` runs this on port 8787.
 * Production replaces this with one-GCF-per-handler deployment.
 *
 * URL shape matches Supabase's edge functions: `/functions/v1/<name>`
 * — keeps the migration window painless (callsites can switch base
 * URL without changing the path).
 *
 * Security middleware (Step 22b will harden):
 *   - CORS allowlist via `RUFLO_ALLOWED_ORIGINS` (comma-separated;
 *     defaults to localhost:8080 + goal.ruv.io)
 *   - Optional `X-RuFlo-Token` header validation against
 *     `RUFLO_FUNCTIONS_TOKEN` (server-side); skipped if env unset
 *     so local dev works out of the box.
 *   - Rate limiting deferred to Step 22b.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { generateResearchGoalHandler } from './generate-research-goal/handler';
import { researchStepHandler } from './research-step/handler';
import { generateActionItemsHandler } from './generate-action-items/handler';
import { optimizeResearchConfigHandler } from './optimize-research-config/handler';

const PORT = Number(process.env.FUNCTIONS_PORT ?? '8787');

const ALLOWED_ORIGINS = (
  process.env.RUFLO_ALLOWED_ORIGINS ?? 'http://localhost:8080,https://goal.ruv.io'
).split(',').map((s) => s.trim()).filter(Boolean);

const SERVER_TOKEN = process.env.RUFLO_FUNCTIONS_TOKEN ?? '';

const app = new Hono();

app.use('*', cors({
  origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ''),
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-RuFlo-Token'],
}));

// Optional token check. If RUFLO_FUNCTIONS_TOKEN is unset (default in
// local dev), skip — keeps `npm run functions:dev` working without a
// .env. Production deploys MUST set the token.
app.use('/functions/v1/*', async (c, next) => {
  if (SERVER_TOKEN) {
    const incoming = c.req.header('X-RuFlo-Token') ?? '';
    if (incoming !== SERVER_TOKEN) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }
  await next();
});

app.get('/', (c) => c.text(
  'RuFlo functions dev server — endpoints:\n' +
  '  POST /functions/v1/generate-research-goal\n' +
  '  POST /functions/v1/research-step\n' +
  '  POST /functions/v1/generate-action-items\n' +
  '  POST /functions/v1/optimize-research-config\n',
));

app.post('/functions/v1/generate-research-goal', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await generateResearchGoalHandler({
    category: typeof body?.category === 'string' ? body.category : '',
    customContext: typeof body?.customContext === 'string' ? body.customContext : undefined,
  });
  return c.json(result.body, { status: result.status as 200 | 400 | 402 | 429 | 500 | 502 });
});

app.post('/functions/v1/research-step', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await researchStepHandler({
    goal: typeof body.goal === 'string' ? body.goal : '',
    stepTitle: typeof body.stepTitle === 'string' ? body.stepTitle : '',
    stepDescription: typeof body.stepDescription === 'string' ? body.stepDescription : '',
    stepType: typeof body.stepType === 'string' ? body.stepType : '',
    aiModel: typeof body.aiModel === 'string' ? body.aiModel : undefined,
    config: body.config,
    previousStepsData: Array.isArray(body.previousStepsData) ? body.previousStepsData as never : undefined,
  });
  return c.json(result.body, { status: result.status as 200 | 400 | 402 | 429 | 500 | 502 });
});

app.post('/functions/v1/generate-action-items', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await generateActionItemsHandler({
    goal: typeof body.goal === 'string' ? body.goal : '',
    researchContext: Array.isArray(body.researchContext) ? body.researchContext as never : [],
    totalSteps: typeof body.totalSteps === 'number' ? body.totalSteps : 0,
    totalDataPoints: typeof body.totalDataPoints === 'number' ? body.totalDataPoints : 0,
  });
  return c.json(result.body, { status: result.status as 200 | 400 | 402 | 429 | 500 | 502 });
});

app.post('/functions/v1/optimize-research-config', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { preset?: string; currentGoal?: string };
  const result = await optimizeResearchConfigHandler({
    preset: typeof body.preset === 'string' ? body.preset : '',
    currentGoal: typeof body.currentGoal === 'string' ? body.currentGoal : undefined,
  });
  return c.json(result.body, { status: result.status as 200 | 400 | 402 | 429 | 500 | 502 });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`RuFlo functions dev server listening on http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`  POST /functions/v1/generate-research-goal`);
  // eslint-disable-next-line no-console
  console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(`  Token validation: ${SERVER_TOKEN ? 'ENABLED' : 'disabled (set RUFLO_FUNCTIONS_TOKEN to enable)'}`);
});
