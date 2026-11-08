// Server-side configuration for the AG Studio AI assistant. The Anthropic key is read only here: it is
// never passed to a client component, and it has no NEXT_PUBLIC_ prefix, so Next.js never inlines it
// into the browser bundle.

import { MODEL } from './inspector';

/** The Anthropic key for the assistant, or undefined when none is configured. */
export const anthropicKey = () => process.env.ANTHROPIC_API_KEY || undefined;

/** The Claude models the assistant may use, from ANTHROPIC_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.ANTHROPIC_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : [MODEL];
}

/** The assistant is shown only when a key is configured. */
export function aiEnabled(): boolean {
  return Boolean(anthropicKey());
}
