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
}

export interface AgentPermissions {
  allow?: string[];
  deny?: string[];
  allow_paths?: Record<string, string[]>;
  allow_commands?: Record<string, string[]>;
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
