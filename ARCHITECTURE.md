# Architecture

Strict ontology architecture. Single authority: `packages/ontology`.

## Authority order

1. `packages/ontology/src/index.ts` — canonical IDs, enums, shapes, runtime path semantics
2. `packages/core/spec/ontology/*.jsonld` — canonical entity graph using those IDs
3. `packages/core/src/*` — runtime implementation bound to ontology
4. prompts/docs — explanatory only

Prompts do not override ontology. Runtime state does not use legacy free-form stage names.

## Runtime pipeline

1. `OntologyCompiler` loads JSON-LD entities from `packages/core/spec/ontology/`
2. `OntologyRegistry` validates and stores strict entities by ontology `@id`
3. `OntologyRuntime` builds host agent configs from ontology
    - resolves single canonical default main-session agent per runtime
    - mutates host config in place with official `default_agent`
    - fails closed when host never binds session to ontology agent through official fields
4. `PolicyEngineImpl` enforces ontology-derived permission grants and `Policy` records:
   - permission grants by `tool_id`
   - path glob restrictions
   - command glob restrictions
   - authorization deny policies
   - execution loop caps by session-bound agent
   - transition policies over persisted workflow checks, retry counters, no-progress counters, iteration caps
5. Lifecycle/workflow tools persist runtime-managed artifacts and per-run workflow snapshot/journal JSON-LD
6. Harness `experimental.text.complete` hook applies best-effort final-response dedup/self-talk rewrite before host emits assistant text

## Workflow persistence

- Formal workflow state layout: runtime `workflows/<workflow-run-slug>/snapshot.jsonld` plus append-only `journal/*.jsonld`
- Any top-level `workflows/*.jsonld` artifact is invalid legacy format and must be rejected without migration
- Formal workflow terms: `workflow-stage:*`, `workflow-status:*`, `task-status:*`, `check-status:*`
- Transition validation uses declared `WorkflowTransition` entities plus ontology `Policy` records and snapshot current-state check metadata

## Path semantics

Runtime root chosen from runtime id:

- `opencode -> .opencode`
- `kilocode -> .kilocode`

All managed paths derive from canonical `buildRuntimePaths()` in `packages/ontology`.

## Verification semantics

- `run_mechanical_checks`: executes repo-declared commands from `AGENTS.md`
- `check_artifacts`: derived scan report with provenance over ontology links/status consistency across markdown artifacts and workflow runs
- `trigger_ci_check`: executes predeclared safe verification check by id and records ontology-native check result

## Derived operational surfaces

- `workflow_state`: non-authoritative projection with explicit sections for `snapshot` authority, `journal_evidence`, and `latest_projections`
- `project_state`: non-authoritative filesystem scan projection with source provenance
- `check_artifacts`: non-authoritative consistency projection derived from `project_state`
- `save_checkpoint`, `scratchpad`, `write_append`: narrative-only outputs, never live policy or current-state authority

## Test coverage added/updated

- workflow transition semantics
- policy enforcement by bound session agent at `permission.ask` and `tool.execute.before`
- new-session binding depends on host honoring `default_agent` and passing `chat.message.input.agent`
- no repo-side interception of host-native `write` / `edit` / `bash` when host skips official permission/tool hooks
- strict SHACL-like shape validation
- lifecycle/path/consistency behavior
- ontology compilation / expansion verification
