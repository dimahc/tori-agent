import type { Conversation } from '@tori-agent/core';

/**
 * Adapt the OpenCode SDK to the Conversation protocol.
 */
export function createOpencodeConversation(_baseUrl: string): Conversation {
  // TODO: wire against real @opencode-ai/sdk when available
  return {
    createSession: async (opts) => {
      throw new Error('OpenCode adapter session not implemented');
    },
    send: async (request) => {
      throw new Error('OpenCode adapter send not implemented');
    },
    events: async function* (_sessionId: string) {
      throw new Error('OpenCode adapter events not implemented');
    },
    abort: async (_sessionId: string) => {
      throw new Error('OpenCode adapter abort not implemented');
    },
  };
}