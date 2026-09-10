import {
  BOUNDED_COGNITION_CAPABILITY,
  CHECK_STATUS,
  POLICY_EFFECT,
  POLICY_KIND,
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

interface CompiledMatcher {
  readonly regexes?: readonly RegExp[];
}

interface CompiledGrant {
  readonly grant: PermissionGrant;
  readonly pathMatcher: CompiledMatcher;
  readonly commandMatcher: CompiledMatcher;
}

interface CompiledPolicy {
  readonly index: number;
  readonly policy: PolicyDefinition;
  readonly pathMatcher: CompiledMatcher;
  readonly commandMatcher: CompiledMatcher;
}

interface AgentPolicyContext {
  readonly agent: AgentDefinition;
  readonly roles: RoleDefinition[];
}

interface ToolClassification {
  readonly investigation: boolean;
  readonly search: boolean;
  readonly clarification: boolean;
}

function compileGlob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, ".*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function compileMatcher(patterns?: string[]): CompiledMatcher {
  if (!patterns || patterns.length === 0) return {};
  return {
    regexes: patterns.map((pattern) => compileGlob(pattern)),
  };
}

function matchesAny(matcher: CompiledMatcher, value: string): boolean {
  if (!matcher.regexes || matcher.regexes.length === 0) return true;
  return matcher.regexes.some((regex) => regex.test(value));
}

function normalizePatterns(pattern?: string | string[]): string[] {
  if (!pattern) return [];
  return Array.isArray(pattern) ? pattern : [pattern];
}

function matchesAllPatterns(matcher: CompiledMatcher, requestPatterns: string[]): boolean {
  if (!matcher.regexes || matcher.regexes.length === 0) return true;
  if (requestPatterns.length === 0) return false;
  return requestPatterns.every((pattern) => matchesAny(matcher, pattern));
}

function snapshotIndex(workflowRun: WorkflowRun): Record<string, PersistedWorkflowCheckSnapshot> {
  return workflowRun.check_state_index ?? {};
}

export class PolicyEngineImpl implements PolicyEngine {
  private readonly agentsById = new Map<OntologyId, AgentDefinition>();
  private readonly rolesById = new Map<OntologyId, RoleDefinition>();
  private readonly agentContexts = new Map<OntologyId, AgentPolicyContext>();
  private readonly grantsByAgentAndTool = new Map<OntologyId, Map<OntologyId, CompiledGrant[]>>();
  private readonly authorizationPolicies: CompiledPolicy[] = [];
  private readonly transitionPolicies: CompiledPolicy[] = [];
  private readonly executionPolicies: PolicyDefinition[] = [];
  private readonly outputPolicies: PolicyDefinition[] = [];
  private readonly transitionsByKey = new Map<string, OntologyBundle["workflowTransitions"][number]>();
  private readonly transitionPoliciesByKey = new Map<string, CompiledPolicy[]>();
  private readonly executionLoopPolicyCache = new Map<string, ExecutionLoopPolicy>();
  private readonly outputGovernancePolicyCache = new Map<OntologyId, OutputGovernancePolicy>();
  private readonly toolClassifications = new Map<OntologyId, ToolClassification>();

