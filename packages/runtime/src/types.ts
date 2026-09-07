/**
 * @file packages/runtime/src/types.ts
 * @description Type definitions for the Unified Runtime.
 */

export interface PluginInput {
  directory?: string;
  worktree?: string;
  serverUrl?: string | URL;
  runtime?: 'opencode' | 'kilocode';
  configPath?: string;
}

export interface PluginOutput {
  config?: (input: Record<string, unknown>) => Promise<void>;
  tool?: Record<string, unknown>;
  event?: (input: { event: { type: string } }) => Promise<void>;
  'chat.message'?: (input: { sessionID: string; agent?: string }) => Promise<void>;
  'permission.ask'?: (
    input: { type: string; pattern?: string | string[]; sessionID: string },
    output: { status: 'ask' | 'deny' | 'allow' }
  ) => Promise<void>;
}