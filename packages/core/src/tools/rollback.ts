// packages/core/src/tools/rollback.ts
// rollback tool: systematic revert workflow with commit/stage/workflow levels.

import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, unlink, rm } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import type { WorkflowPaths } from "./workflow.js";
import type { RollbackPlan, RollbackResult } from "../types/rollback.js";

function resolveArtifact(projectRoot: string, relPath: string): string {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

function git(projectRoot: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    shell: false,
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

async function cleanupCheckpoints(projectRoot: string, workflowId: string): Promise<void> {
  const checkpointDir = resolveArtifact(projectRoot, `docs/checkpoints/${workflowId}`);
  try {
    await rm(checkpointDir, { recursive: true, force: true });
  } catch {
    // directory may not exist
  }

  const docsDir = resolveArtifact(projectRoot, "docs/checkpoints");
  try {
    const entries = await readdir(docsDir);
    for (const entry of entries) {
      if (entry.startsWith(`${workflowId}-`) && entry.endsWith(".md")) {
        await unlink(join(docsDir, entry));
      }
    }
  } catch {
    // directory may not exist
  }
}

export async function rollback(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  plan: RollbackPlan,
): Promise<RollbackResult> {
  const actions: string[] = [`rollback requested: level=${plan.level}, workflow=${workflowId}`];

  if (plan.dry_run) {
    actions.push("dry_run: no changes will be executed");
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
    };
  }

  try {
    switch (plan.level) {
      case "commit":
        return await rollbackCommit(projectRoot, workflowId, plan, actions);
      case "stage":
        return await rollbackStage(projectRoot, paths, workflowId, plan, actions);
      case "workflow":
        return await rollbackWorkflow(projectRoot, paths, workflowId, plan, actions);
      default:
        return {
          level: plan.level,
          executed: false,
          actions,
          reverted_commits: [],
          error: `unknown rollback level: ${plan.level}`,
        };
    }
  } catch (err) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: (err as Error).message,
    };
  }
}

async function rollbackCommit(
  projectRoot: string,
  workflowId: string,
  plan: RollbackPlan,
  actions: string[],
): Promise<RollbackResult> {
  if (!plan.target_sha) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: "target_sha required for commit-level rollback",
    };
  }

  const { status, stderr } = git(projectRoot, ["rev-parse", "--verify", plan.target_sha]);
  if (status !== 0) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `invalid target_sha: ${stderr}`,
    };
  }

  const { stdout: logStdout } = git(projectRoot, ["log", "--oneline", `${plan.target_sha}..HEAD`]);
  const revertedCommits = logStdout.trim().split("\n").filter(Boolean);
  actions.push(`revert range: ${plan.target_sha}..HEAD (${revertedCommits.length} commits)`);

  const { status: revertStatus, stderr: revertStderr } = git(projectRoot, [
    "revert",
    "--no-commit",
    "--no-ff",
    `${plan.target_sha}..HEAD`,
  ]);
  if (revertStatus !== 0) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `git revert failed: ${revertStderr}`,
    };
  }

  const { status: commitStatus, stderr: commitStderr } = git(projectRoot, [
    "commit",
    "-m",
    `rollback: revert to ${plan.target_sha}`,
  ]);
  if (commitStatus !== 0) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `git commit failed: ${commitStderr}`,
    };
  }

  actions.push("committed revert");
  return {
    level: plan.level,
    executed: true,
    actions,
    reverted_commits: revertedCommits,
  };
}

async function rollbackStage(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  plan: RollbackPlan,
  actions: string[],
): Promise<RollbackResult> {
  if (!plan.target_stage) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: "target_stage required for stage-level rollback",
    };
  }

  const validStages = ["new", "requirements", "plan", "execute", "verify", "done", "needs_human"];
  if (!validStages.includes(plan.target_stage)) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `invalid target_stage: ${plan.target_stage}`,
    };
  }

  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, "utf-8");
  } catch {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `workflow not found: ${workflowId}`,
    };
  }

  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `malformed workflow frontmatter: ${workflowId}`,
    };
  }

  const [full, open, body, close] = fmMatch;
  const lines = body.split(/\r?\n/);

  const setLine = (key: string, value: string) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyRegex = new RegExp(`^${escapedKey}\\s*:`, "m");
    const idx = lines.findIndex((l) => keyRegex.test(l));
    if (idx !== -1) {
      lines[idx] = `${key}: ${value}`;
    } else {
      lines.push(`${key}: ${value}`);
    }
  };

  setLine("current_stage", plan.target_stage);
  setLine("iteration", "0");
  setLine("deliberation_count", "0");

  let updated = `${open}${lines.join("\n")}${close}`;

  const tasksIdx = updated.indexOf("## Tasks");
  const checksIdx = updated.indexOf("## Checks");
  if (tasksIdx !== -1) {
    const after = checksIdx !== -1 ? updated.slice(checksIdx) : "";
    updated = `${updated.slice(0, tasksIdx)}## Tasks\n\n${after}`;
  }

  await writeFile(absPath, updated, "utf-8");
  actions.push(`reset stage to ${plan.target_stage}, cleared tasks/checks`);

  if (!plan.preserve_checkpoints) {
    await cleanupCheckpoints(projectRoot, workflowId);
    actions.push("removed checkpoint files");
  }

  return {
    level: plan.level,
    executed: true,
    actions,
    reverted_commits: [],
  };
}

async function rollbackWorkflow(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  plan: RollbackPlan,
  actions: string[],
): Promise<RollbackResult> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, "utf-8");
  } catch {
    return {
      level: plan.level,
      executed: false,
      actions,
      reverted_commits: [],
      error: `workflow not found: ${workflowId}`,
    };
  }

  const fm = parseFrontmatter(content);
  const workflowName = fm.workflow ?? "unknown";
  const maxIterations = fm.max_iterations ?? "2";

  const archiveDir = resolveArtifact(projectRoot, join(paths.workflows, "archive"));
  await mkdir(archiveDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archivedName = `${workflowId}-${timestamp}.md`;
  const archivedPath = join(paths.workflows, "archive", archivedName);

  await writeFile(resolveArtifact(projectRoot, archivedPath), content, "utf-8");
  await rm(absPath, { force: true });
  actions.push(`archived workflow to ${archivedPath}`);

  const newWorkflowId = `${workflowId}-${timestamp}`;
  const now = new Date().toISOString().slice(0, 10);
  const newFrontmatter = `---\nid: ${newWorkflowId}\nworkflow: ${workflowName}\ncurrent_stage: new\niteration: 0\nmax_iterations: ${maxIterations}\nstatus: active\ncreated: ${now}\ndeliberation_count: 0\ngit_delivery_state: ${JSON.stringify({ rollback_level: "commit", push_boundary: "manual", last_commit_sha: "" })}\nadrs: []\n---\n\n# Workflow: ${workflowName}\n\n## Tasks\n\n## Checks\n`;

  await writeFile(absPath, newFrontmatter, "utf-8");
  actions.push(`created replacement workflow ${newWorkflowId}`);

  if (!plan.preserve_checkpoints) {
    await cleanupCheckpoints(projectRoot, workflowId);
    actions.push("removed checkpoint files");
  }

  return {
    level: plan.level,
    executed: true,
    actions,
    archived_path: archivedPath,
    new_workflow_id: newWorkflowId,
    reverted_commits: [],
  };
}
