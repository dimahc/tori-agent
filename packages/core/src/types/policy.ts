/**
 * @file packages/core/src/types/policy.ts
 * @description Type definitions for the Datalog Policy Engine (SC-03).
 * Part of the Neuro-symbolic Triad: JSON-LD → SHACL → Datalog.
 */

import type { OntologyId } from './ontology.js';

/**
 * A ground fact in the Datalog engine.
 * Represents a single relational tuple: predicate(args...).
 */
export interface Fact {
  /** Predicate name (e.g., "has_role", "can_access", "manages"). */
  predicate: string;
  /** Arguments as strings (constants or variable references). */
  args: string[];
}

/**
 * A variable in a Datalog rule (prefixed with "?").
 */
export type Variable = string;

/**
 * A term in an atom - either a constant string or a variable.
 */
export type Term = string | Variable;

/**
 * An atomic formula: predicate(terms...).
 * Used for both rule heads and body literals.
 */
export interface Atom {
  /** Predicate name. */
  predicate: string;
  /** Terms (constants or variables). */
  terms: Term[];
}

/**
 * A Datalog rule: head :- body.
 * Head is a single atom; body is a conjunction of atoms.
 * Negation is expressed via the NOT_ prefix on predicate names in the body.
 */
export interface Rule {
  /** The head atom (conclusion). */
  head: Atom;
  /** Body atoms (premises). Empty body = fact. */
  body: Atom[];
  /** Optional flag for stratified negation support. */
  isNegated?: boolean;
}

/**
 * A variable substitution mapping.
 * Maps variable names (with "?" prefix) to bound constant values.
 */
export type Substitution = Record<Variable, string>;

/**
 * High-level Policy Engine interface.
 * Provides access control decisions via Datalog reasoning.
 */
export interface PolicyEngine {
  /**
   * Evaluate whether `subject` may perform `action` on `object`.
   * 
   * @param subject - Agent identifier (ontological @id, e.g., "agent:tori")
   * @param action  - Action verb (e.g., "read", "edit", "execute", "deploy")
   * @param object  - Target resource identifier (e.g., "resource:file.ts", "artifact:spec")
   * @param context - Optional ephemeral context facts for this evaluation only
   * @returns true if access is provable and not explicitly denied
   */
  evaluate(
    subject: string,
    action: string,
    object: string,
    context?: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Synchronous version of evaluate for cases where async is not needed.
   * Uses the current fact/rule base without rebuilding.
   */
  evaluateSync(
    subject: string,
    action: string,
    object: string,
    context?: Record<string, unknown>
  ): boolean;

  /**
   * Add a ground fact to the persistent fact base (EDB).
   */
  addFact(fact: Fact): void;

  /**
   * Add an inference rule to the persistent rule base (IDB).
   */
  addRule(rule: Rule): void;

  /**
   * Clear all facts and rules, including default rules.
   */
  clear(): void;

  /**
   * Load the default tori-agent authorization rules.
   * Idempotent - safe to call multiple times.
   */
  loadDefaultRules(): void;

  /**
   * Ingest an ontological entity and convert it to Datalog facts/rules.
   * This is the bridge from the ontology (JSON-LD) to the policy engine (Datalog).
   * 
   * @param entity - Any ontological entity (Agent, Role, Capability, Tool, Artifact, etc.)
   */
  ingestOntology(entity: { '@id': OntologyId; '@type': string; [key: string]: unknown }): void;
}