# @tori-agent/core

Shared core library for `tori-agent`. This package owns the deterministic workflow engine, agent spec loading, and artifact tooling.

## Entry point

- `src/index.ts` — exports `buildPlugin()` and public types

## What it provides

### Plugin assembly

- `buildPlugin()` — creates the plugin object consumed by OpenCode and Kilo Code runtimes
- Agent spec loading from `spec/agents/*.yaml` and prompt compilation from `spec/prompts/**`
- Runtime tool wrapping (lifecycle + workflow tools)

### Workflow state machine

- `src/tools/workflow.ts` — workflow state management
  - `createWorkflow` — create a new workflow artifact
  - `getWorkflowState` — read current stage, iteration, tasks, checks
  - `transitionStage` — move to next stage with validation
  - `recordTaskResult` — log task completion/failure
  - `recordCheckResult` — log verification check outcomes

### Lifecycle tools

- `src/tools/lifecycle.ts` — artifact bookkeeping
  - `projectState` — scan specs, exec-plans, briefs, workflows
  - `checkArtifacts` — cross-artifact consistency scan
  - `runMechanicalChecks` — lint + test pre-filter
  - `markBlockDone`, `completePlan`, `registerSpec` — write operations (delegated to Scribe)

### Agent compilation

- `src/codegen/loader.ts` — loads YAML specs, compiles prompts with persona modes
- `src/codegen/types.ts` — shared types for compiled agents

### Artifact paths

Managed docs live under:
- `docs/specs` — agent specifications
- `docs/exec-plans` — execution plans
- `docs/briefs` — project briefs
- `docs/workflows` — workflow state files

Directories are created automatically on `session.created`.

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run `node --test dist/tests/*.test.js`

## Notes

- This package is the source of truth for shared behavior
- Runtime packages (`runtime-opencode`, `runtime-kilocode`) are thin adapters
- Do not edit generated `dist/` output
- If you change shared behavior, update this package first, then validate runtime wrappers
