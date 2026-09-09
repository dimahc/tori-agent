import {
  CHECK_STATUS,
  ENTITY_TYPES,
  POLICY_EFFECT,
  POLICY_KIND,
  getToolId,
  type AgentDefinition,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type ExecutionLoopPolicy,
  type OntologyBundle,
  type OntologyId,
  type OutputGovernancePolicy,
  type PersistedWorkflowCheckSnapshot,
  type PolicyDefinition,
  type PermissionGrant,
  type RoleDefinition,
  type TransitionDecision,
  type WorkflowRun,
} from "@tori-agent/ontology";
import type { PolicyEngine } from "../types/policy.js";
import { buildWorkflowProgressSignature } from "../guardrails/output.js";

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLE_STAR::")
      .replace(/\*/g, "[^/]*")
      .replace(/::DOUBLE_STAR::/g, ".*");
    return new RegExp(`^${escaped}$`).test(value);
  });
}

function normalizePatterns(pattern?: string | string[]): string[] {
  if (!pattern) return [];
  return Array.isArray(pattern) ? pattern : [pattern];
}

function matchesAllPatterns(policyPatterns: string[] | undefined, requestPatterns: string[]): boolean {
  if (!policyPatterns || policyPatterns.length === 0) return true;
  if (requestPatterns.length === 0) return false;
  return requestPatterns.every((pattern) => matchesAny(policyPatterns, pattern));
}

function snapshotIndex(workflowRun: WorkflowRun): Record<string, PersistedWorkflowCheckSnapshot> {
  return workflowRun.check_record_index ?? {};
}

export class PolicyEngineImpl implements PolicyEngine {
  constructor(private readonly bundle: OntologyBundle) {}

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    const agent = this.bundle.byId.get(request.agentId);
    if (!agent || agent["@type"] !== ENTITY_TYPES.Agent) {
      return { effect: "deny", matchedGrantIds: [], reason: `Unknown agent ${request.agentId}` };
    }

    const toolId = getToolId(request.toolName);
    const roles = (agent as AgentDefinition).role_ids
      .map((roleId) => this.bundle.byId.get(roleId))
      .filter((value): value is RoleDefinition => value?.["@type"] === ENTITY_TYPES.Role);

    const grantMatches: PermissionGrant[] = [];
    const patterns = normalizePatterns(request.pattern);

    const denyPolicies = this.getMatchingAuthorizationPolicies(agent as AgentDefinition, roles, request, patterns)
      .filter((policy) => policy.effect === POLICY_EFFECT.deny);

    if (denyPolicies.length > 0) {
      const last = denyPolicies[denyPolicies.length - 1];
      return {
        effect: "deny",
        matchedGrantIds: denyPolicies.map((policy) => policy["@id"]),
        reason: `${request.toolName} denied by ${last["@id"]}`,
      };
    }

    for (const role of roles) {
      for (const grant of role.permission_grants) {
        if (grant.tool_id !== toolId) continue;
        if (patterns.length > 0 && grant.path_globs && !matchesAllPatterns(grant.path_globs, patterns)) {
          continue;
        }
        if (patterns.length > 0 && grant.command_globs && !matchesAllPatterns(grant.command_globs, patterns)) {
          continue;
        }
        grantMatches.push(grant);
      }
    }

    if (grantMatches.length === 0) {
      return { effect: "deny", matchedGrantIds: [], reason: `No permission grant for ${request.toolName}` };
    }

    const last = grantMatches[grantMatches.length - 1];

