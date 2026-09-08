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
4. `PolicyEngineImpl` enforces ontology-derived permission grants and `Policy` records:
   - permission grants by `tool_id`
   - path glob restrictions
   - command glob restrictions
   - authorization deny policies
   - transition policies over persisted workflow checks
5. Lifecycle/workflow tools persist runtime-managed artifacts and workflow-run JSON-LD

## Workflow persistence

- Formal workflow state file: JSON-LD in runtime `workflows/`
- Formal workflow terms: `workflow-stage:*`, `workflow-status:*`, `task-status:*`, `check-status:*`
- Transition validation uses declared `WorkflowTransition` entities plus ontology `Policy` records and persisted check metadata

## Path semantics

Runtime root chosen from runtime id:

- `opencode -> .opencode`
- `kilocode -> .kilocode`

All managed paths derive from canonical `buildRuntimePaths()` in `packages/ontology`.

## Verification semantics

- `run_mechanical_checks`: executes repo-declared commands from `AGENTS.md`
- `check_artifacts`: scans ontology links/status consistency across markdown artifacts and workflow runs
- `trigger_ci_check`: executes configured CI command and records ontology-native check result

## Test coverage added/updated

- workflow transition semantics
- policy enforcement by bound session agent
- strict SHACL-like shape validation
- lifecycle/path/consistency behavior
- ontology compilation / expansion verification
