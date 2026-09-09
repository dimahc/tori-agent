# @tori-agent/core

Shared core library for `tori-agent`. Owns the deterministic workflow engine, ontology-native agent loading, and artifact tooling.

Strict ontology core library. Build before tests so `dist/` exists.

## Entry point

- [`src/index.ts`](../src/index.ts) — exports `buildPlugin()` and public types

## Plugin assembly

- Plugin assembly builds runtime config from ontology records; ontology-derived canonical fields override host attempts for ontology-owned agents.
- Plugin assembly merges compiled ontology agents into host `agent` config, preserving host-private fields and host-only agents while mutating official `default_agent` metadata in place.
- Builtin agent spec loading always starts from packaged [`spec/ontology/*.jsonld`](../spec/ontology).
- Exact runtime layering:
  1. `packages/ontology/src/index.ts` canonical ids/constants/path semantics
  2. packaged `packages/core/spec/ontology/*.jsonld` builtin ontology graph
  3. project-local `.opencode/ontology/*.jsonld` or `.kilocode/ontology/*.jsonld`
  4. prompt text from local `ontology/prompts/*.md`, else packaged `spec/ontology/prompts/*.md`
  5. skill markdown from local `skills/<name>/SKILL.md`, else packaged `spec/skills/<name>/SKILL.md`
- Project-local ontology loads after builtin graph; matching `@id` overrides builtin entity, new `@id` extends graph.
- Immutable builtin safety records cannot be replaced by local ontology overrides. Current protected ids: `agent:tori`, `role:orchestrator`, `policy:tori-no-direct-mutation`.
- Builtin prompts resolve from packaged `spec/ontology/prompts/`; project-local `ontology/prompts/` wins when same prompt file exists.
- Builtin skills resolve from packaged `spec/skills/`; project-local `skills/` wins when same skill exists.
- Runtime no longer mirrors compiled builtin ontology or copied builtin skills into project runtime directories during bootstrap.
- Runtime tool wrapping (lifecycle + workflow tools)
- Runtime tool wrapping includes ontology-driven loop caps for repeated identical calls and repeated failures.
- Runtime read-only tool set includes `structured_read` for bounded inspection of huge structured files without shell fallback.
- Runtime exposes single default main-session agent resolver. Host must honor `default_agent` and bind actual session agent through earliest official surfaces available: `session.created` / `session.updated` event `properties.info.agent`, `session.next.agent.switched` event `properties.agent`, or `chat.message` metadata. No fallback binds fresh unclaimed sessions at permission boundary; unbound or unknown-agent sessions stay denied.
- Session-title helper still exists as internal utility; not part of strict official plugin ABI.
- Output-governance helper enforces deterministic duplicate/self-talk suppression for final responses when host calls `experimental.text.complete`.

Customization boundaries:

- Local prompts and skills affect loaded text only.
- Tool grants, path globs, command globs, default main-session safety, and policy enforcement still come from ontology + runtime code.
- Generated `.opencode/agents/` or `.kilocode/agents/` files are expansion artifacts for inspection/output, not runtime authority.
- Managed runtime artifacts under `.opencode/` or `.kilocode/` are operational state, not ontology source.
- Copy-ready examples for host config, local ontology JSON-LD, prompt overrides, skill overrides, and `structured_read` fixture usage live in [`../../examples/README.md`](../../examples/README.md).

## Workflow state machine

Defined in [`src/tools/workflow.ts`](../src/tools/workflow.ts):

| Function | Purpose |
| ---------- | --------- |
| `createWorkflowRun` | Create a new ontology-native workflow run |
| `getWorkflowState` | Read current stage, iteration, tasks, and checks for workflow run id |
| `transitionStage` | Advance to the next stage with guard validation |
| `recordTaskResult` | Append task evidence and update authoritative snapshot |
| `recordCheckResult` | Append check evidence and update authoritative snapshot |

## Lifecycle tools

Defined in [`src/tools/lifecycle.ts`](../src/tools/lifecycle.ts):

| Function | Purpose |
| ---------- | --------- |
| `projectState` | Scan specs, exec-plans, briefs, and workflows |
| `checkArtifacts` | Cross-artifact consistency scan |
| `runMechanicalChecks` | Lint + test pre-filter (reads `## Review Checks` from AGENTS.md) |
| `structuredRead` | Bounded readonly extraction for large structured files |
| `markBlockDone` | Mark an exec-plan block as completed |
| `completePlan` | Set an exec-plan to completed (refuses if unchecked blocks remain) |
| `registerSpec` | Create a new spec file with minimal frontmatter |

## `structured_read` contract

Tool registry exposes bounded readonly inspection with args:

- `path` — project-relative path. `filePath` alias also accepted internally.
- `mode` — one of `stat`, `slice_bytes`, `slice_chars`, `json_pointer`, `object_keys`, `pretty`
- `offset` / `length` — optional numeric bounds for slice modes
- `pointer` — optional JSON Pointer for `json_pointer` and `object_keys`

Mode semantics:

- `stat`: returns file kind + byte size only
- `slice_bytes`: reads byte window, returns `data_base64`, UTF-8 preview, byte offsets, truncation metadata
- `slice_chars`: reads UTF-8 text then returns character window
- `json_pointer`: parses full file as JSON, resolves pointer, returns bounded rendered value text + resolved value kind
- `object_keys`: parses JSON, resolves pointer, requires object target, returns bounded key list
- `pretty`: parses JSON, returns bounded pretty-printed text

Hard limits from implementation:

- byte slice max: 8192 bytes
- char slice max: 8192 chars
- rendered JSON max: 16384 chars
- object key max: 256 keys

Guardrails:

- project-root confined: path escape rejected before read
- regular-file only: directories and special files rejected
- JSON modes fail closed on malformed JSON
- no subprocess, shell fallback, writes, or network
- authorization still runs through ontology path policy using path derived from tool args; `structured_read` does not bypass deny rules for `.env` or other sensitive paths
- output is explicitly `authoritative: false`, `readonly: true`, `classification: derived-operational-view`

Practical example inputs and a dense fixture live in [`../../examples/README.md`](../../examples/README.md) and [`../../examples/structured-read/huge-openapi.json`](../../examples/structured-read/huge-openapi.json).

## Agent compilation

- [`src/codegen/loader.ts`](../src/codegen/loader.ts) — loads ontology-native JSON-LD specs from `spec/ontology/`
- [`src/codegen/types.ts`](../src/codegen/types.ts) — shared types for compiled agents

## Artifact paths

Managed docs directories are bootstrapped on `session.created`:

- `.opencode/specs` or `.kilocode/specs` — managed specs
- `.opencode/exec-plans` or `.kilocode/exec-plans` — execution plans
- `.opencode/briefs` or `.kilocode/briefs` — project briefs
- `.opencode/workflows` or `.kilocode/workflows` — per-run workflow directories with snapshot + journal
- `.opencode/workflows/*.jsonld` or `.kilocode/workflows/*.jsonld` — invalid removed Slice 1 format; runtime rejects fail-closed

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run repo tests from workspace root

## Notes

- This package is the source of truth for shared behavior
- Runtime package (`packages/harness`) is a thin adapter — do not add logic there
- Do not edit generated `dist/` output
- If you change shared behavior, update this package first, then validate runtime wrappers
- Workflow transition gating reads snapshot check metadata derived from append-only workflow journal, including blocking vs advisory policy.
- For architecture context, see the [parent README](../README.md)
