# AGENTS.md

Compact guide for agents working in this repo.

## Commands

| What | Command | Notes |
|------|---------|-------|
| Install | `npm install` | npm workspaces (4 packages) |
| Build | `npm run build` | Builds core + both runtimes. Does NOT build cli. |
| Build cli | `npm run build -w packages/cli` | Separate; cli is a stub |
| Lint | `npm run lint` | `eslint packages/*/src/` |
| Test | `npm test` | Currently fails — no `.test.js` files exist yet |
| Verify agents | `node packages/core/tests/verify-expansion.mjs` | Requires `npm run build` first (imports from `dist/`) |
| Generate agents | `node packages/cli/dist/cli.js generate` | Expands all agent specs + personas, prints list; output to `.opencode/agents/` or `.kilo/agents/` based on runtime. Also syncs builtin skills to `.opencode/skills/` or `.kilo/skills/` |
| Generate (format) | `node packages/cli/dist/cli.js generate --format json|yaml|md` | Output agent files in JSON (default), YAML, or Markdown; index is always `index.json`; builtin skills synced in all formats |

**Build order matters.** Runtime packages depend on `@tori-agent/core`. `npm run build` compiles core first, then the runtimes. If you build a runtime in isolation, core's `dist/` must already exist.

**No unit tests yet.** The real verification flow is: build → lint → verify agent compilation.

## Review Checks

### Lint
- eslint: npm run lint

### Tests
- verify-expansion: node packages/core/tests/verify-expansion.mjs
  on-failure: warn

## Architecture

npm workspaces monorepo. `packages/core` is the source of truth for shared logic, agent specs, and plugin assembly. The two runtime packages (`runtime-opencode`, `runtime-kilocode`) are thin adapters — **do not add logic there, put it in core**. `packages/cli` is a stub with a `generate` command implemented; `serve` and `doctor` are not yet implemented.

Non-obvious source paths in core:
- `spec/agents/*.yaml` — agent definitions (permissions, personas, modes); loaded by `src/codegen/loader.ts`
- `spec/prompts/**` — system prompts loaded at runtime and appended to agent specs
- `src/tools/lifecycle.ts` — exec-plan/spec/brief bookkeeping; also contains `runMechanicalChecks` which reads the `## Review Checks` section above. Artifact paths: `.opencode/specs/`, `.opencode/plans/`, `.opencode/briefs/`, `.opencode/workflows/`.
- `src/tools/workflow.ts` — workflow state machine (stage transitions, task/check recording)

`.opencode/specs/`, `.opencode/plans/`, `.opencode/briefs/`, `.opencode/workflows/` are managed artifacts created on demand by plugin tools — don't hand-edit them.

`docs/adr/` is for Architecture Decision Records (ADRs) — human-important decisions that belong in versioned documentation. All other managed artifacts live in `.opencode/`.

## Conventions

- **ESM / NodeNext / strict TypeScript.** ES2022 target. Project references: runtime packages and cli reference `../core`.
- **`dist/` is build output** — never edit or commit.
- **ESLint custom rule** (`eslint.config.js`): Node.js built-in imports must use the `node:` protocol — `import fs from "node:fs"`, not `"fs"`. Enforced as error.
- **Agent specs use default-deny permissions.** Every `allow`/`deny`/`allow_paths`/`allow_commands` entry needs a rationale in the spec. Personas (Specialist) and modes (Scribe) merge their own permissions on top of the base agent.
- **Git hooks:** `sh .git-hooks/install.sh` installs the `commit-msg` hook, which rejects empty commit messages and validates the conventional-commit format (`type(scope): subject`). Always use `git commit -m "message"`.

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) — system diagram, component responsibilities, startup flow
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow model, PR checklist, permissions model
- [README.md](README.md) — overview, workflow model, built-in agents