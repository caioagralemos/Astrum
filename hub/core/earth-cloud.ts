// Demo mode only: a cloud model for Earth's simulated reply to an alert's
// message, used when GROQ_API_KEY is set in the environment when the hub
// starts. The key is read from the environment only: never stored, never
// logged. What is sent is the hub's brief of the incident (alert name, room
// name, reason, the triggering reading with its kind and limit, whether there
// is a card, the round trip): no person's name and no typed words. Restricted
// alerts never reach it (core/earth-reply.ts). Its text passes the same checks
// as the on-board model's; on any failure the on-board model, then the fixed
// sentence, is used.

import type { ChatMessage } from '../engine/prompt.ts';
import type { ReplyModel } from './earth-reply.ts';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_EARTH_MODEL = 'qwen/qwen3.8-27b';
const TIMEOUT_MS = 6_000;

export function cloudReplyModel(options: { key: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number }): ReplyModel {
  const fetcher = options.fetcher ?? fetch;
  return {
    ready: () => Boolean(options.key),
    chat: async (messages: ChatMessage[]) => {
      const res = await fetcher(GROQ_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.key}` },
        body: JSON.stringify({ model: options.model || DEFAULT_EARTH_MODEL, messages, temperature: 0.3, max_completion_tokens: 200 }),
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`cloud reply: HTTP ${res.status}`);
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('cloud reply: no text');
      return text;
    },
  };
}
