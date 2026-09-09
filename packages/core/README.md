# @tori-agent/core

Shared core library for `tori-agent`. Owns the deterministic workflow engine, ontology-native agent loading, and artifact tooling.

Strict ontology core library. Build before tests so `dist/` exists.

## Entry point

- [`src/index.ts`](../src/index.ts) — exports `buildPlugin()` and public types

## Plugin assembly

- Plugin assembly builds runtime config from ontology records; ontology-derived canonical fields override host attempts for ontology-owned agents.
- Plugin assembly merges compiled ontology agents into host `agent` config, preserving host-private fields and host-only agents while emitting canonical default-main-agent metadata.
- Builtin agent spec loading always starts from packaged [`spec/ontology/*.jsonld`](../spec/ontology).
- Project-local ontology from `.opencode/ontology/` or `.kilocode/ontology/` loads after builtin graph; matching `@id` overrides builtin entity, new `@id` extends graph.
- Builtin prompts resolve from packaged `spec/ontology/prompts/`; project-local `ontology/prompts/` wins when same prompt file exists.
- Builtin skills resolve from packaged `spec/skills/`; project-local `skills/` wins when same skill exists.
- Runtime no longer mirrors compiled builtin ontology or copied builtin skills into project runtime directories during bootstrap.
- Runtime tool wrapping (lifecycle + workflow tools)
- Runtime tool wrapping includes ontology-driven loop caps for repeated identical calls and repeated failures.
- Runtime exposes single default main-session agent resolver. Host must bind that agent before first turn through `session.agent`, `session.created` output, or explicit `chat.message` agent metadata. No fallback binds fresh unclaimed sessions at permission boundary; unbound or unknown-agent sessions stay denied with explicit reason.
- Session-title helper derives deterministic rename proposals from first meaningful user request and never falls back to random or timestamp naming.
- Assistant-output helper enforces deterministic duplicate/self-talk suppression for final responses when host calls `assistant.output`.

## Workflow state machine

Defined in [`src/tools/workflow.ts`](../src/tools/workflow.ts):

| Function | Purpose |
| ---------- | --------- |
| `createWorkflowRun` | Create a new ontology-native workflow run |
| `getWorkflowState` | Read current stage, iteration, tasks, and checks |
| `transitionStage` | Advance to the next stage with guard validation |
| `recordTaskResult` | Log task completion or failure |
| `recordCheckResult` | Log verification check outcomes |

## Lifecycle tools

Defined in [`src/tools/lifecycle.ts`](../src/tools/lifecycle.ts):

| Function | Purpose |
| ---------- | --------- |
| `projectState` | Scan specs, exec-plans, briefs, and workflows |
| `checkArtifacts` | Cross-artifact consistency scan |
| `runMechanicalChecks` | Lint + test pre-filter (reads `## Review Checks` from AGENTS.md) |
| `markBlockDone` | Mark an exec-plan block as completed |
| `completePlan` | Set an exec-plan to completed (refuses if unchecked blocks remain) |
| `registerSpec` | Create a new spec file with minimal frontmatter |

## Agent compilation

- [`src/codegen/loader.ts`](../src/codegen/loader.ts) — loads ontology-native JSON-LD specs from `spec/ontology/`
- [`src/codegen/types.ts`](../src/codegen/types.ts) — shared types for compiled agents

## Artifact paths

Managed docs are created automatically on `session.created`:

- `.opencode/specs` or `.kilocode/specs` — managed specs
- `.opencode/exec-plans` or `.kilocode/exec-plans` — execution plans
- `.opencode/briefs` or `.kilocode/briefs` — project briefs
- `.opencode/workflows` or `.kilocode/workflows` — workflow state files

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run repo tests from workspace root

## Notes

- This package is the source of truth for shared behavior
- Runtime package (`packages/harness`) is a thin adapter — do not add logic there
- Do not edit generated `dist/` output
- If you change shared behavior, update this package first, then validate runtime wrappers
- Workflow transition gating reads persisted check metadata from workflow JSON-LD, including blocking vs advisory policy.
- For architecture context, see the [parent README](../README.md)
