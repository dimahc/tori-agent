# tori-agent

`tori-agent` now runs on strict ontology contract only. No legacy workflow terms, no compatibility shims, no prompt-defined authority.

## Core model

- Canonical contract package: `packages/ontology`
- Runtime logic consumes ontology IDs directly
- Managed workflow state persists as per-run JSON-LD directories: authoritative `snapshot.jsonld`, append-only `journal/*.jsonld`
- Policy enforcement is mechanical: tool grants, path globs, command globs, workflow transitions, blocking checks
- Prompts are descriptive only; ontology is authoritative

## Canonical ontology terms

- Workflow definition: `workflow:orchestration-pipeline`
- Workflow stages:
  - `workflow-stage:requirements`
  - `workflow-stage:planning`
  - `workflow-stage:execution`
  - `workflow-stage:verification`
  - `workflow-stage:delivery`
  - `workflow-stage:completed`
  - `workflow-stage:needs-human`
- Blocking check: `check:mechanical`

## Repo architecture

- `packages/ontology` — canonical IDs, context, schema constants, runtime path semantics, ontology shapes
- `packages/core` — compiler, registry, serializer, validator, policy engine, lifecycle/workflow tools, plugin assembly
- `packages/harness` — thin runtime adapter for OpenCode / Kilo Code
- `packages/cli` — separate CLI package

## Harness plugin contract

Harness plugin exposes official OpenCode ABI hooks only:

- `config`
- `event`
- `chat.message`
- `permission.ask`
- `tool.execute.before`
- `experimental.text.complete`

Main-session binding contract:

- ontology declares exactly one default main-session agent per runtime
- builtin default main-session agent is `agent:tori` -> host key `tori`
- `config` mutates host config in place and sets official `default_agent`
- strongest official binding path now uses earliest authoritative host surfaces available:
  - `session.created` / `session.updated` event `properties.info.agent` when host includes session info
  - `session.next.agent.switched` event `properties.agent` when active agent changes
  - `chat.message` `input.agent` remains binding path when host passes it
- no silent fallback binding at `permission.ask`, `tool.execute.before`, or repo authorization path
- unbound or unknown-agent sessions fail closed for ontology-governed permissions
- `event` on `session.created` still bootstraps runtime dirs; if official session agent surface absent, session stays unbound
- host-native mutation tools (`write` / `edit` / `bash`) are enforced through `permission.ask` and `tool.execute.before`

Hard host obligations:

- honor `default_agent` when creating fresh sessions
- pass actual bound agent through official surfaces when host already knows it: session event info, agent-switched event, or `chat.message`
- call `permission.ask` before every host-native `write` / `edit` / `bash` execution
- call `tool.execute.before` before every host-native `write` / `edit` / `bash` execution
- deny execution when `permission.ask` returns `deny`; do not substitute host defaults

Output governance contract:

- host may call `experimental.text.complete` before final response emission
- hook rewrites `output.text` in place as best-effort duplicate/self-talk sanitation
- official ABI path is rewrite-only; no custom retry/block channel
- session title behavior is internal helper logic, not strict plugin ABI

## Managed artifact semantics

Runtime-aware managed roots:

- OpenCode: `.opencode/`
- Kilo Code: `.kilocode/`

Managed directories under runtime root:

- `ontology/`
- `specs/`
- `briefs/`
- `exec-plans/`
- `workflows/`
- `checkpoints/`
- `scratchpad.md`

Markdown artifacts use strict ontology frontmatter:

- `artifact_id`
- `artifact_type_id`
- `status_id`
- `title`
- `created_at`
- optional ontology links: `workflow_run_id`, `definition_id`, `related_artifact_ids`

Workflow runs persist under runtime `workflows/<workflow-run-slug>/`.

- `snapshot.jsonld` — sole authoritative current state
- `journal/*.jsonld` — append-only transition/task/check evidence
- top-level `workflows/*.jsonld` single-file artifacts are rejected with strict-format error
- `workflow_state` output is explicit projection payload:
  - tool argument is `workflow_run_id`
  - strict temporary alias: legacy `workflow_id` accepted only when `workflow_run_id` absent or equal
  - `snapshot` — authoritative workflow snapshot
  - `journal_evidence` — append-only transition/task/check evidence
  - `latest_projections` — latest-only convenience view derived from snapshot + journal
  - `projection.provenance` — snapshot file + journal directory used to regenerate view

