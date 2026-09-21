import {
  ENTITY_TYPES,
  type AgentDefinition,
  type OntologyId,
  type ReasoningModeDefinition,
  type RoleDefinition,
} from "@tori-agent/ontology";
import type { OntologyRuntime } from "../ontology/runtime.js";

export function understandAndReformulate(
  originalPrompt: string,
  targetAgent: string,
  runtime: OntologyRuntime,
): string {
  if (!originalPrompt || typeof originalPrompt !== "string" || !originalPrompt.trim()) {
    return originalPrompt;
  }

  const registry = runtime.getRegistry();
  const agent = registry.getAgent(targetAgent as OntologyId);
  if (!agent) {
    return originalPrompt;
  }

  const agentLabel = agent.label ?? targetAgent;

  const roleLabels = agent.role_ids
    .map((roleId) => {
      const role = registry.getRole(roleId);
      return role?.label ?? roleId;
    })
    .filter(Boolean);

  const capabilities = registry.getByType(ENTITY_TYPES.Capability);
  const capabilityLabels = agent.capability_ids
    .map((capabilityId) => {
      const cap = capabilities.find((c) => c["@id"] === capabilityId);
      return cap?.label ?? capabilityId;
    })
    .filter(Boolean);

  let reasoningSection = "";
  const explicitModeId = agent.reasoning_mode_id;
  const sourceRole = explicitModeId
    ? undefined
    : agent.role_ids
        .map((roleId) => registry.getRole(roleId))
        .filter((role): role is RoleDefinition => Boolean(role?.reasoning_mode_id))
        .at(0);
  const modeId = explicitModeId ?? sourceRole?.reasoning_mode_id;
  if (modeId) {
    const reasoningModes = registry.getByType(ENTITY_TYPES.ReasoningMode);
    const mode = reasoningModes.find((r) => r["@id"] === modeId) as ReasoningModeDefinition | undefined;
    if (mode) {
      const principles = mode.principles.length > 0 ? `\nPrinciples:\n${mode.principles.map((p) => `- ${p}`).join("\n")}` : "";
      const forbidden = mode.forbidden_patterns.length > 0 ? `\nForbidden patterns:\n${mode.forbidden_patterns.map((f) => `- ${f}`).join("\n")}` : "";
      const selfCheck = mode.self_check.length > 0 ? `\nSelf-check requirements:\n${mode.self_check.map((s) => `- ${s}`).join("\n")}` : "";
      reasoningSection = `Reasoning mode: ${mode.label}${principles}${forbidden}${selfCheck}`;
    }
  }

  const roleContext = roleLabels.length > 0 ? `Role context: ${roleLabels.join(", ")}` : "";
  const capabilityContext = capabilityLabels.length > 0 ? `Capabilities: ${capabilityLabels.join(", ")}` : "";

  return [
    `Agent: ${agentLabel}`,
    roleContext,
    capabilityContext,
    reasoningSection,
    "",
    originalPrompt,
  ]
    .filter(Boolean)
    .join("\n");
}
