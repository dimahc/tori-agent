import { delegate } from './delegate.js';
import { createWorkflow, getWorkflowState } from './workflow.js';
import type { AgentPermissions } from '../codegen/types.js';
import type { PersonaMatch } from '../types/persona.js';
import type { TaskClassification } from '../types/classification.js';
import { matchPersona, buildHierarchy } from '../runtime/persona-registry.js';
import { loadAgentSpecs } from '../codegen/index.js';
import { setClassification, getClassification, clearClassification } from '../runtime/session-store.js';
import { classifyTask } from '../types/classification.js';

export async function task(
  projectRoot: string,
  paths: { workflows: string },
  workflowId: string,
  taskId: string,
  scope: string,
  persona?: string,
  agent?: string,
  parentCheckpointRef?: string
): Promise<{
  task_id: string;
  agent: string;
  checkpoint_ref: string;
  scope: string;
  effective_permissions: AgentPermissions;
  persona_match?: PersonaMatch;
  classification?: TaskClassification;
}> {
  let resolvedAgent = agent;
  let personaMatch: PersonaMatch | undefined;

  if (!resolvedAgent && persona) {
    const specs = await loadAgentSpecs();
    const hierarchy = buildHierarchy(specs);
    const match = matchPersona(persona, hierarchy);

    if (match && match.confidence >= 0.6) {
      resolvedAgent = match.persona_id;
      personaMatch = match;
    }
  }

  if (!resolvedAgent) {
    throw new Error('No agent specified. Provide `agent` or `persona` parameter.');
  }

  const filePaths: string[] = [];
  const classification = classifyTask(scope, filePaths);

  if (classification.requires_human) {
    clearClassification(taskId);
    return {
      task_id: taskId,
      agent: resolvedAgent,
      checkpoint_ref: '',
      scope,
      effective_permissions: {},
      persona_match: personaMatch,
      classification,
    };
  }

  let effectiveWorkflowId = workflowId;
  const existingWorkflow = await getWorkflowState(projectRoot, paths, effectiveWorkflowId);
  if (!existingWorkflow) {
    if (!effectiveWorkflowId) {
      effectiveWorkflowId = `simple-${taskId}`;
    }
    await createWorkflow(projectRoot, paths, effectiveWorkflowId, {
      workflow: 'simple-delegation',
      current_stage: 'execute',
    });
  }

  const result = await delegate(
    projectRoot,
    paths,
    effectiveWorkflowId,
    taskId,
    resolvedAgent,
    scope,
    parentCheckpointRef || `docs/checkpoints/${effectiveWorkflowId}/${taskId}.md`
  );

  setClassification(taskId, classification);

  return {
    ...result,
    persona_match: personaMatch,
    classification,
  };
}
