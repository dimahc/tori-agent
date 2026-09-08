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

export interface SessionTitleHookInput {
  sessionID: string;
  agent?: string;
  role?: string;
  message?: string;
  currentTitle?: string;
}

export interface PluginOutput {
  config?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  tool?: Record<string, unknown>;
  event?: (input: { event: { type: string } }) => Promise<void>;
  'chat.message'?: (input: SessionTitleHookInput, output?: SessionTitleMutation) => Promise<void>;
  'session.title'?: (input: SessionTitleHookInput, output: SessionTitleMutation) => Promise<void>;
  'permission.ask'?: (
    input: { type: string; pattern?: string | string[]; sessionID: string },
    output: { status: 'deny' | 'allow' }
  ) => Promise<void>;
}
