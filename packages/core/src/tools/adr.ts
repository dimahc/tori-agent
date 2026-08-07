// packages/core/src/tools/adr.ts
// register_adr tool: writes a structured ADR markdown file with YAML frontmatter.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";

function resolveArtifact(projectRoot: string, relPath: string): string {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function serializeADR(adr: import("../types/adr.js").ADR): string {
  const fmLines = [
    `id: ${yamlString(adr.id)}`,
    `title: ${yamlString(adr.title)}`,
    `status: ${yamlString(adr.status)}`,
    `date: ${yamlString(adr.date)}`,
    `related_adrs: ${yamlString(JSON.stringify(adr.related_adrs))}`,
  ];

  const frontmatter = `---\n${fmLines.join("\n")}\n---`;

  const body = [
    "# " + adr.title,
    "",
    "## Context",
    "",
    adr.context || "(empty)",
    "",
    "## Decision",
    "",
    adr.decision || "(empty)",
    "",
    "## Rationale",
    "",
    adr.rationale || "(empty)",
    "",
    "## Consequences",
    "",
    adr.consequences || "(empty)",
    "",
  ].join("\n");

  return `${frontmatter}\n\n${body}`;
}

export async function registerADR(
  projectRoot: string,
  relPath: string,
  adr: import("../types/adr.js").ADR,
): Promise<import("../types/adr.js").RegisterADRResult> {
  const absPath = resolveArtifact(projectRoot, relPath);
  const dir = dirname(absPath);
  await mkdir(dir, { recursive: true });

  const content = serializeADR(adr);
  await writeFile(absPath, content, "utf-8");

  return { file: relPath, bytes: Buffer.byteLength(content, "utf-8") };
}
