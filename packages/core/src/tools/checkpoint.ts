// packages/core/src/tools/checkpoint.ts
// write_checkpoint tool: serializes a Checkpoint to a structured markdown file
// with YAML frontmatter (machine-readable) and human-readable body sections.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import type { Checkpoint } from "../types/checkpoint.js";
import type { CheckpointResult } from "./lifecycle.js";

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

// ── Serialization helpers ────────────────────────────────────────────────────

function yamlString(value: string): string {
  // Wrap in double quotes and escape interior quotes/backslashes.
  // Safe for frontmatter values that are JSON strings or simple scalars.
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function serializeCheckpoint(checkpoint: Checkpoint): string {
  // Frontmatter: structured metadata for machine parsing.
  // Nested objects are stored as compact JSON strings.
  const fmLines = [
    `version: ${yamlString(checkpoint.version)}`,
    `created_at: ${yamlString(checkpoint.created_at)}`,
    `trigger: ${yamlString(checkpoint.trigger)}`,
    `parent: ${yamlString(JSON.stringify(checkpoint.parent))}`,
    `state: ${yamlString(JSON.stringify(checkpoint.state))}`,
    `child_tasks: ${yamlString(JSON.stringify(checkpoint.child_tasks))}`,
  ];

  const frontmatter = `---\n${fmLines.join("\n")}\n---`;

  // Body: human-readable sections for resume context.
  const todowriteLines = checkpoint.state.todowrite.map(
    (item) => `- [${item.status === "done" ? "x" : " "}] ${item.id}: ${item.text}`
  );

  const decisionsLines = checkpoint.state.decisions.map(
    (item) => `- ${item.id}: ${item.description}${item.rationale ? ` (${item.rationale})` : ""}`
  );

  const childTasksLines = checkpoint.child_tasks.map(
    (item) => `- ${item.task_id} (${item.agent}): ${item.scope}`
  );

  const body = [
    "## Context Summary",
    "",
    checkpoint.context_summary || "(empty)",
    "",
    "## Resume Instructions",
    "",
    checkpoint.resume_instructions || "(none)",
    "",
    "## TODOWrite State",
    "",
    ...(todowriteLines.length > 0 ? todowriteLines : ["(empty)"]),
    "",
    "## Decisions",
    "",
    ...(decisionsLines.length > 0 ? decisionsLines : ["(none)"]),
    "",
    "## Child Tasks",
    "",
    ...(childTasksLines.length > 0 ? childTasksLines : ["(none)"]),
    "",
  ].join("\n");

  return `${frontmatter}\n\n${body}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * write_checkpoint — serialize a Checkpoint to a markdown file.
 *
 * @param projectRoot - Absolute or relative project root (used for path validation).
 * @param relPath - Relative path within the project where the checkpoint file is written.
 * @param checkpoint - The Checkpoint object to serialize.
 * @returns { file, bytes } matching the existing CheckpointResult shape.
 */
export async function writeCheckpoint(
  projectRoot: string,
  relPath: string,
  checkpoint: Checkpoint
): Promise<CheckpointResult> {
  const absPath = resolveArtifact(projectRoot, relPath);
  const dir = dirname(absPath);
  await mkdir(dir, { recursive: true });

  const content = serializeCheckpoint(checkpoint);
  await writeFile(absPath, content, "utf-8");

  return { file: relPath, bytes: Buffer.byteLength(content, "utf-8") };
}
