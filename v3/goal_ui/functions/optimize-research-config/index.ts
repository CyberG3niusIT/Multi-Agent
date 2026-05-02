/** GCF entrypoint for optimize-research-config. See handler.ts for contract. */
import { optimizeResearchConfigHandler } from './handler';

interface GcfReq { method?: string; body?: unknown }
interface GcfRes {
  status(c: number): GcfRes;
  set(n: string, v: string): GcfRes;
  json(b: unknown): void;
  send(b?: string | Buffer): void;
}

export async function optimizeResearchConfig(req: GcfReq, res: GcfRes): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*')
       .set('Access-Control-Allow-Methods', 'POST, OPTIONS')
       .set('Access-Control-Allow-Headers', 'content-type, x-ruflo-token')
       .status(204).send();
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  const body = (req.body ?? {}) as { preset?: string; currentGoal?: string };
  const result = await optimizeResearchConfigHandler({
    preset: body.preset ?? '',
    currentGoal: body.currentGoal,
  });
  res.set('Access-Control-Allow-Origin', '*')
     .set('Content-Type', 'application/json')
     .status(result.status).json(result.body);
}
