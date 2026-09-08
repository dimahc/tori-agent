import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile, appendFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { ARTIFACT_STATUS, ARTIFACT_TYPE, ONTOLOGY_CONTEXT_IRI, WORKFLOW_STAGE, buildRuntimePaths, type ManagedArtifactFrontmatter, type OntologyId, type RuntimePaths } from "@tori-agent/ontology";
import type {
  ArtifactConsistencyReport,
  ArtifactState,
  ConsistencyIssue,
  ProjectStateReport,
} from "../types/lifecycle.js";
import { listWorkflowRuns } from "./workflow.js";

const exec = promisify(execCallback);

function parseFrontmatter(content: string): { frontmatter: Partial<ManagedArtifactFrontmatter>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  return {
    frontmatter: (parseYaml(match[1]) ?? {}) as Partial<ManagedArtifactFrontmatter>,
    body: content.slice(match[0].length),
  };
}

function serializeFrontmatter(frontmatter: ManagedArtifactFrontmatter): string {
  const lines = [
    `artifact_id: ${frontmatter.artifact_id}`,
    `artifact_type_id: ${frontmatter.artifact_type_id}`,
    `status_id: ${frontmatter.status_id}`,
    `title: ${JSON.stringify(frontmatter.title)}`,
    `created_at: ${frontmatter.created_at}`,
  ];
  if (frontmatter.updated_at) lines.push(`updated_at: ${frontmatter.updated_at}`);
  if (frontmatter.definition_id) lines.push(`definition_id: ${frontmatter.definition_id}`);
  if (frontmatter.workflow_run_id) lines.push(`workflow_run_id: ${frontmatter.workflow_run_id}`);
  if (frontmatter.related_artifact_ids?.length) {
    lines.push("related_artifact_ids:");
    for (const id of frontmatter.related_artifact_ids) lines.push(`  - ${id}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

function countBlocks(body: string): { checked: number; unchecked: number } {
  const checked = (body.match(/- \[[xX]\] /g) ?? []).length;
  const unchecked = (body.match(/- \[ \] /g) ?? []).length;
  return { checked, unchecked };
}

function strictArtifact(frontmatter: Partial<ManagedArtifactFrontmatter>, file: string): ManagedArtifactFrontmatter {
  if (!frontmatter.artifact_id || !frontmatter.artifact_type_id || !frontmatter.status_id || !frontmatter.title || !frontmatter.created_at) {
    throw new Error(`Managed artifact '${file}' missing strict ontology frontmatter`);
  }
  return frontmatter as ManagedArtifactFrontmatter;
}

async function readArtifactFile(filePath: string): Promise<{ frontmatter: ManagedArtifactFrontmatter; body: string }> {
  const content = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  return { frontmatter: strictArtifact(parsed.frontmatter, filePath), body: parsed.body };
}

function artifactStateFrom(frontmatter: ManagedArtifactFrontmatter, file: string, runtimePaths: RuntimePaths, body?: string): ArtifactState {
  const blockCounts = body !== undefined ? countBlocks(body) : { checked: 0, unchecked: 0 };
  return {
    ...frontmatter,
    file,
    runtime_id: runtimePaths.runtimeId,
    checked_blocks: blockCounts.checked,
    unchecked_blocks: blockCounts.unchecked,
  };
}

async function readArtifactDir(dir: string, runtimePaths: RuntimePaths): Promise<ArtifactState[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  const states: ArtifactState[] = [];
  for (const file of files) {
    const { frontmatter, body } = await readArtifactFile(join(dir, file));
    states.push(artifactStateFrom(frontmatter, file, runtimePaths, body));
  }
  return states;
}

function resolveWithin(root: string, file: string): string {
  const resolved = resolve(root, file);
  const normalizedRoot = resolve(root) + sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== resolve(root)) {
    throw new Error(`Path escapes managed root: ${file}`);
  }
  return resolved;
}

export async function projectState(_projectRoot: string, runtimePaths: RuntimePaths): Promise<ProjectStateReport> {
  return {
    runtime_id: runtimePaths.runtimeId,
    specs: await readArtifactDir(runtimePaths.specsDir, runtimePaths),
    exec_plans: await readArtifactDir(runtimePaths.execPlansDir, runtimePaths),
    briefs: await readArtifactDir(runtimePaths.briefsDir, runtimePaths),
    workflow_runs: await listWorkflowRuns(runtimePaths),
  };
}

export async function checkArtifacts(_projectRoot: string, runtimePaths: RuntimePaths): Promise<ArtifactConsistencyReport> {
  const state = await projectState("", runtimePaths);
  const issues: ConsistencyIssue[] = [];
  const artifactIds = new Set<OntologyId>();
  for (const artifact of [...state.specs, ...state.exec_plans, ...state.briefs]) artifactIds.add(artifact.artifact_id);
  for (const workflowRun of state.workflow_runs) artifactIds.add(workflowRun["@id"]);

  for (const artifact of [...state.specs, ...state.exec_plans, ...state.briefs]) {
    for (const ref of artifact.related_artifact_ids ?? []) {
      if (!artifactIds.has(ref)) {
        issues.push({ type: "dead_reference", severity: "error", artifact_id: artifact.artifact_id, reference: ref, message: `Related artifact missing: ${ref}` });
      }
    }
    if (artifact.workflow_run_id && !artifactIds.has(artifact.workflow_run_id)) {
      issues.push({ type: "dead_reference", severity: "error", artifact_id: artifact.artifact_id, reference: artifact.workflow_run_id, message: `Workflow run missing: ${artifact.workflow_run_id}` });
    }
    if (artifact.status_id === ARTIFACT_STATUS.completed && (artifact.unchecked_blocks ?? 0) > 0) {
      issues.push({ type: "stale_status", severity: "error", artifact_id: artifact.artifact_id, message: `Completed artifact still has unchecked plan blocks` });
    }
    if (artifact.artifact_type_id === ARTIFACT_TYPE.execPlan && (!artifact.related_artifact_ids || artifact.related_artifact_ids.length === 0)) {
      issues.push({ type: "missing_link", severity: "warning", artifact_id: artifact.artifact_id, message: `Exec-plan missing links to spec/brief artifacts` });
    }
    if (artifact.artifact_type_id === ARTIFACT_TYPE.spec && artifact.status_id === ARTIFACT_STATUS.draft) {
      const ageMs = Date.now() - Date.parse(artifact.created_at);
      if (ageMs > 30 * 24 * 60 * 60 * 1000) {
        issues.push({ type: "stale_status", severity: "warning", artifact_id: artifact.artifact_id, message: `Draft spec older than 30 days` });
      }
    }
  }

  for (const workflowRun of state.workflow_runs) {
    if (workflowRun.related_artifact_ids.length === 0) {
      issues.push({ type: "missing_link", severity: "warning", artifact_id: workflowRun["@id"], message: `Workflow run has no linked artifacts` });
    }
    if (workflowRun.stage_id === WORKFLOW_STAGE.completed) {
      const linkedArtifacts = [...state.specs, ...state.exec_plans, ...state.briefs].filter((artifact) => workflowRun.related_artifact_ids.includes(artifact.artifact_id));
      if (linkedArtifacts.some((artifact) => artifact.status_id !== ARTIFACT_STATUS.completed && artifact.status_id !== ARTIFACT_STATUS.archived)) {
        issues.push({ type: "stale_status", severity: "warning", artifact_id: workflowRun["@id"], message: `Completed workflow run linked to non-completed artifacts` });
      }
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    summary: issues.length === 0 ? "All ontology-managed artifacts consistent." : `${issues.length} ontology consistency issue(s) found.`,
  };
}

export async function registerSpecImpl(
  _projectRoot: string,
  runtimePaths: RuntimePaths,
  specFile: string,
  title: string,
): Promise<{ created: boolean; file: string; artifact_id: OntologyId }> {
  await mkdir(runtimePaths.specsDir, { recursive: true });
  const target = resolveWithin(runtimePaths.specsDir, specFile);
  try {
    await stat(target);
    throw new Error(`Spec already exists: ${specFile}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const artifactId = `spec:${basename(specFile, ".md")}`;
  const now = new Date().toISOString();
  const frontmatter: ManagedArtifactFrontmatter = {
    artifact_id: artifactId,
    artifact_type_id: ARTIFACT_TYPE.spec,
    status_id: ARTIFACT_STATUS.draft,
    title,
    created_at: now,
  };
  const body = `# ${title}\n\n## Summary\n\n## Requirements\n\n## Verification\n`;
  await writeFile(target, `${serializeFrontmatter(frontmatter)}\n${body}`, "utf8");
  return { created: true, file: target, artifact_id: artifactId };
}

export async function markBlockDone(
  _projectRoot: string,
  runtimePaths: RuntimePaths,
  planFile: string,
  blockName: string,
): Promise<{ artifact_id: OntologyId; checked_blocks: number; unchecked_blocks: number; all_done: boolean }> {
  const target = resolveWithin(runtimePaths.execPlansDir, planFile);
  const { frontmatter, body } = await readArtifactFile(target);
  const pattern = new RegExp(`^- \\[ \\] ${blockName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "m");
  if (!pattern.test(body)) {
    if (new RegExp(`^- \\[x\\] ${blockName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "im").test(body)) {
      const counts = countBlocks(body);
      return { artifact_id: frontmatter.artifact_id, checked_blocks: counts.checked, unchecked_blocks: counts.unchecked, all_done: counts.unchecked === 0 };
    }
    throw new Error(`Plan block not found: ${blockName}`);
  }
  const nextBody = body.replace(pattern, `- [x] ${blockName}`);
  const updated: ManagedArtifactFrontmatter = { ...frontmatter, updated_at: new Date().toISOString() };
  await writeFile(target, `${serializeFrontmatter(updated)}\n${nextBody}`, "utf8");
  const counts = countBlocks(nextBody);
  return { artifact_id: updated.artifact_id, checked_blocks: counts.checked, unchecked_blocks: counts.unchecked, all_done: counts.unchecked === 0 };
}

export async function completePlan(
  _projectRoot: string,
  runtimePaths: RuntimePaths,
  planFile: string,
): Promise<ArtifactState> {
  const target = resolveWithin(runtimePaths.execPlansDir, planFile);
  const { frontmatter, body } = await readArtifactFile(target);
  const counts = countBlocks(body);
  if (counts.unchecked > 0) {
    throw new Error(`Cannot complete plan with ${counts.unchecked} unchecked block(s)`);
  }
  const updated: ManagedArtifactFrontmatter = {
    ...frontmatter,
    status_id: ARTIFACT_STATUS.completed,
    updated_at: new Date().toISOString(),
  };
  await writeFile(target, `${serializeFrontmatter(updated)}\n${body}`, "utf8");
  return artifactStateFrom(updated, basename(target), runtimePaths, body);
}

export async function saveCheckpoint(
  _projectRoot: string,
  runtimePaths: RuntimePaths,
  file: string,
  summary: string,
  remainingWork: string,
): Promise<{ file: string; bytes: number }> {
  await mkdir(runtimePaths.checkpointsDir, { recursive: true });
  const target = resolveWithin(runtimePaths.checkpointsDir, file);
  const payload = {
    "@context": ONTOLOGY_CONTEXT_IRI,
    "@id": `checkpoint:${basename(file).replace(/\.[^.]+$/, "")}`,
    "@type": "Checkpoint",
    summary,
    remaining_work: remainingWork,
    created_at: new Date().toISOString(),
  };
  const content = JSON.stringify(payload, null, 2);
  await writeFile(target, content, "utf8");
  return { file: target, bytes: Buffer.byteLength(content) };
}

export async function writeAppend(projectRoot: string, file: string, content: string): Promise<{ file: string; bytes: number }> {
  const target = resolveWithin(projectRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, content, "utf8");
  const data = await stat(target);
  return { file: target, bytes: data.size };
}

export function splitCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error(`unterminated quote in command: ${command}`);
  if (current) tokens.push(current);
  return tokens;
}

