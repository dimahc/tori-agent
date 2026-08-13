export interface PersonaEntry {
  description: string;
  instructions: string;
  permissions?: AgentPermissions;
  expertise_tags?: string[];
  parent_id?: string;
  weight?: number;
}

export interface AgentSpec {
  id: string;
  name: string;
  mode: 'all' | 'subagent';
  color?: string;
  temperature: number;
  description: string;
  prompt: string;
  references?: string[];
  human_tone: boolean;
  permissions: AgentPermissions;
  personas?: Record<string, PersonaEntry>;
  modes?: Record<string, PersonaEntry>;
  content_hash?: string;
  signature?: string;
  version?: string;
  platforms?: string[];
  author?: {
    name?: string;
    identity?: string;
    signing_key?: string;
  };
  risk_tier?: 'L0' | 'L1' | 'L2' | 'L3';
  scan_status?: {
    scanner?: string;
    last_scanned?: string;
    result?: string;
  };
  changelog?: Array<{
    version?: string;
    date?: string;
    notes?: string;
  }>;
}

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

export interface CompiledAgent {
  id: string;
  description: string;
  temperature: number;
  mode: 'all' | 'subagent';
  color: string;
  prompt: string;
  permission: Record<string, unknown>;
  humanTone?: boolean;
}

export type { PersonaHierarchy, PersonaMatch } from '../types/persona.js';
