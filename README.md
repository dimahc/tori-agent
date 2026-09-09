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

Harness plugin exposes deterministic runtime hooks:

- `config`
- `event`
- `chat.message`
- `session.title`
- `assistant.output`
- `permission.ask`

Session title contract:

- title proposal derives from first meaningful user message only
- blank / greeting / placeholder noise does not produce title
- plugin proposes rename once per session
- existing non-placeholder title stays authoritative
- output surface is deterministic: `{ title, shouldRename, source: "first-user-request" }`

Assistant output contract:

- host may call `assistant.output` before final response emission
- hook deterministically removes duplicate paragraphs/sentences and self-talk markers when possible
- hook may return `{ status: "retry" }` once or `{ status: "block" }` when regeneration still violates policy

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