## Verification contract

`run_mechanical_checks` parses `AGENTS.md` `## Review Checks` section and executes declared commands in order.

Current repo contract:

- lint: `npm run lint`
- tests: `npm test`
- verify-expansion: `node packages/core/tests/verify-expansion.mjs`

`check_artifacts` performs cross-artifact consistency checks for:

- dead references
- stale completion statuses
- missing ontology links
- workflow/artifact completion mismatches

`project_state` and `check_artifacts` are derived operational views, not authorities. Both now expose scan provenance and projection metadata. `save_checkpoint`, `scratchpad`, and `write_append` outputs are explicitly labeled narrative-only.

## Local customization surfaces

Project-local customization lives under runtime root:

- `.opencode/ontology/*.jsonld` or `.kilocode/ontology/*.jsonld` — local ontology records
- `.opencode/ontology/prompts/*.md` or `.kilocode/ontology/prompts/*.md` — local prompt overrides
- `.opencode/skills/<name>/SKILL.md` or `.kilocode/skills/<name>/SKILL.md` — local skill overrides

Copy-ready examples live in [`examples/`](examples/README.md):

- host `opencode.json` customization
- repo-owned `.opencode/ontology/*.jsonld` extension
- local prompt and skill overrides
- `structured_read` fixture plus payload examples

Practical model:

- builtin ontology loads first from `packages/core/spec/ontology/*.jsonld`
- local `.opencode/ontology/*.jsonld` loads after builtin graph
- matching ontology `@id` replaces builtin entity unless record is immutable builtin safety record
- new ontology `@id` extends graph
- prompt loading checks local `ontology/prompts/` first, then packaged builtin prompt file
- skill loading checks local `skills/` first, then packaged builtin skill file

Limits matter:

- ontology stays authoritative for tools, permission grants, path policies, workflow ids, default-agent metadata, and protected safety behavior
- local prompts can change guidance text only; they do not redefine runtime permissions or policy evaluation
- local skills can change loaded markdown only; they do not bypass ontology grants or host permission hooks
- immutable builtin ontology records are protected from local JSON-LD override attempts. Current protected ids: `agent:tori`, `role:orchestrator`, `policy:tori-no-direct-mutation`
- host config should not be documented as override authority for this repo's protected default main-session agent; ontology still sets official `default_agent` metadata

Not authoritative:

- `.opencode/agents/` generated output is convenience expansion output, not runtime source of truth
- `.opencode/specs/`, `.opencode/briefs/`, `.opencode/exec-plans/`, `.opencode/workflows/`, checkpoints, scratchpad are managed artifacts or derived runtime state, not ontology definition sources
- prompts and docs describe behavior; they do not override ontology/runtime enforcement

## `structured_read` practical usage

`structured_read` is bounded readonly inspection for huge structured files under project root only. It does not shell out, does not write, and does not bypass path deny policy.

See [`examples/README.md`](examples/README.md) and [`examples/structured-read/huge-openapi.json`](examples/structured-read/huge-openapi.json) for copy-ready payload examples against dense one-line OpenAPI-style JSON.

Public call shape:

- required: `path`, `mode`
- optional: `offset`, `length`, `pointer`

Modes:

- `stat` — file metadata only
- `slice_bytes` — byte slice, returns base64 payload plus UTF-8 preview
- `slice_chars` — character slice from UTF-8 text decode
- `json_pointer` — resolve JSON Pointer, then render bounded JSON text for resolved value
- `object_keys` — list top-level keys of object at pointer
- `pretty` — bounded pretty-printed JSON render

Current limits:

- `slice_bytes`: max 8192 returned bytes
- `slice_chars`: max 8192 returned chars
- `json_pointer` and `pretty`: max 16384 rendered chars
- `object_keys`: max 256 returned keys

Behavior summary:

- JSON modes (`json_pointer`, `object_keys`, `pretty`) fail closed on malformed JSON
- `object_keys` requires object target at pointer
- `json_pointer` pointer must be empty or start with `/`
- output always includes non-authoritative projection metadata plus path/mode/format/truncation metadata
- authorization still derives from requested path, so deny policies for sensitive paths like `.env` still apply

## Development

```bash
npm install
npm run build
npm test
npm run lint
node packages/core/tests/verify-expansion.mjs
```

## Contribution rule

When changing behavior, update ontology contract first. Code, prompts, docs, tests follow ontology — never lead it.
