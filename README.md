# tori-agent

`tori-agent` now runs on strict ontology contract only. No legacy workflow terms, no compatibility shims, no prompt-defined authority.

## Core model

- Canonical contract package: `packages/ontology`
- Runtime logic consumes ontology IDs directly
- Managed workflow state persists as JSON-LD workflow-run records
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
- `chat.message` binds `sessionID -> agent` only when host passes official `input.agent`
- no silent fallback binding at `permission.ask`, `tool.execute.before`, or repo authorization path
- unbound or unknown-agent sessions fail closed for ontology-governed permissions
- `event` on `session.created` reads `event.properties.sessionID` for safe bootstrap/bookkeeping only; no binding payload returned
- host-native mutation tools (`write` / `edit` / `bash`) are enforced through `permission.ask` and `tool.execute.before`

Hard host obligations:

- honor `default_agent` when creating fresh sessions
- pass actual bound agent through `chat.message` and repo-owned tool context when host already knows it
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

Workflow runs persist as JSON-LD under runtime `workflows/`.

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
