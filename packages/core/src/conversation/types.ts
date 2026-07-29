export interface SessionOptions {
  directory: string;
  parentId?: string;
}

export interface Session {
  id: string;
}

export interface PromptRequest {
  sessionId: string;
  agent: string;
  text: string;
  schema?: Record<string, unknown>;
}

export interface PromptResponse {
  result: unknown;
  sessionId: string;
}

export type SessionEvent =
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string }
  | { type: 'aborted'; sessionId: string };

/**
 * Conversation abstracts the communication protocol between the plugin
 * and the runtime (OpenCode, Kilo Code, or direct HTTP).
 *
 * All SDK-specific code lives in adapters that implement this interface.
 * The rest of the codebase imports only this interface.
 */
export interface Conversation {
  createSession(opts: SessionOptions): Promise<Session>;
  send(request: PromptRequest): Promise<PromptResponse>;
  events(sessionId: string): AsyncIterable<SessionEvent>;
  abort(sessionId: string): Promise<void>;
}
