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

export interface ConfigLike {
  agent?: Record<string, unknown>;
  session?: Record<string, unknown>;
  ontology?: Record<string, unknown>;
  default_agent?: string;
  [key: string]: unknown;
}

export interface PluginEventInput {
  event: {
    type: "session.created" | "session.updated" | "session.next.agent.switched" | string;
    properties?: Record<string, unknown>;
  };
}

export interface ChatMessageHookInput {
  sessionID: string;
  agent?: string;
  message?: unknown;
  parts?: unknown[];
}

export interface ChatMessageHookOutput {
  message?: unknown;
  parts?: unknown[];
}

export interface PermissionAskHookInput {
  id?: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
  tool?: Record<string, unknown>;
}

export interface PermissionAskHookOutput {
  status: 'ask' | 'deny' | 'allow';
}

export interface ToolExecuteBeforeHookInput {
  sessionID: string;
  callID: string;
  tool: string;
}

export interface ToolExecuteBeforeHookOutput {
  args: unknown;
}

export interface ExperimentalTextCompleteHookInput {
  sessionID: string;
  messageID: string;
  partID: string;
}

export interface ExperimentalTextCompleteHookOutput {
  text?: string;
}

export interface PluginOutput {
  config?: (input: ConfigLike) => Promise<void>;
  tool?: Record<string, unknown>;
  event?: (input: PluginEventInput) => Promise<void>;
  'chat.message'?: (input: ChatMessageHookInput, output: ChatMessageHookOutput) => Promise<void>;
  'permission.ask'?: (input: PermissionAskHookInput, output: PermissionAskHookOutput) => Promise<void>;
  'tool.execute.before'?: (
    input: ToolExecuteBeforeHookInput,
    output: ToolExecuteBeforeHookOutput,
  ) => Promise<void>;
  'experimental.text.complete'?: (
    input: ExperimentalTextCompleteHookInput,
    output: ExperimentalTextCompleteHookOutput,
  ) => Promise<void>;
}