  constructor(private readonly bundle: OntologyBundle) {
    for (const agent of bundle.agents) {
      this.agentsById.set(agent["@id"], agent);
    }
    for (const role of bundle.roles) {
      this.rolesById.set(role["@id"], role);
    }
    for (const agent of bundle.agents) {
      const roles = agent.role_ids
        .map((roleId) => this.rolesById.get(roleId))
        .filter((value): value is RoleDefinition => Boolean(value));
      this.agentContexts.set(agent["@id"], { agent, roles });

      const grantsByTool = new Map<OntologyId, CompiledGrant[]>();
      for (const role of roles) {
        for (const grant of role.permission_grants) {
          const compiled: CompiledGrant = {
            grant,
            pathMatcher: compileMatcher(grant.path_globs),
            commandMatcher: compileMatcher(grant.command_globs),
          };
          const grants = grantsByTool.get(grant.tool_id);
          if (grants) {
            grants.push(compiled);
          } else {
            grantsByTool.set(grant.tool_id, [compiled]);
          }
        }
      }
      this.grantsByAgentAndTool.set(agent["@id"], grantsByTool);
    }

    for (const [index, policy] of bundle.policies.entries()) {
      switch (policy.policy_kind_id) {
        case POLICY_KIND.authorization:
          this.authorizationPolicies.push({
            index,
            policy,
            pathMatcher: compileMatcher(policy.path_globs),
            commandMatcher: compileMatcher(policy.command_globs),
          });
          break;
        case POLICY_KIND.transition:
          this.transitionPolicies.push({
            index,
            policy,
            pathMatcher: compileMatcher(policy.path_globs),
            commandMatcher: compileMatcher(policy.command_globs),
          });
          break;
        case POLICY_KIND.executionLoop:
          this.executionPolicies.push(policy);
          break;
        case POLICY_KIND.outputGovernance:
          this.outputPolicies.push(policy);
          break;
        default:
          break;
      }
    }

    for (const transition of bundle.workflowTransitions) {
      this.transitionsByKey.set(this.transitionKey(transition.workflow_definition_id, transition.from_stage_id, transition.to_stage_id), transition);
    }

    for (const tool of bundle.tools) {
      this.toolClassifications.set(tool["@id"], {
        investigation: tool.capability_ids.includes(BOUNDED_COGNITION_CAPABILITY.investigation),
        search: tool.capability_ids.includes(BOUNDED_COGNITION_CAPABILITY.search),
        clarification: tool.capability_ids.includes(BOUNDED_COGNITION_CAPABILITY.clarification),
      });
    }

    for (const compiledPolicy of this.transitionPolicies) {
      const policy = compiledPolicy.policy;
      const workflowIds = policy.workflow_definition_ids?.length ? policy.workflow_definition_ids : ["*"];
      const fromStageIds = policy.from_stage_ids?.length ? policy.from_stage_ids : ["*"];
      const toStageIds = policy.to_stage_ids?.length ? policy.to_stage_ids : ["*"];
      for (const workflowId of workflowIds) {
        for (const fromStageId of fromStageIds) {
          for (const toStageId of toStageIds) {
            const key = this.transitionKey(workflowId, fromStageId, toStageId);
            const policies = this.transitionPoliciesByKey.get(key);
            if (policies) {
              policies.push(compiledPolicy);
            } else {
              this.transitionPoliciesByKey.set(key, [compiledPolicy]);
            }
          }
        }
      }
    }
  }

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    const context = this.agentContexts.get(request.agentId);
    if (!context) {
      return { effect: "deny", matchedGrantIds: [], reason: `Unknown agent ${request.agentId}` };
    }

    const grantMatches: PermissionGrant[] = [];
    const patterns = normalizePatterns(request.pattern);

    const denyPolicies = this.getMatchingAuthorizationPolicies(context, request, patterns)
      .filter((policy) => policy.effect === POLICY_EFFECT.deny);

    if (denyPolicies.length > 0) {
      const last = denyPolicies[denyPolicies.length - 1];
      return {
        effect: "deny",
        matchedGrantIds: denyPolicies.map((policy) => policy["@id"]),
        reason: `${request.toolName} denied by ${last["@id"]}`,
      };
    }

    const grants = this.grantsByAgentAndTool.get(request.agentId)?.get(request.toolId) ?? [];
    for (const compiledGrant of grants) {
      if (patterns.length > 0 && !matchesAllPatterns(compiledGrant.pathMatcher, patterns)) continue;
      if (patterns.length > 0 && !matchesAllPatterns(compiledGrant.commandMatcher, patterns)) continue;
      grantMatches.push(compiledGrant.grant);
    }

