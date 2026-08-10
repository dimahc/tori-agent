import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import type { DelegationTree, DelegationNode } from "../types/delegation.js";
import { DepthExceededError } from "../types/delegation.js";
import type { Checkpoint } from "../types/checkpoint.js";
import type { CheckpointResult } from "./lifecycle.js";
import { getWorkflowState } from "./workflow.js";
import { writeCheckpoint } from "./checkpoint.js";
import { loadAgentSpecs } from "../codegen/index.js";
import type { AgentPermissions } from "../codegen/types.js";
import { mergePermissionSets } from "../runtime/permissions.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

function resolveArtifact(projectRoot: string, relPath: string): string {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

function serializeDelegationTree(tree: DelegationTree): string {
  return JSON.stringify(tree);
}

function setFrontmatterField(content: string, key: string, value: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) {
    return `---${eol}${key}: ${value}${eol}---${eol}${eol}${content}`;
  }
  const [full, open, body, close] = fmMatch;
  const lines = body.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRegex = new RegExp(`^${escapedKey}\\s*:`, "m");
  const idx = lines.findIndex((l) => keyRegex.test(l));
  if (idx !== -1) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  return content.replace(full, `${open}${lines.join(eol)}${close}`);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function delegate(
  projectRoot: string,
  paths: { workflows: string },
  workflowId: string,
  taskId: string,
  agent: string,
  scope: string,
  parentCheckpointRef: string
): Promise<{ task_id: string; agent: string; checkpoint_ref: string; scope: string; effective_permissions: AgentPermissions }> {
  const workflowFile = await getWorkflowState(projectRoot, paths, workflowId);
  if (!workflowFile) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  let tree: DelegationTree;
  if (workflowFile.delegation_tree) {
    tree = workflowFile.delegation_tree;
  } else {
    tree = {
      root: taskId,
      max_depth: 5,
      current_depth: 0,
      nodes: {},
    };
  }

  const parentNode = tree.nodes[taskId];
  const parentDepth = parentNode ? parentNode.depth : 0;
  const childDepth = parentDepth + 1;

  if (childDepth > tree.max_depth) {
    throw new DepthExceededError(childDepth, tree.max_depth, workflowId);
  }

  const sentenceCount = scope.split(".").filter((s) => s.trim().length > 0).length;
  if (sentenceCount > 2) {
    throw new Error(`Scope must be ≤ 2 sentences, got ${sentenceCount}`);
  }

  const childTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const checkpointRef = `docs/checkpoints/${workflowId}/${childTaskId}.md`;

  const childNode: DelegationNode = {
    task_id: childTaskId,
    parent_id: taskId,
    depth: childDepth,
    agent,
    scope,
    children: [],
    checkpoint_ref: checkpointRef,
  };

  if (parentNode) {
    parentNode.children.push(childTaskId);
  }

  tree.nodes[childTaskId] = childNode;
  tree.current_depth = Math.max(tree.current_depth, childDepth);

  const parentTask = workflowFile.tasks.find((t) => t.id === taskId);

  let effectivePermissions: AgentPermissions = {};
  try {
    const specs = await loadAgentSpecs();
    const parentAgentId = parentTask?.agent || agent;
    const parentSpec = specs.find((s) => s.id === parentAgentId);
    const childSpec = specs.find((s) => s.id === agent);
    if (parentSpec && childSpec) {
      effectivePermissions = mergePermissionSets(parentSpec.permissions, childSpec.permissions);
    }
  } catch {
    // permission merge is best-effort; delegation proceeds without it
  }

  const checkpoint: Checkpoint = {
    version: "1.0",
    created_at: new Date().toISOString(),
    trigger: "delegation",
    parent: {
      task_id: taskId,
      agent: parentTask?.agent || agent,
      depth: childDepth - 1,
      checkpoint_ref: parentCheckpointRef,
    },
    state: {
      todowrite: [],
      workflow_stage: workflowFile.state.current_stage,
      iteration: workflowFile.state.iteration,
      artifacts_modified: [],
      decisions: [],
    },
    context_summary: scope,
    resume_instructions: `Resume execution for delegated task ${childTaskId}`,
    child_tasks: [],
  };

  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  const [, content] = await Promise.all([
    writeCheckpoint(projectRoot, checkpointRef, checkpoint),
    readFile(absPath, "utf-8"),
  ]);

  const updated = setFrontmatterField(content, "delegation_tree", serializeDelegationTree(tree));
  await writeFile(absPath, updated, "utf-8");

  return { task_id: childTaskId, agent, checkpoint_ref: checkpointRef, scope, effective_permissions: effectivePermissions };
}
