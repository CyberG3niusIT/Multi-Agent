/** GCF entrypoint for research-step. See handler.ts for contract. */
import { researchStepHandler } from './handler';

interface GcfReq { method?: string; body?: unknown }
interface GcfRes {
  status(c: number): GcfRes;
  set(n: string, v: string): GcfRes;
  json(b: unknown): void;
  send(b?: string | Buffer): void;
}

export async function researchStep(req: GcfReq, res: GcfRes): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*')
       .set('Access-Control-Allow-Methods', 'POST, OPTIONS')
       .set('Access-Control-Allow-Headers', 'content-type, x-ruflo-token')
       .status(204).send();
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await researchStepHandler({
    goal: typeof body.goal === 'string' ? body.goal : '',
    stepTitle: typeof body.stepTitle === 'string' ? body.stepTitle : '',
    stepDescription: typeof body.stepDescription === 'string' ? body.stepDescription : '',
    stepType: typeof body.stepType === 'string' ? body.stepType : '',
    aiModel: typeof body.aiModel === 'string' ? body.aiModel : undefined,
    config: body.config,
    previousStepsData: Array.isArray(body.previousStepsData) ? body.previousStepsData as never : undefined,
  });
  res.set('Access-Control-Allow-Origin', '*')
     .set('Content-Type', 'application/json')
     .status(result.status).json(result.body);
}
