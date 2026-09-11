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
node packages/core/tests/verify-policy-engine.mjs
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

Authority split stays strict:

- `snapshot.jsonld` = authoritative current workflow state
- `journal/*.jsonld` = append-only workflow evidence
- `workflow_state` output sections like `latest_projections` and bounded-cognition summaries = reproducible derived views only, never authority or policy source

## Harness plugin contract

Runtime hook surface stays explicit and deterministic:

- `config`
- `event`
- `chat.message`
- `permission.ask`
- `tool.execute.before`
- `experimental.text.complete`

`config` must mutate host config in place and set official `default_agent`. Host should honor that value for fresh sessions, then pass actual agent through `chat.message` for authoritative session binding before guarded actions. When the host creates a fresh session without an agent, `session.created` applies the ontology default main-session agent as the initial binding.

Authoritative binding surfaces in strict ABI: `session.created` / `session.updated` event `properties.info.agent`, `session.next.agent.switched` event `properties.agent`, and `chat.message` with `agent`. No repo-side fallback binds unclaimed sessions during `permission.ask` or `tool.execute.before`.

Session title proposals remain internal helper logic only. Not part of strict official plugin contract.

Output suppression is host-enforced through `experimental.text.complete`. Hook rewrites text in place only; no custom retry/block status is exposed through official ABI.

Repo guarantees ontology-derived agent config, canonical default-agent metadata, and deny-by-default behavior for unbound sessions on ontology-governed permissions. Native `write` / `edit` / `bash` enforcement depends on host calling both `permission.ask` and `tool.execute.before`.

`workflow_state` public tool argument is `workflow_run_id`. Strict temporary alias `workflow_id` remains accepted only when `workflow_run_id` absent or equal, to avoid breaking active callers during rename.

`structured_read` is repo-defined readonly extraction tool for huge structured files. Keep it bounded, project-root confined, deterministic, no subprocess, no shell fallback, no writes, no network. New path-bearing readonly tools must derive authorization pattern from input path so deny policies like dotenv coverage still apply.

## Contributor invariants for local customization docs

- Document local customization in terms of runtime layering, not vague "overrides everything" language.
- Never claim `.opencode/agents/` or `.kilocode/agents/` generated output is runtime source of truth.
- Never claim prompts or skills can relax ontology policy, tool grants, path policy, or Tori safety protections.
- If immutable builtin protection changes, update docs and tests together with exact protected ids.

## Contributor invariants for `structured_read`

- New mode must preserve readonly derived-view contract and explicit `authoritative: false` output.
- New mode must stay project-root confined and path-authorized through requested path.
- New mode must declare deterministic truncation/limit behavior and document exact bounds.
- If public args or modes change, update `README.md`, `packages/core/README.md`, `ARCHITECTURE.md`, tests, and any ontology/prompt references that summarize safe usage.
- Do not add shell fallback, subprocess execution, network access, or mutation behavior to `structured_read`.