export function truncateOutput(output: string | null | undefined, maxLines = 80): string {
  const normalized = (output ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  const head = lines.slice(0, 20);
  const tail = lines.slice(-20);
  return `${head.join("\n")}\n... (${lines.length - 40} lines omitted) ...\n${tail.join("\n")}`;
}

export interface ReviewCheckDefinition {
  id: string;
  command: string;
  onFailure: "warn" | "fail";
}

export function parseReviewChecks(content: string): ReviewCheckDefinition[] {
  const lines = content.split(/\r?\n/);
  const checks: ReviewCheckDefinition[] = [];
  let inSection = false;
  let pending: ReviewCheckDefinition | null = null;
  for (const line of lines) {
    if (line.startsWith("## Review Checks")) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ") && !line.startsWith("## Review Checks")) {
      break;
    }
    if (!inSection) continue;
    const checkMatch = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
    if (checkMatch) {
      pending = { id: checkMatch[1].trim(), command: checkMatch[2].trim(), onFailure: "fail" };
      checks.push(pending);
      continue;
    }
    const failureMatch = line.match(/^\s*on-failure:\s*(warn|fail)\s*$/);
    if (failureMatch && pending) {
      pending.onFailure = failureMatch[1] as "warn" | "fail";
    }
  }
  return checks;
}

