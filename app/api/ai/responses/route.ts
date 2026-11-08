import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { aiModels, anthropicKey } from '@/lib/ai';
import { isStaffRequest } from '@/lib/staff';

// Proxy for AG Studio's Claude adapter (lib/studio/anthropic-adapter.ts). The adapter runs in the browser and POSTs
// the Messages request here. This checks staff, adds the server's key and streams Claude's events straight back,
// so the key never leaves the server. Staff only: the site is public and every call spends money.

// Bounds the cost of a single turn, whatever the client asks for.
const MAX_OUTPUT_TOKENS = 32_000;

// Everything else in the body is dropped, so a caller can't reach server-side tools or change the limits.
const Body = z.object({
  model: z.string().optional(),
  system: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(z.record(z.string(), z.unknown())) })).min(1),
  tools: z.array(z.object({ name: z.string(), description: z.string(), input_schema: z.record(z.string(), z.unknown()) })).optional(),
  tool_choice: z.object({ type: z.enum(['auto', 'none']) }).optional(),
  output_config: z.object({ format: z.object({ type: z.literal('json_schema'), schema: z.record(z.string(), z.unknown()) }) }).optional(),
});

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return error(401, 'Sign in as staff to use the assistant.');

  const apiKey = anthropicKey();
  if (!apiKey) return error(503, 'The AI assistant is not configured: set ANTHROPIC_API_KEY in .env.local.');

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(400, 'Request body is not a Messages request.');

  // Only the models offered in the picker (ANTHROPIC_MODELS) may be called.
  const models = aiModels();
  const model = parsed.data.model ?? models[0];
  if (!models.includes(model)) return error(400, `Model "${model}" is not enabled.`);

  try {
    const stream = await new Anthropic({ apiKey }).beta.messages.create(
      {
        ...(parsed.data as unknown as Omit<Anthropic.Beta.MessageCreateParamsStreaming, 'model' | 'max_tokens' | 'stream'>),
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // No thinking blocks to carry between turns: Studio's conversation items have nowhere to keep their signatures.
        thinking: { type: 'between_tools' },
        cache_control: { type: 'ephemeral' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        stream: true,
      },
      // Stopping a run in Studio aborts the browser request, which cancels this one too.
      { signal: request.signal },
    );
    return new Response(stream.toReadableStream(), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return error(err.status ?? 502, err.message);
    throw err;
  }
}
