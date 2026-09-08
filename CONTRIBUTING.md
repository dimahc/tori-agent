# Contributing to tori-agent

Strict ontology repo. Change authority in this order:

1. `packages/ontology`
2. `packages/core/spec/ontology/*.jsonld`
3. runtime implementation in `packages/core`
4. thin adapter in `packages/harness`
5. prompts/docs/tests

## Rules

- No backward-compatibility shims
- No legacy stage names in runtime state
- No prompt-only behavior contracts
- No hand-authored managed workflow state outside tool paths

## Verification before PR

```bash
npm run build
npm test
npm run lint
node packages/core/tests/verify-expansion.mjs
```

## Review checks source

`AGENTS.md` `## Review Checks` section is executable contract for `run_mechanical_checks`.

## Managed artifact contract

Markdown managed artifacts require strict ontology frontmatter fields:

- `artifact_id`
- `artifact_type_id`
- `status_id`
- `title`
- `created_at`

Workflow state is JSON-LD under runtime `workflows/`.

## Harness plugin contract

Runtime hook surface stays explicit and deterministic:

- `config`
- `event`
- `chat.message`
- `session.title`
- `permission.ask`

Session title proposals come from first meaningful user request only. Host may consume `{ title, shouldRename, source }` from `chat.message` or `session.title`.