export async function loadReviewChecks(projectRoot: string): Promise<ReviewCheckDefinition[]> {
  const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
  return parseReviewChecks(agentsMd);
}

export async function getReviewCheck(projectRoot: string, checkId: string): Promise<ReviewCheckDefinition | null> {
  const checks = await loadReviewChecks(projectRoot);
  return checks.find((check) => check.id === checkId) ?? null;
}

export async function runMechanicalChecks(projectRoot: string): Promise<{
  ok: boolean;
  checks: Array<{ id: string; command: string; ok: boolean; onFailure: "warn" | "fail"; stdout: string; stderr: string }>;
}> {
  const checks = await loadReviewChecks(projectRoot);
  const results: Array<{ id: string; command: string; ok: boolean; onFailure: "warn" | "fail"; stdout: string; stderr: string }> = [];
  let ok = true;
  for (const check of checks) {
    try {
      const result = await exec(check.command, { cwd: projectRoot, maxBuffer: 1024 * 1024 * 8 });
      results.push({ id: check.id, command: check.command, ok: true, onFailure: check.onFailure, stdout: truncateOutput(result.stdout), stderr: truncateOutput(result.stderr) });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message: string };
      results.push({ id: check.id, command: check.command, ok: false, onFailure: check.onFailure, stdout: truncateOutput(err.stdout), stderr: truncateOutput(err.stderr ?? err.message) });
      if (check.onFailure === "fail") {
        ok = false;
        break;
      }
    }
  }
  return { ok, checks: results };
}

export { buildRuntimePaths };
