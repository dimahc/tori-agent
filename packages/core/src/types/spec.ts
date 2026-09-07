/**
 * @file packages/core/src/types/spec.ts
 * @description Type definitions for agent specifications (replaces codegen/types.ts).
 */

export interface AgentPermissions {
  allow?: string[];
  deny?: string[];
  allow_paths?: Record<string, string[]>;
  allow_commands?: Record<string, string[]>;
  deny_write?: string[];
  network?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface AgentSpec {
  id: string;
  name: string;
  description: string;
  prompt: string;
  temperature: number;
  mode: 'all' | 'subagent';
  color?: string;
  human_tone: boolean;
  risk_tier?: 'L0' | 'L1' | 'L2' | 'L3';
  platforms?: ('openclaw' | 'claude' | 'cursor' | 'vscode')[];
  author?: {
    identity?: string;
    signing_key?: string;
  };
  scan_status?: {
    last_scanned?: string;
    result?: string;
  };
  changelog?: Array<{
    version?: string;
    date?: string;
  }>;
  permissions?: AgentPermissions;
  personas?: Record<string, PersonaEntry>;
  modes?: Record<string, PersonaEntry>;
  references?: string[];
  content_hash?: string;
  signature?: string;
}

export interface PersonaEntry {
  description: string;
  instructions: string;
  permissions?: AgentPermissions;
}

export interface CompiledAgent {
  id: string;
  description: string;
  temperature: number;
  mode: 'all' | 'subagent';
  color: string;
  prompt: string;
  permission: Record<string, unknown>;
  humanTone: boolean;
}