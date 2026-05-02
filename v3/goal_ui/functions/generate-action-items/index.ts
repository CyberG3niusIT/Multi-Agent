/** GCF entrypoint for generate-action-items. See handler.ts for contract. */
import { generateActionItemsHandler } from './handler';

interface GcfReq { method?: string; body?: unknown }
interface GcfRes {
  status(c: number): GcfRes;
  set(n: string, v: string): GcfRes;
  json(b: unknown): void;
  send(b?: string | Buffer): void;
}

export async function generateActionItems(req: GcfReq, res: GcfRes): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*')
       .set('Access-Control-Allow-Methods', 'POST, OPTIONS')
       .set('Access-Control-Allow-Headers', 'content-type, x-ruflo-token')
       .status(204).send();
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await generateActionItemsHandler({
    goal: typeof body.goal === 'string' ? body.goal : '',
    researchContext: Array.isArray(body.researchContext) ? body.researchContext as never : [],
    totalSteps: typeof body.totalSteps === 'number' ? body.totalSteps : 0,
    totalDataPoints: typeof body.totalDataPoints === 'number' ? body.totalDataPoints : 0,
  });
  res.set('Access-Control-Allow-Origin', '*')
     .set('Content-Type', 'application/json')
     .status(result.status).json(result.body);
}