    return {
      effect: last.effect === POLICY_EFFECT.allow ? "allow" : "deny",
      matchedGrantIds: grantMatches.map((grant) => grant["@id"]),
      reason: `${request.toolName} resolved by ${last["@id"]}`,
    };
  }

  canTransition(workflowRun: WorkflowRun, toStageId: OntologyId): TransitionDecision {
    const transition = this.bundle.workflowTransitions.find(
      (candidate) =>
        candidate.workflow_definition_id === workflowRun.definition_id &&
        candidate.from_stage_id === workflowRun.stage_id &&
        candidate.to_stage_id === toStageId,
    );

    if (!transition) {
      return {
        allowed: false,
        reason: `No ontology transition from ${workflowRun.stage_id} to ${toStageId}`,
      };
    }

    const requiredCheckDecision = this.evaluateRequiredChecks(workflowRun, transition.required_check_ids ?? [], CHECK_STATUS.passed);
    if (!requiredCheckDecision.allowed) {
      return requiredCheckDecision;
    }

    for (const policy of this.getMatchingTransitionPolicies(workflowRun, toStageId)) {
      if (typeof policy.max_iteration === "number" && workflowRun.iteration >= policy.max_iteration) {
        return {
          allowed: false,
          reason: `${policy["@id"]} exceeded iteration cap ${policy.max_iteration}`,
          escalation_stage_id: policy.escalation_stage_id,
        };
      }
      const checksDecision = this.evaluateRequiredChecks(workflowRun, policy.required_check_ids ?? [], policy.required_check_status_id ?? CHECK_STATUS.passed);
      if (!checksDecision.allowed) {
        return checksDecision;
      }
      const transitionKey = `${workflowRun.stage_id}->${toStageId}`;
      const retryCount = workflowRun.loop_state?.retry_counts?.[transitionKey] ?? 0;
      if (typeof policy.max_transition_retries === "number" && retryCount >= policy.max_transition_retries) {
        return {
          allowed: false,
          reason: `${policy["@id"]} exceeded retry cap ${policy.max_transition_retries}`,
          escalation_stage_id: policy.escalation_stage_id,
        };
      }
      const noProgressCount = workflowRun.loop_state?.no_progress_counts?.[transitionKey] ?? 0;
      const predictedNoProgressCount =
        workflowRun.stage_id === "workflow-stage:verification" && toStageId === "workflow-stage:execution"
          ? ((workflowRun.loop_state?.progress_signatures?.[transitionKey] === buildWorkflowProgressSignature(workflowRun)
              ? noProgressCount + 1
              : 0))
          : noProgressCount;
      if (typeof policy.max_no_progress_retries === "number" && predictedNoProgressCount >= policy.max_no_progress_retries) {
        return {
          allowed: false,
          reason: `${policy["@id"]} exceeded no-progress cap ${policy.max_no_progress_retries}`,
          escalation_stage_id: policy.escalation_stage_id,
        };
      }
      if (typeof policy.max_identical_failures === "number") {
        const exceeded = Object.entries(workflowRun.loop_state?.identical_failure_counts ?? {}).find(([, count]) => count >= policy.max_identical_failures!);
        if (exceeded) {
          return {
            allowed: false,
            reason: `${policy["@id"]} exceeded identical failure cap ${policy.max_identical_failures} at ${exceeded[0]}`,
            escalation_stage_id: policy.escalation_stage_id,
          };
        }
      }
      if ((policy.require_failed_check_policy_ids?.length ?? 0) > 0) {
        const matchedFailed = Object.values(snapshotIndex(workflowRun)).some(
          (snapshot) =>
            policy.require_failed_check_policy_ids!.includes(snapshot.check_policy_id) && snapshot.result_status_id === CHECK_STATUS.failed,
        );
        if (!matchedFailed) {
          return { allowed: false, reason: `${policy["@id"]} requires failed persisted verification check` };
        }
      }
    }

    return { allowed: true, reason: `Transition ${transition["@id"]} allowed`, transition };
  }

  ingestWorkflowRun(_workflowRun: WorkflowRun): void {}

  clearWorkflowRun(_workflowRunId: OntologyId): void {}

  getExecutionLoopPolicy(agentId: OntologyId, toolId?: OntologyId): ExecutionLoopPolicy {
    return this.bundle.policies
      .filter((policy) => policy.policy_kind_id === POLICY_KIND.executionLoop)
      .filter((policy) => this.policyAppliesToAgent(policy, this.getAgent(agentId), this.getRoles(agentId)))
      .filter((policy) => !policy.tool_ids || !toolId || policy.tool_ids.includes(toolId))
      .reduce<ExecutionLoopPolicy>((acc, policy) => ({
        max_identical_invocations: policy.max_identical_invocations ?? acc.max_identical_invocations,
        max_identical_failures: policy.max_identical_failures ?? acc.max_identical_failures,
        max_consecutive_failures: policy.max_consecutive_failures ?? acc.max_consecutive_failures,
      }), {});
  }

  getOutputGovernancePolicy(agentId: OntologyId): OutputGovernancePolicy {
    return this.bundle.policies
      .filter((policy) => policy.policy_kind_id === POLICY_KIND.outputGovernance)
      .filter((policy) => this.policyAppliesToAgent(policy, this.getAgent(agentId), this.getRoles(agentId)))
      .reduce<OutputGovernancePolicy>((acc, policy) => ({
        max_repeated_paragraphs: policy.max_repeated_paragraphs ?? acc.max_repeated_paragraphs,
        max_repeated_sentences: policy.max_repeated_sentences ?? acc.max_repeated_sentences,
        max_self_talk_markers: policy.max_self_talk_markers ?? acc.max_self_talk_markers,
      }), {});
  }

  private getMatchingAuthorizationPolicies(
    agent: AgentDefinition,
    roles: RoleDefinition[],
    request: AuthorizationRequest,
    patterns: string[],
  ): PolicyDefinition[] {
    return this.bundle.policies.filter((policy) => {
      if (policy.policy_kind_id !== POLICY_KIND.authorization) return false;
      if (!this.policyAppliesToAgent(policy, agent, roles)) return false;
      if (policy.tool_ids && !policy.tool_ids.includes(request.toolId)) return false;
      if (!matchesAllPatterns(policy.path_globs, patterns)) return false;
      if (!matchesAllPatterns(policy.command_globs, patterns)) return false;
      return true;
    });
  }

  private getMatchingTransitionPolicies(workflowRun: WorkflowRun, toStageId: OntologyId): PolicyDefinition[] {
    return this.bundle.policies.filter((policy) => {
      if (policy.policy_kind_id !== POLICY_KIND.transition) return false;
      if (policy.workflow_definition_ids && !policy.workflow_definition_ids.includes(workflowRun.definition_id)) return false;
      if (policy.from_stage_ids && !policy.from_stage_ids.includes(workflowRun.stage_id)) return false;
      if (policy.to_stage_ids && !policy.to_stage_ids.includes(toStageId)) return false;
      return true;
    });
  }

  private getAgent(agentId: OntologyId): AgentDefinition {
    const agent = this.bundle.byId.get(agentId);
    if (!agent || agent["@type"] !== ENTITY_TYPES.Agent) {
      throw new Error(`Unknown agent ${agentId}`);
    }
    return agent as AgentDefinition;
  }

  private getRoles(agentId: OntologyId): RoleDefinition[] {
    return this.getAgent(agentId).role_ids
      .map((roleId) => this.bundle.byId.get(roleId))
      .filter((value): value is RoleDefinition => value?.["@type"] === ENTITY_TYPES.Role);
  }

  private policyAppliesToAgent(policy: PolicyDefinition, agent: AgentDefinition, roles: RoleDefinition[]): boolean {
    if (policy.subject_agent_ids && !policy.subject_agent_ids.includes(agent["@id"])) return false;
    if (policy.subject_role_ids && !roles.some((role) => policy.subject_role_ids!.includes(role["@id"]))) return false;
    if (policy.capability_ids && !policy.capability_ids.some((capabilityId) => agent.capability_ids.includes(capabilityId))) return false;
    return true;
  }

  private evaluateRequiredChecks(
    workflowRun: WorkflowRun,
    requiredCheckIds: OntologyId[],
    requiredStatusId: OntologyId,
  ): TransitionDecision {
    for (const requiredCheckId of requiredCheckIds) {
      const snapshot = snapshotIndex(workflowRun)[requiredCheckId];
      if (!snapshot) {
        return { allowed: false, reason: `Missing required persisted check ${requiredCheckId}` };
      }
      if (snapshot.result_status_id !== requiredStatusId) {
        return { allowed: false, reason: `Check ${requiredCheckId} must be ${requiredStatusId}` };
      }
    }
    return { allowed: true, reason: "Required checks satisfied" };
  }
}
