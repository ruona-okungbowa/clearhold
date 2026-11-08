// Self-check for the Claude adapter's translation, no network: npm run check:adapter

import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgAiConversationItem, AgLlmRequest } from 'ag-studio';
import { createDecoder, toAnthropicBody, toAnthropicMessages } from '../lib/studio/anthropic-adapter';

const call = (callId: string, args: string) => ({ id: callId, kind: 'output', type: 'function_call', callId, name: 'tool', arguments: args }) as AgAiConversationItem;
const result = (callId: string) => ({ type: 'function_call_output', callId, output: 'ok', status: 'completed' }) as AgAiConversationItem;
const user = (text: string, role = 'user') => ({ id: text, kind: 'input', type: 'message', role, status: 'completed', content: [{ type: 'text', text }] }) as AgAiConversationItem;

// Parallel calls share one assistant turn and their results one user turn; empty arguments parse; reasoning is dropped.
const { messages, system } = toAnthropicMessages([
  user('rules', 'system'),
  user('hello'),
  { id: 'r', kind: 'output', type: 'reasoning', summary: [] },
  call('a', '{"x":1}'),
  call('b', ''),
  result('a'),
  result('b'),
]);
assert.deepEqual(system, ['rules']);
assert.deepEqual(messages.map((m) => [m.role, m.content.length]), [['user', 1], ['assistant', 2], ['user', 2]]);
assert.deepEqual((messages[1].content[1] as Anthropic.ToolUseBlockParam).input, {});

// Forced tool choice becomes words, since the API refuses it.
const tool = { name: 'pick', description: 'd', parameters: { type: 'object' } } as NonNullable<AgLlmRequest['tools']>[number];
const body = (toolChoice: AgLlmRequest['toolChoice']) => toAnthropicBody({ input: [user('q')], tools: [tool], toolChoice, responseFormat: { type: 'text' } });
assert.deepEqual(body({ name: 'pick' }).tool_choice, { type: 'auto' });
assert.match(body({ name: 'pick' }).system!, /the pick tool/);
assert.deepEqual(body('none').tool_choice, { type: 'none' });

// A stream with text then a no-input tool call.
const decoder = createDecoder();
const event = (e: unknown) => decoder.read(e as Anthropic.RawMessageStreamEvent);
event({ type: 'message_start', message: { id: 'm', model: 'claude', usage: { input_tokens: 5 } } });
assert.deepEqual(event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), [{ type: 'TEXT_MESSAGE_START', messageId: 'm-0', role: 'assistant' }]);
assert.deepEqual(event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }), [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-0', delta: 'hi' }]);
event({ type: 'content_block_stop', index: 0 });
assert.deepEqual(event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'tool', input: {} } }), [{ type: 'TOOL_CALL_START', toolCallId: 't', toolCallName: 'tool' }]);
assert.deepEqual(event({ type: 'content_block_stop', index: 1 }), [{ type: 'TOOL_CALL_ARGS', toolCallId: 't', delta: '{}' }, { type: 'TOOL_CALL_END', toolCallId: 't' }]);
event({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } });
const final = decoder.finish();
assert.deepEqual(final.output.map((o) => o.type), ['message', 'function_call']);
assert.equal(final.usage?.totalTokens, 8);

// A refused or truncated turn fails rather than passing for an answer.
for (const reason of ['refusal', 'max_tokens']) {
  const d = createDecoder();
  d.read({ type: 'message_start', message: { id: 'm', model: 'c', usage: { input_tokens: 1 } } } as Anthropic.RawMessageStreamEvent);
  d.read({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 1 } } as Anthropic.RawMessageStreamEvent);
  assert.throws(() => d.finish());
}

console.log('anthropic adapter: all checks passed');
