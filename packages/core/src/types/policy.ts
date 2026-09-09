import type {
  AuthorizationDecision,
  AuthorizationRequest,
  ExecutionLoopPolicy,
  OntologyId,
  OntologyEntity,
  OutputGovernancePolicy,
  TransitionDecision,
  WorkflowRun,
} from "@tori-agent/ontology";

export interface Fact {
  predicate: string;
  args: string[];
}

export type Variable = string;
export type Term = string | Variable;

export interface Atom {
  predicate: string;
  terms: Term[];
}

export interface Rule {
  head: Atom;
  body: Atom[];
}

export type Substitution = Record<Variable, string>;

export interface PolicyEngine {
  authorize(request: AuthorizationRequest): AuthorizationDecision;
  canTransition(workflowRun: WorkflowRun, toStageId: OntologyId): TransitionDecision;
  ingestWorkflowRun(workflowRun: WorkflowRun): void;
  clearWorkflowRun(workflowRunId: OntologyId): void;
  getExecutionLoopPolicy(agentId: OntologyId, toolId?: OntologyId): ExecutionLoopPolicy;
  getOutputGovernancePolicy(agentId: OntologyId): OutputGovernancePolicy;
  ingestOntology?(entity: OntologyEntity): void;
}
