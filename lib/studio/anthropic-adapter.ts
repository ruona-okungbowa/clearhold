// AG Studio's LLM adapter for Claude: translates Studio's conversation to a Messages request, and Claude's stream back
// to Studio's events. It runs in the browser, so it posts to this app's own proxy (app/api/ai/responses/route.ts) with
// no key: the server adds it. Studio runs the tools; this only relays the calls and their results.

import type Anthropic from '@anthropic-ai/sdk';
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio';

type Block = Anthropic.ContentBlockParam;
type OpenBlock = { kind: 'text'; id: string; text: string } | { kind: 'tool'; callId: string; name: string; args: string };

/** Studio's flat item list as Claude's alternating turns: parallel tool calls and their results share one message each. */
export function toAnthropicMessages(items: AgAiConversationItem[]) {
  const messages: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  const system: string[] = [];
  const add = (role: 'user' | 'assistant', block: Block) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };

  for (const item of items) {
    if (item.type === 'function_call_output') add('user', { type: 'tool_result', tool_use_id: item.callId, content: item.output });
    else if (item.type === 'function_call') add('assistant', { type: 'tool_use', id: item.callId, name: item.name, input: JSON.parse(item.arguments || '{}') });
    else if (item.type === 'message' && item.kind === 'output') {
      for (const c of item.content) if (c.type === 'text' && c.text) add('assistant', { type: 'text', text: c.text });
    } else if (item.type === 'message') {
      const text = item.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
      if (item.role === 'system') system.push(text);
      else if (text) add('user', { type: 'text', text });
    }
    // Reasoning items are skipped: the route runs with thinking off, so there are none to replay.
  }
  return { system, messages };
}

export function toAnthropicBody(request: AgLlmRequest) {
  const { system, messages } = toAnthropicMessages(request.input);
  const tools = (request.tools ?? []).filter((t) => t.kind !== 'provided');
  const choice = request.toolChoice;
  // The current models refuse forced tool choice with a 400, so a forced call is asked for in words.
  const forced = choice && choice !== 'auto' && choice !== 'none' ? `Call ${choice === 'required' ? 'one of the available tools' : `the ${choice.name} tool`} now.` : null;
  return {
    model: request.model?.id,
    system: [request.instructions, ...system, forced].filter(Boolean).join('\n\n') || undefined,
    messages,
    tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) : undefined,
    tool_choice: tools.length ? { type: choice === 'none' ? ('none' as const) : ('auto' as const) } : undefined,
    output_config: request.responseFormat?.type === 'json' ? { format: { type: 'json_schema' as const, schema: request.responseFormat.schema } } : undefined,
  };
}

/** Reads one Claude stream: read() maps each event to Studio's, finish() gives the turn's final response or throws. */
export function createDecoder() {
  const blocks = new Map<number, OpenBlock>();
  let id = '';
  let model: string | undefined;
  let stop: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  return {
    read(event: Anthropic.RawMessageStreamEvent): AgAiEvent[] {
      switch (event.type) {
        case 'message_start':
          id = event.message.id;
          model = event.message.model;
          inputTokens = event.message.usage.input_tokens;
          return [];
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'text') {
            const messageId = `${id}-${event.index}`;
            blocks.set(event.index, { kind: 'text', id: messageId, text: '' });
            return [{ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' }];
          }
          if (block.type === 'tool_use') {
            blocks.set(event.index, { kind: 'tool', callId: block.id, name: block.name, args: '' });
            return [{ type: 'TOOL_CALL_START', toolCallId: block.id, toolCallName: block.name }];
          }
          return [];
        }
        case 'content_block_delta': {
          const block = blocks.get(event.index);
          const delta = event.delta;
          if (block?.kind === 'text' && delta.type === 'text_delta' && delta.text) {
            block.text += delta.text;
            return [{ type: 'TEXT_MESSAGE_CONTENT', messageId: block.id, delta: delta.text }];
          }
          if (block?.kind === 'tool' && delta.type === 'input_json_delta' && delta.partial_json) {
            block.args += delta.partial_json;
            return [{ type: 'TOOL_CALL_ARGS', toolCallId: block.callId, delta: delta.partial_json }];
          }
          return [];
        }
        case 'content_block_stop': {
          const block = blocks.get(event.index);
          if (block?.kind === 'text') return [{ type: 'TEXT_MESSAGE_END', messageId: block.id }];
          if (block?.kind !== 'tool') return [];
          // A tool with no parameters streams no input at all, and Studio parses what it is given.
          const empty: AgAiEvent[] = block.args ? [] : [{ type: 'TOOL_CALL_ARGS', toolCallId: block.callId, delta: '{}' }];
          block.args ||= '{}';
          return [...empty, { type: 'TOOL_CALL_END', toolCallId: block.callId }];
        }
        case 'message_delta':
          stop = event.delta.stop_reason;
          outputTokens = event.usage.output_tokens;
          return [];
        default:
          return [];
      }
    },

    finish(): AgLlmResponse {
      if (stop === 'refusal') throw new Error('Claude declined this request.');
      if (stop === 'max_tokens') throw new Error('The reply was cut off at the token limit.');
      if (!id || !stop) throw new Error('Stream ended without a final response.');
      const output = [...blocks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, b]): AgAiOutputItem =>
          b.kind === 'text'
            ? { id: b.id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: b.text, annotations: [] }] }
            : { id: b.callId, kind: 'output', type: 'function_call', callId: b.callId, name: b.name, arguments: b.args, status: 'completed' },
        );
      return { id, createdAt: Date.now(), model, output, status: 'completed', usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
    },
  };
}

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}

export function anthropicAdapter({ endpoint }: { endpoint: string }): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      let resolve!: (response: AgLlmResponse) => void;
      let reject!: (error: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Marks a failure observed for a consumer that stops reading the stream and never awaits `complete`.
      void complete.catch(() => {});

      // A failed turn is reported once, through `complete`: rethrowing from the stream too would go unobserved.
      async function* run(): AsyncGenerator<AgAiEvent> {
        const decoder = createDecoder();
        try {
          const response = await fetch(`${endpoint}/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toAnthropicBody(request)),
            signal: options?.signal,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error?.message || `HTTP ${response.status}`);
          }
          for await (const event of ndjson(response.body!)) yield* decoder.read(event);
          resolve(decoder.finish());
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      const stream = run();
      return { stream: { [Symbol.asyncIterator]: () => stream }, complete };
    },
  };
}
