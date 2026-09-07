/**
 * @file packages/core/src/types/persona.ts
 * @description Type definitions for persona hierarchy and matching.
 */

export interface PersonaEntry {
  description: string;
  instructions: string;
  permissions?: Record<string, unknown>;
}

export interface PersonaHierarchy {
  root: PersonaNode;
  all: PersonaNode[];
}

export interface PersonaNode {
  id: string;
  name: string;
  description: string;
  instructions: string;
  permissions: Record<string, unknown>;
  children: PersonaNode[];
  parent?: PersonaNode;
  depth: number;
}

export interface PersonaMatch {
  persona: PersonaNode;
  confidence: number;
  reasoning: string;
}