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
   - if runtime paths exist, compiler then loads project-local `runtimeRoot/ontology/*.jsonld`
   - local entity with new `@id` extends graph
   - local entity with matching `@id` replaces earlier builtin entity unless id is immutable builtin safety record
2. `OntologyRegistry` validates and stores strict entities by ontology `@id`
3. `OntologyRuntime` builds host agent configs from ontology
    - resolves single canonical default main-session agent per runtime
    - mutates host config in place with official `default_agent`
    - fails closed when host never binds session to ontology agent through official fields
    - loads prompt text from local `runtimeRoot/ontology/prompts/*.md` before builtin packaged prompt file
    - loads skill markdown from local `runtimeRoot/skills/<name>/SKILL.md` before builtin packaged skill file
    - prompt and skill overrides change text surfaces only; authority for permissions/policies stays in ontology + runtime implementation
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
- `structured_read`: non-authoritative bounded extraction projection for huge structured files; project-root confined, readonly, deterministic truncation, malformed JSON denied for JSON modes
  - semantic class: derived extraction, not parse-tree authority and not policy bypass
  - path authorization still derives from requested file path before execution, so deny policies remain effective
  - JSON extraction modes parse bytes into transient value only to emit bounded projection output
- `save_checkpoint`, `scratchpad`, `write_append`: narrative-only outputs, never live policy or current-state authority

## Local override guardrails

- Local runtime directories are additive/customizing surfaces, not replacement for packaged source tree.
- Runtime does not persist merged builtin ontology back into `.opencode/ontology/` or `.kilocode/ontology/` during bootstrap.
- Generated `.opencode/agents/` output is expansion artifact, not runtime lookup authority.
- Immutable builtin ontology protection is narrow and safety-critical: local JSON-LD cannot replace `agent:tori`, `role:orchestrator`, or `policy:tori-no-direct-mutation`.
- Even when local prompt or skill markdown overrides builtin text, host-native mutation enforcement still depends on ontology grants plus `permission.ask` and `tool.execute.before` hooks.

## Test coverage added/updated

- workflow transition semantics
- policy enforcement by bound session agent at `permission.ask` and `tool.execute.before`
- session binding uses official host surfaces in priority order: `session.created`/`session.updated` session info, `session.next.agent.switched`, then `chat.message.input.agent`
- no repo-side interception of host-native `write` / `edit` / `bash` when host skips official permission/tool hooks
- strict SHACL-like shape validation
- lifecycle/path/consistency behavior
- ontology compilation / expansion verification
