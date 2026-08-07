# @tori-agent/core

Shared core library for `tori-agent`. Owns the deterministic workflow engine, agent spec loading, and artifact tooling.

> **Note:** `npm test` currently fails — no `.test.js` files exist yet. See [AGENTS.md](../AGENTS.md) for the verification flow (`build` → `lint` → `verify-expansion`).

## Entry point

- [`src/index.ts`](../src/index.ts) — exports `buildPlugin()` and public types

## Plugin assembly

- [`buildPlugin()`](../src/index.ts) — creates the plugin object consumed by OpenCode and Kilo Code runtimes. Call this from a runtime wrapper; pass the project root.
- Agent spec loading from [`spec/agents/*.yaml`](../spec/agents) and prompt compilation from [`spec/prompts/**`](../spec/prompts)
- Runtime tool wrapping (lifecycle + workflow tools)

## Workflow state machine

Defined in [`src/tools/workflow.ts`](../src/tools/workflow.ts):

| Function | Purpose |
|----------|---------|
| `createWorkflow` | Create a new workflow artifact from a mission brief |
| `getWorkflowState` | Read current stage, iteration, tasks, and checks |
| `transitionStage` | Advance to the next stage with guard validation |
| `recordTaskResult` | Log task completion or failure |
| `recordCheckResult` | Log verification check outcomes |

## Lifecycle tools

Defined in [`src/tools/lifecycle.ts`](../src/tools/lifecycle.ts):

| Function | Purpose |
|----------|---------|
| `projectState` | Scan specs, exec-plans, briefs, and workflows |
| `checkArtifacts` | Cross-artifact consistency scan |
| `runMechanicalChecks` | Lint + test pre-filter (reads `## Review Checks` from AGENTS.md) |
| `markBlockDone` | Mark an exec-plan block as completed |
| `completePlan` | Set an exec-plan to completed (refuses if unchecked blocks remain) |
| `registerSpec` | Create a new spec file with minimal frontmatter |

## Agent compilation

- [`src/codegen/loader.ts`](../src/codegen/loader.ts) — loads YAML specs, compiles prompts with persona modes
- [`src/codegen/types.ts`](../src/codegen/types.ts) — shared types for compiled agents

## Artifact paths

Managed docs are created automatically on `session.created`:

- `docs/specs` — agent specifications
- `docs/exec-plans` — execution plans
- `docs/briefs` — project briefs
- `docs/workflows` — workflow state files

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run `node --test dist/tests/*.test.js` (currently fails; no test files yet)

## Notes

- This package is the source of truth for shared behavior
- Runtime packages (`runtime-opencode`, `runtime-kilocode`) are thin adapters — do not add logic there
- Do not edit generated `dist/` output
- If you change shared behavior, update this package first, then validate runtime wrappers
- For architecture context, see the [parent README](../README.md)