    if (grantMatches.length === 0 && request.toolId !== request.toolName) {
      const fallbackGrants = this.grantsByAgentAndTool.get(request.agentId)?.get(request.toolName) ?? [];
      for (const compiledGrant of fallbackGrants) {
        if (patterns.length > 0 && !matchesAllPatterns(compiledGrant.pathMatcher, patterns)) continue;
        if (patterns.length > 0 && !matchesAllPatterns(compiledGrant.commandMatcher, patterns)) continue;
        grantMatches.push(compiledGrant.grant);
      }
    }

    const allowGrant = grantMatches.find((grant) => grant.effect === POLICY_EFFECT.allow);
    if (allowGrant) {
      return {
        effect: "allow",
        matchedGrantIds: grantMatches.map((grant) => grant["@id"]),
        reason: `${request.toolName} allowed by ${allowGrant["@id"]}`,
      };
    }

    const askPolicies = this.getMatchingAuthorizationPolicies(context, request, patterns)
      .filter((policy) => policy.effect === POLICY_EFFECT.ask);

    const askGrant = grantMatches.find((grant) => grant.effect === POLICY_EFFECT.ask);
    if (askGrant || askPolicies.length > 0) {
      const decider = askGrant ?? askPolicies[askPolicies.length - 1];
      return {
        effect: "ask",
        matchedGrantIds: [...grantMatches.map((grant) => grant["@id"]), ...askPolicies.map((policy) => policy["@id"])],
        reason: `${request.toolName} pending approval by ${decider["@id"]}`,
      };
    }

    if (grantMatches.length === 0) {
      return { effect: "deny", matchedGrantIds: [], reason: `No permission grant for ${request.toolName}` };
    }

