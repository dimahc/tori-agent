# Commit examples — git hygiene enforcement

Ontology authoritative. Prompt descriptive only.

This reference provides concrete examples of conventional commits following the repo format `type(scope): subject`. It contrasts good (small, scoped, one feature per commit) commits with bad (batched multiple features) commits.

---

## GOOD commits — one feature per commit

Each commit touches a single functional block. Files that serve multiple scopes are committed separately per scope.

### 1. Add validation helper for delivery agent

```
feat(delivery): add staged-diff inspection helper
```

What it does: Adds a utility that lets the delivery agent verify its staged diff matches the requested deliverable before committing.

Files changed:
- `packages/core/src/delivery/diff-check.ts` (new)
- `packages/core/tests/delivery/diff-check.test.ts` (new)

Why it's good: One functional block (diff inspection), one scope (`delivery`), one commit.

### 2. Fix clean-worktree check in workflow stage transition

```
fix(workflow): validate clean worktree before stage transition
```

What it does: Corrects a bug where `transition_stage` allowed advancement even when the worktree had uncommitted changes, violating the clean worktree invariant.

Files changed:
- `packages/core/src/workflow/transition.ts`
- `packages/core/tests/workflow/transition.test.ts`

Why it's good: One bug fix, one scope (`workflow`), one commit.

### 3. Add ontology check result recorder

```
feat(ontology): add record_check_result persistence
```

What it does: Implements the `record_check_result` tool so verification checks are persisted as evidence anchors in the workflow snapshot.

Files changed:
- `packages/core/src/tools/check.ts` (new)
- `packages/ontology/src/check-schema.json` (new)

Why it's good: One feature (check recording), one scope (`ontology`), one commit.

### 4. Update commit-per-scope rule in specialist prompt

```
docs(specialist): clarify commit-per-scope in delegation prompt
```

What it does: Edits the specialist agent prompt to explicitly state that each delegated task must result in its own commit — no batching across tasks.

Files changed:
- `packages/core/spec/ontology/prompts/specialist.md`

Why it's good: One documentation change, one scope (`specialist`), one commit.

---

## BAD commits — batched multiple features

### 1. Batching a feature and a fix together

```
feat(core): add checkpoint system and fix workflow transition bug
```

What it tries to do: Implements `save_checkpoint` AND fixes a transition-stage validation error in the same commit.

Why it's bad: Two unrelated functional blocks in one commit. If the checkpoint feature needs to be reverted, the fix is trapped in the same commit. A file changed in both blocks (e.g., `workflow/state.ts`) makes atomic reverting impossible.

Correct approach:

```
feat(core): add save_checkpoint persistence
```

```
fix(workflow): validate transition preconditions before stage advance
```

### 2. Batching three features across scopes

```
feat(core): add task recording, artifact check, and prompt templates
```

What it tries to do: Implements `record_task_result`, `check_artifacts`, and new delegation prompt templates all at once.

Why it's bad: Three distinct scopes (`task`, `artifact`, `prompt`) committed together. The delivery agent cannot stage a minimal diff for any one scope because unrelated files are bundled. If a hook rejects the commit, all three must be fixed together.

Correct approach:

```
feat(core): add record_task_result tool
```

```
feat(core): add check_artifacts consistency scan
```

```
feat(prompt): add delegation prompt templates
```

---

## Key rules

| Rule | Source |
|------|--------|
| One functional block per commit | `tori.md` — Git Hygiene, Commit per scope |
| Never batch multiple features | `delivery-agent.md` — Commit discipline |
| Conventional-commit format | `delivery-agent.md` — Commit discipline |
| Never amend; fix and create new commit | `tori.md` — Clean worktree invariant |
| Delivery agent executes the commit | `tori.md` — Git Hygiene |
