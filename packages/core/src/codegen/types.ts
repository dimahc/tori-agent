export interface PersonaEntry {
  description: string;
  instructions: string;
  permissions?: AgentPermissions;
}

export interface AgentSpec {
  id: string;
  name: string;
  mode: 'all' | 'subagent';
  color?: string;
  temperature: number;
  description: string;
  prompt: string;
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