    return {
      effect: "deny",
      matchedGrantIds: grantMatches.map((grant) => grant["@id"]),
      reason: `${request.toolName} denied by ${grantMatches[grantMatches.length - 1]["@id"]}`,
    };
  }

  canTransition(workflowRun: WorkflowRun, toStageId: OntologyId): TransitionDecision {
    const transition = this.transitionsByKey.get(this.transitionKey(workflowRun.definition_id, workflowRun.stage_id, toStageId));

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
    const cacheKey = `${agentId}:${toolId ?? "*"}`;
    const cached = this.executionLoopPolicyCache.get(cacheKey);
    if (cached) return { ...cached };

    const context = this.getAgentContext(agentId);
    const computed = this.executionPolicies
      .filter((policy) => this.policyAppliesToAgent(policy, context))
      .filter((policy) => !policy.tool_ids || !toolId || policy.tool_ids.includes(toolId))
      .reduce<ExecutionLoopPolicy>((acc, policy) => ({
        max_identical_invocations: policy.max_identical_invocations ?? acc.max_identical_invocations,
        max_identical_failures: policy.max_identical_failures ?? acc.max_identical_failures,
        max_consecutive_failures: policy.max_consecutive_failures ?? acc.max_consecutive_failures,
        max_investigation_actions: policy.max_investigation_actions ?? acc.max_investigation_actions,
        max_search_actions: policy.max_search_actions ?? acc.max_search_actions,
        max_speculation_actions: policy.max_speculation_actions ?? acc.max_speculation_actions,
        max_missing_context_failures: policy.max_missing_context_failures ?? acc.max_missing_context_failures,
        escalation_stage_id: policy.escalation_stage_id ?? acc.escalation_stage_id,
      }), {});
    this.executionLoopPolicyCache.set(cacheKey, computed);
    return { ...computed };
  }

  getOutputGovernancePolicy(agentId: OntologyId): OutputGovernancePolicy {
    const cached = this.outputGovernancePolicyCache.get(agentId);
    if (cached) return { ...cached };

    const context = this.getAgentContext(agentId);
    const computed = this.outputPolicies
      .filter((policy) => this.policyAppliesToAgent(policy, context))
      .reduce<OutputGovernancePolicy>((acc, policy) => ({
        max_repeated_paragraphs: policy.max_repeated_paragraphs ?? acc.max_repeated_paragraphs,
        max_repeated_sentences: policy.max_repeated_sentences ?? acc.max_repeated_sentences,
        max_self_talk_markers: policy.max_self_talk_markers ?? acc.max_self_talk_markers,
      }), {});
    this.outputGovernancePolicyCache.set(agentId, computed);
    return { ...computed };
  }

  classifyTool(toolId: OntologyId): ToolClassification {
    return this.toolClassifications.get(toolId) ?? {
      investigation: false,
      search: false,
      clarification: false,
    };
  }

  private getMatchingAuthorizationPolicies(
    context: AgentPolicyContext,
    request: AuthorizationRequest,
    patterns: string[],
  ): PolicyDefinition[] {
    return this.authorizationPolicies.flatMap(({ policy, pathMatcher, commandMatcher }) => {
      if (!this.policyAppliesToAgent(policy, context)) return [];
      if (policy.tool_ids && !policy.tool_ids.includes(request.toolId)) return [];
      if (!matchesAllPatterns(pathMatcher, patterns)) return [];
      if (!matchesAllPatterns(commandMatcher, patterns)) return [];
      return [policy];
    });
  }

  private getMatchingTransitionPolicies(workflowRun: WorkflowRun, toStageId: OntologyId): PolicyDefinition[] {
    const keys = [
      this.transitionKey(workflowRun.definition_id, workflowRun.stage_id, toStageId),
      this.transitionKey(workflowRun.definition_id, workflowRun.stage_id, "*"),
      this.transitionKey(workflowRun.definition_id, "*", toStageId),
      this.transitionKey(workflowRun.definition_id, "*", "*"),
      this.transitionKey("*", workflowRun.stage_id, toStageId),
      this.transitionKey("*", workflowRun.stage_id, "*"),
      this.transitionKey("*", "*", toStageId),
      this.transitionKey("*", "*", "*"),
    ];
    const seen = new Set<OntologyId>();
    const matches: CompiledPolicy[] = [];
    for (const key of keys) {
      for (const policy of this.transitionPoliciesByKey.get(key) ?? []) {
        if (seen.has(policy.policy["@id"])) continue;
        seen.add(policy.policy["@id"]);
        if (policy.policy.workflow_definition_ids && !policy.policy.workflow_definition_ids.includes(workflowRun.definition_id)) continue;
        if (policy.policy.from_stage_ids && !policy.policy.from_stage_ids.includes(workflowRun.stage_id)) continue;
        if (policy.policy.to_stage_ids && !policy.policy.to_stage_ids.includes(toStageId)) continue;
        matches.push(policy);
      }
    }
    matches.sort((left, right) => left.index - right.index);
    return matches.map((entry) => entry.policy);
  }

  private policyAppliesToAgent(policy: PolicyDefinition, context: AgentPolicyContext): boolean {
    if (policy.subject_agent_ids && !policy.subject_agent_ids.includes(context.agent["@id"])) return false;
    if (policy.subject_role_ids && !context.roles.some((role) => policy.subject_role_ids!.includes(role["@id"]))) return false;
    if (policy.capability_ids && !policy.capability_ids.some((capabilityId) => context.agent.capability_ids.includes(capabilityId))) return false;
    return true;
  }

  private getAgentContext(agentId: OntologyId): AgentPolicyContext {
    const context = this.agentContexts.get(agentId);
    if (!context) {
      throw new Error(`Unknown agent ${agentId}`);
    }
    return context;
  }

  private transitionKey(workflowDefinitionId: OntologyId | "*", fromStageId: OntologyId | "*", toStageId: OntologyId | "*"): string {
    return `${workflowDefinitionId}|${fromStageId}|${toStageId}`;
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
