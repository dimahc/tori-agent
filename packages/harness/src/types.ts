/**
 * @file packages/harness/src/types.ts
 * @description Type definitions for the Unified Runtime.
 */

export interface PluginInput {
  directory?: string;
  worktree?: string;
  serverUrl?: string | URL;
  runtime?: 'opencode' | 'kilocode';
  configPath?: string;
}

export interface SessionTitleMutation {
  title?: string;
  shouldRename?: boolean;
  source?: 'first-user-request';
}

export interface SessionAgentHookInput {
  sessionID: string;
  agent?: string;
}

export interface SessionAgentMutation {
  agent?: string;
  agentId?: string;
  authoritative?: true;
  source?: 'ontology-default-main-agent';
}

export interface PluginEventInput {
  event: { type: string; sessionID?: string; agent?: string };
  sessionID?: string;
  agent?: string;
}

export interface SessionTitleHookInput {
  sessionID: string;
  agent?: string;
  role?: string;
  message?: string;
  currentTitle?: string;
}

export interface AssistantOutputHookInput {
  sessionID: string;
  agent?: string;
  role?: string;
  text: string;
  attempt?: number;
}

export interface AssistantOutputMutation {
  text?: string;
  status?: 'allow' | 'retry' | 'block';
  reason?: string;
}

export interface PluginOutput {
  config?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  tool?: Record<string, unknown>;
  event?: (input: PluginEventInput, output?: SessionAgentMutation) => Promise<void>;
  'session.agent'?: (input: SessionAgentHookInput, output: SessionAgentMutation) => Promise<void>;
  'chat.message'?: (input: SessionTitleHookInput, output?: SessionTitleMutation) => Promise<void>;
  'session.title'?: (input: SessionTitleHookInput, output: SessionTitleMutation) => Promise<void>;
  'assistant.output'?: (input: AssistantOutputHookInput, output: AssistantOutputMutation) => Promise<void>;
  'permission.ask'?: (
    input: { type: string; pattern?: string | string[]; sessionID: string },
    output: { status: 'deny' | 'allow'; reason?: string }
  ) => Promise<void>;
}
