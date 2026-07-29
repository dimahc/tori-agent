import type { Conversation } from '@tori-agent/core';

/**
 * Adapt the Kilo Code SDK to the Conversation protocol.
 */
export function createKiloCodeConversation(_baseUrl: string): Conversation {
  // TODO: wire against real @kilocode/sdk when available
  return {
    createSession: async (opts) => {
      throw new Error('Kilo Code adapter session not implemented');
    },
    send: async (request) => {
      throw new Error('Kilo Code adapter send not implemented');
    },
    events: async function* (_sessionId: string) {
      throw new Error('Kilo Code adapter events not implemented');
    },
    abort: async (_sessionId: string) => {
      throw new Error('Kilo Code adapter abort not implemented');
    },
  };
}