/**
 * @file packages/core/src/types/ontology.ts
 * @description Core ontological interfaces for the Tori system.
 * Part of the Ontological Upgrade (SC-01).
 * 
 * @context https://tori-agent.dev/ontology/2026/core#
 * @context agent https://tori-agent.dev/ontology/2026/agent#
 */

export type OntologyId = string;

/**
 * Base interface for all ontological entities to support JSON-LD and relational reasoning.
 */
export interface OntologicalEntity {
  readonly "@id": OntologyId;
  readonly "@type": string;
  readonly "@context"?: Record<string, string>;
  
  // Relational properties for Datalog reasoning
  readonly governedBy?: OntologyId;
  readonly implements?: OntologyId;
  readonly partOf?: OntologyId;
  readonly requires?: OntologyId[];
  
  // Optional metadata for schema versioning and extensibility
  readonly metadata?: Record<string, unknown>;
}

export interface Agent extends OntologicalEntity {
  readonly "@type": "Agent";
  readonly name: string;
  readonly description: string;
  readonly roles: Role[];
  readonly capabilities: Capability[];
  readonly tools: Tool[];
  readonly metadata: Record<string, unknown>;
}

export interface Role extends OntologicalEntity {
  readonly "@type": "Role";
  readonly name: string;
  readonly description: string;
  readonly permissions: string[];
  readonly capabilities: Capability[];
}

export interface Capability extends OntologicalEntity {
  readonly "@type": "Capability";
  readonly name: string;
  readonly description: string;
  readonly scope: string;
}

export interface Skill extends OntologicalEntity {
  readonly "@type": "Skill";
  readonly name: string;
  readonly description: string;
  readonly required_capabilities: Capability[];
}

export interface Tool extends OntologicalEntity {
  readonly "@type": "Tool";
  readonly name: string;
  readonly description: string;
  readonly capability_id: OntologyId;
}

export interface Task extends OntologicalEntity {
  readonly "@type": "Task";
  readonly name: string;
  readonly description: string;
  readonly assigned_to: Agent[];
  readonly status: 'Open' | 'Working' | 'Pending Review' | 'Overdue' | 'Completed' | 'Cancelled';
}

export interface Workflow extends OntologicalEntity {
  readonly "@type": "Workflow";
  readonly name: string;
  readonly stages: Stage[];
  readonly transitions: Transition[];
}

export interface Stage extends OntologicalEntity {
  readonly "@type": "Stage";
  readonly name: string;
  readonly workflow_id: OntologyId;
  readonly entry_conditions: string[];
  readonly exit_conditions: string[];
}

export interface Transition extends OntologicalEntity {
  readonly "@type": "Transition";
  readonly from_stage: OntologyId;
  readonly to_stage: OntologyId;
  readonly trigger: string;
}

export interface Artifact extends OntologicalEntity {
  readonly "@type": "Artifact";
  readonly name: string;
  readonly type: string;
  readonly owner_id: OntologyId;
  readonly metadata?: Record<string, unknown>;
}

export interface Knowledge extends OntologicalEntity {
  readonly "@type": "Knowledge";
  readonly name: string;
  readonly content: string;
  readonly source_id: OntologyId;
}

export interface Policy extends OntologicalEntity {
  readonly "@type": "Policy";
  readonly name: string;
  readonly rules: string[];
  readonly enforcement_level: 'Advisory' | 'Mandatory' | 'Strict';
}
