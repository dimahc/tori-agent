# Examples

Copy-ready examples for two different customization layers:

1. **Host-level OpenCode config** via `opencode.json`
2. **Repo-owned runtime customization** via `.opencode/**`

These examples are scoped to current `tori-agent` behavior.

## What each example demonstrates

| File | Demonstrates | Authority level |
| --- | --- | --- |
| `examples/opencode.json` | Host-owned OpenCode agent registration for a local `openapi-auditor` subagent | Host config only. Not authoritative for this repo's ontology-owned fields on matching agent keys |
| `examples/prompts/openapi-auditor.md` | Host-owned prompt file referenced by `examples/opencode.json` | Descriptive only |
| `examples/opencode-runtime-root/.opencode/ontology/custom-auditor.jsonld` | Project-local ontology extension that adds new agent `agent:openapi-auditor` | **Authoritative** for repo-local agent identity, grants, tool list, and policy inputs |
| `examples/opencode-runtime-root/.opencode/ontology/prompts/reviewer.md` | Local prompt override example for `prompt:reviewer` | Descriptive only |
| `examples/opencode-runtime-root/.opencode/skills/caveman/SKILL.md` | Local skill override example | Descriptive only. No permission bypass |
| `examples/structured-read/huge-openapi.json` | Dense structured fixture for `structured_read` | Test data only |

## Copy targets

Copy files to matching layers:

- `examples/opencode.json` -> your host `opencode.json`
- `examples/prompts/openapi-auditor.md` -> host-side prompt file path referenced by that config
- `examples/opencode-runtime-root/.opencode/ontology/custom-auditor.jsonld` -> `<repo>/.opencode/ontology/custom-auditor.jsonld`
- `examples/opencode-runtime-root/.opencode/ontology/prompts/reviewer.md` -> `<repo>/.opencode/ontology/prompts/reviewer.md`
- `examples/opencode-runtime-root/.opencode/skills/caveman/SKILL.md` -> `<repo>/.opencode/skills/caveman/SKILL.md`

Do **not** copy managed runtime state directories such as `.opencode/specs/`, `.opencode/briefs/`, `.opencode/exec-plans/`, or `.opencode/workflows/` as setup examples. Those are runtime state, not customization source.

## Important authority split

`tori-agent` uses strict layering:

1. builtin ontology from `packages/core/spec/ontology/*.jsonld`
2. local `.opencode/ontology/*.jsonld`
3. local prompt overrides from `.opencode/ontology/prompts/*.md`
4. local skill overrides from `.opencode/skills/*/SKILL.md`

Practical consequences:

- `examples/opencode.json` shows **real OpenCode host config syntax**.
- In this repo, host config alone does **not** relax ontology policy.
- For ontology-governed tools in this repo, pair host config with matching project-local ontology records.
- Local prompt and skill files change loaded markdown only.
- Prompts and skills do not redefine grants, path policy, or protected Tori safety.
- Generated `.opencode/agents/` output is not runtime authority.

## Host config example: what it can and cannot do here

`examples/opencode.json` intentionally registers `openapi-auditor` as a host-level subagent and points at a real prompt file.

For plain OpenCode usage, that is enough to create a local custom agent.

For **this repo**, `structured_read`, `read`, `glob`, and `grep` are ontology-governed surfaces. If you want `openapi-auditor` to use those repo-governed tools safely, add matching runtime-root ontology too:

- host config key: `openapi-auditor`
- local ontology agent id: `agent:openapi-auditor`

Without matching ontology, host sees agent name, but repo runtime will not treat that session as ontology-bound for governed tool authorization.

Also note:

- example does **not** claim host `default_agent` can replace this repo's protected ontology default
- this repo still sets official default main-session agent from ontology
- config changes load at startup; restart required after editing `opencode.json`, local ontology, prompts, or skills

## Repo-owned runtime example

`examples/opencode-runtime-root/.opencode/ontology/custom-auditor.jsonld` is proper JSON-LD with top-level `@graph`.

It demonstrates safe project-local extension:

- adds new capability, role, and agent
- grants readonly OpenAPI inspection tools
- denies `bash`, `write`, and `edit`
- reuses `prompt:reviewer` so prompt override behavior is easy to demonstrate

It does **not** attempt builtin replacement. Protected builtin ids still cannot be relaxed by local JSON-LD overrides.

## Prompt override example

`examples/opencode-runtime-root/.opencode/ontology/prompts/reviewer.md` is intentionally explicit:

- prompt text is descriptive only
- ontology remains authoritative for tools, permissions, path policy, and workflow rules
- override affects agents that resolve `prompt:reviewer`

## Skill override example

`examples/opencode-runtime-root/.opencode/skills/caveman/SKILL.md` shows local skill markdown override.

It does **not**:

- grant tools
- widen path access
- bypass `permission.ask`
- bypass `tool.execute.before`

## `structured_read` example payloads

Fixture: `examples/structured-read/huge-openapi.json`

Tool payload examples:

### 1. File metadata only

```json
{ "path": "examples/structured-read/huge-openapi.json", "mode": "stat" }
```

### 2. Inspect first character window

```json
{ "path": "examples/structured-read/huge-openapi.json", "mode": "slice_chars", "offset": 0, "length": 600 }
```

### 3. List top-level path keys

```json
{ "path": "examples/structured-read/huge-openapi.json", "mode": "object_keys", "pointer": "/paths" }
```

### 4. Resolve one schema node with JSON Pointer

```json
{ "path": "examples/structured-read/huge-openapi.json", "mode": "json_pointer", "pointer": "/paths/~1v1~1orders/get/responses/200/content/application~1json/schema" }
```

### 5. Pretty-print bounded JSON

```json
{ "path": "examples/structured-read/huge-openapi.json", "mode": "pretty" }
```

## `structured_read` guardrails these examples assume

- project-root confined
- readonly only
- bounded output
- no shell fallback
- no writes
- no network
- path authorization still applies before execution
- JSON modes fail closed on malformed JSON
