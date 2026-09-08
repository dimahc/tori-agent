# AGENTS.md

Compact guide for agents working in this repo.

## Commands

| What | Command | Notes |
| ------ | --------- | ------- |
| Install | `npm install` | npm workspaces |
| Build | `npm run build` | Builds ontology + core + harness. Does NOT build cli. |
| Build cli | `npm run build -w packages/cli` | Separate; cli is a stub |
| Lint | `npm run lint` | `eslint packages/*/src/` |
| Test | `npm test` | Runs strict ontology lifecycle/workflow/plugin tests |
| Verify agents | `node packages/core/tests/verify-expansion.mjs` | Requires `npm run build` first (imports from `dist/`) |
| Generate agents | `node packages/cli/dist/cli.js generate` | Expands all agent specs + personas, prints list; output to `.opencode/agents/` or `.kilocode/agents/` based on runtime. Also syncs builtin skills to `.opencode/skills/` or `.kilocode/skills/` |
| Generate (format) | `node packages/cli/dist/cli.js generate --format json | yaml | md` | Output agent files in JSON (default), YAML, or Markdown; index is always `index.json`; builtin skills synced in all formats |

**Build order matters.** Harness depends on core; core depends on ontology. Build ontology first.

## Review Checks

### Lint

- eslint: npm run lint

### Tests

- tests: npm test
- verify-expansion: node packages/core/tests/verify-expansion.mjs

## Architecture

npm workspaces monorepo. `packages/ontology` is source of truth for ontology contract. `packages/core` implements runtime behavior from that contract. `packages/harness` stays thin adapter.

Non-obvious source paths in core:

- `packages/ontology/src/index.ts` — canonical IDs, shapes, runtime path builder
- `spec/ontology/*.jsonld` — canonical ontology graph records
- `spec/ontology/prompts/*.md` — prompts that describe ontology, never overrule it
- `src/tools/lifecycle.ts` — managed artifact logic + executable review checks
- `src/tools/workflow.ts` — JSON-LD workflow run state + transition semantics

`.opencode/specs/`, `.opencode/exec-plans/`, `.opencode/briefs/`, `.opencode/workflows/` are managed artifacts created on demand by plugin tools — don't hand-edit them.

`docs/adr/` is for Architecture Decision Records (ADRs) — human-important decisions that belong in versioned documentation. All other managed artifacts live in `.opencode/`.

## Conventions

- **ESM / NodeNext / strict TypeScript.** ES2022 target. Project references: runtime packages and cli reference `../core`.
- **`dist/` is build output** — never edit or commit.
- **ESLint custom rule** (`eslint.config.js`): Node.js built-in imports must use the `node:` protocol — `import fs from "node:fs"`, not `"fs"`. Enforced as error.
- **Permission authority is ontology-native.** Role `permission_grants` define tool/path/command permissions with rationale.
- **Git hooks:** `sh .git-hooks/install.sh` installs the `commit-msg` hook, which rejects empty commit messages and validates the conventional-commit format (`type(scope): subject`). Always use `git commit -m "message"`.

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) — system diagram, component responsibilities, startup flow
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow model, PR checklist, permissions model
- [README.md](README.md) — overview, workflow model, built-in agents
