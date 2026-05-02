/**
 * generate-action-items — port of `supabase/functions/generate-action-items`.
 *
 * Same contract: takes `{goal, researchContext, totalSteps, totalDataPoints}`
 * and returns `{actionItems: Array<{title, description, priority, timeline, ...}>}`
 * (or `{error}` on 429/402/5xx).
 *
 * Mock mode when `LOVABLE_API_KEY` unset returns 3 canned action items.
 */

interface ContextFinding { title: string; content: string; source?: string }
interface ContextStep { stepTitle: string; findings: ContextFinding[] }

const SYSTEM_PROMPT =
  'You are an expert strategic planner. Generate contextual, actionable ' +
  'recommendations based on research findings. Each item must be specific, ' +
  'tied to a finding, and have a clear priority + timeline.';

const TOOL = {
  type: 'function',
  function: {
    name: 'generate_action_items',
    description: 'Generate prioritized action items from research findings',
    parameters: {
      type: 'object',
      properties: {
        actionItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              timeline: { type: 'string' },
            },
            required: ['title', 'description', 'priority', 'timeline'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['actionItems'],
      additionalProperties: false,
    },
  },
} as const;

export interface GenerateActionItemsRequest {
  goal: string;
  researchContext: ContextStep[];
  totalSteps: number;
  totalDataPoints: number;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function generateActionItemsHandler(
  req: GenerateActionItemsRequest,
): Promise<HandlerResult> {
  const { goal, researchContext } = req;
  if (typeof goal !== 'string' || goal.trim() === '') {
    return { status: 400, body: { error: 'goal is required (string)' } };
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return {
      status: 200,
      body: {
        actionItems: [
          { title: `[mock] Action 1 for ${goal.slice(0, 40)}`, description: 'Stub action', priority: 'high', timeline: 'next 2 weeks' },
          { title: `[mock] Action 2 for ${goal.slice(0, 40)}`, description: 'Stub action', priority: 'medium', timeline: 'this quarter' },
          { title: `[mock] Action 3 for ${goal.slice(0, 40)}`, description: 'Stub action', priority: 'low', timeline: 'this year' },
        ],
        mock: true,
      },
    };
  }

  let summary = '';
  for (const step of researchContext ?? []) {
    summary += `\n${step.stepTitle}:\n`;
    for (const f of step.findings ?? []) {
      summary += `• ${f.title}: ${f.content}\n`;
      if (f.source) summary += `  Source: ${f.source}\n`;
    }
  }

  const userPrompt = `Research goal: ${goal}\n\nFindings:${summary || '\n(no findings)'}\n\nGenerate prioritized action items.`;

  const upstream = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'generate_action_items' } },
    }),
  });

  if (!upstream.ok) {
    if (upstream.status === 429) return { status: 429, body: { error: 'Rate limits exceeded' } };
    if (upstream.status === 402) return { status: 402, body: { error: 'AI usage limit reached. Please add credits to continue.' } };
    return { status: 502, body: { error: `AI gateway error: ${upstream.status}` } };
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return { status: 502, body: { error: 'No tool call in AI response' } };
  let parsed: { actionItems?: unknown[] };
  try { parsed = JSON.parse(args); } catch { return { status: 502, body: { error: 'Failed to parse AI tool-call arguments' } }; }
  return { status: 200, body: { actionItems: parsed.actionItems ?? [] } };
}
