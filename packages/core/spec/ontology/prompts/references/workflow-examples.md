# Workflow examples — incremental commit workflow

Ontology authoritative. Prompt descriptive only.

These scenarios illustrate how tori (orchestrator) manages incremental commits across multiple tasks, following the commit-per-scope rule and clean worktree invariant from `tori.md` — Git Hygiene.

---

## Scenario 1: 3 features to implement — each committed separately

**Task:** Implement three new ontology tools: `record_task_result`, `record_check_result`, and `check_artifacts`.

### Step-by-step flow

**Task 1: Implement `record_task_result`**

1. tori delegates to a specialist with the delegation template (including mandatory git hygiene section).
2. Specialist implements the tool, runs tests, reports summary.
3. tori evaluates the summary → meaningful progress made → delegates commit via `agent:delivery-agent`.
4. Delivery agent stages `packages/core/src/tools/task-result.ts` and `packages/core/tests/tools/task-result.test.ts`, commits:
   ```
   feat(core): add record_task_result persistence
   ```
5. tori verifies commit landed via `git log`/`git status`.
6. Worktree is clean. tori proceeds to Task 2.

**Task 2: Implement `record_check_result`**

1. tori checks worktree is clean (it is) → delegates next task.
2. Specialist implements the tool, runs tests, reports summary.
3. tori evaluates → meaningful progress → delegates commit via `agent:delivery-agent`.
4. Delivery agent stages `packages/core/src/tools/check.ts` and `packages/core/tests/tools/check.test.ts`, commits:
   ```
   feat(core): add record_check_result persistence
   ```
5. tori verifies commit landed. Worktree is clean. Proceed to Task 3.

**Task 3: Implement `check_artifacts`**

1. tori checks worktree is clean → delegates.
2. Specialist implements, tests pass, reports summary.
3. tori evaluates → meaningful progress → delegates commit via `agent:delivery-agent`.
4. Delivery agent stages `packages/core/tools/artifact-check.ts` and tests, commits:
   ```
   feat(core): add check_artifacts consistency scan
   ```
5. tori verifies. All three features committed independently.

### Resulting git log

```
feat(core): add check_artifacts consistency scan
feat(core): add record_check_result persistence
feat(core): add record_task_result persistence
```

Each commit is independently revertible, independently reviewable, and maps to one functional block.

---

## Scenario 2: Bug fix during feature work — fix committed before continuing

**Task:** Implement a new `task_create` tool. During implementation, the specialist discovers a bug in the existing `transition_stage` function.

### Step-by-step flow

**Phase A: Discover bug during feature work**

1. tori delegates `task_create` implementation to a specialist.
2. While working, the specialist finds that `transition_stage` allows advancement when the worktree is dirty (violates clean worktree invariant).
3. Specialist pauses feature work, fixes the bug, verifies the fix with tests.

**Phase B: Commit the bug fix first**

4. tori evaluates the summary → the bug fix is meaningful progress → delegates commit via `agent:delivery-agent`.
5. Delivery agent stages only the fix files (`packages/core/src/workflow/transition.ts`, test), commits:
   ```
   fix(workflow): validate clean worktree before stage transition
   ```
6. tori verifies commit landed. Worktree is clean (feature work was not staged).

**Phase C: Resume feature work**

7. tori confirms worktree is clean → resumes `task_create` delegation.
8. Specialist completes `task_create`, tests pass, reports summary.
9. tori evaluates → meaningful progress → delegates commit via `agent:delivery-agent`.
10. Delivery agent stages `packages/core/src/tools/task-create.ts`, tests, commits:
    ```
    feat(core): add task_create tool
    ```

### Resulting git log

```
feat(core): add task_create tool
fix(workflow): validate clean worktree before stage transition
```

The bug fix is isolated in its own commit. If the fix needs to be reverted or reviewed independently, it is not entangled with the feature work.

### Key decision point

The specialist discovered the bug **during** feature work, but tori does not batch the fix and the feature into one commit. The fix is committed first (it blocks correct workflow operation), then the feature continues. This preserves the commit-per-scope rule even when discoveries happen mid-task.

---

## Scenario 3: Failed commit (hook rejection) — fix and recommit

**Task:** Implement `project_state` tool. The delivery agent attempts to commit but the pre-commit hook rejects it.

### Step-by-step flow

**Phase A: Implement and attempt commit**

1. tori delegates `project_state` implementation to a specialist.
2. Specialist completes the tool, tests pass, reports summary.
3. tori evaluates → meaningful progress → delegates commit via `agent:delivery-agent`.
4. Delivery agent stages `packages/core/src/tools/project-state.ts` and tests, runs `git commit -m "feat(core): add project_state tool"`.
5. **Hook rejects the commit.** Reason: the commit includes a file that violates the ontology contract (e.g., `packages/core/src/tools/project-state.ts` references an ontology schema that doesn't exist yet).

**Phase B: Fix and create new commit (never amend)**

6. tori receives the hook rejection report.
7. tori delegates a fix task (or the specialist fixes inline): create the missing ontology schema file `packages/ontology/src/project-state-schema.json`.
8. Specialist re-runs tests, confirms they pass.
9. Delivery agent stages the fix (`packages/ontology/src/project-state-schema.json`) **plus** the original tool files, and creates a **new** commit:
   ```
   feat(core): add project_state tool
   ```
   **Do NOT amend.** The original failed commit attempt is not part of history (it was rejected). The new commit is a fresh commit on top of the clean state.

10. tori verifies commit landed via `git log`/`git status`. Worktree is clean.

### Resulting git log

```
feat(core): add project_state tool
```

Only one successful commit exists. The rejected attempt left no trace because it was never created.

### Key decision point

The clean worktree invariant is preserved: after the hook rejection, the worktree is in a known state (staged but uncommitted). The fix adds the missing dependency, and the delivery agent re-stages everything and creates a new commit. Amending is prohibited because the ontology requires that every commit be a discrete, verifiable unit — amend would obscure the failed attempt and its resolution.

---

## Summary table

| Scenario | Commits | Key rule applied |
|----------|---------|-----------------|
| 3 features | 3 separate commits | Commit-per-scope |
| Bug fix during feature | 2 commits (fix, then feature) | Fix-first, then continue; no batching |
| Failed commit | 1 successful commit (rejected attempt leaves no trace) | Never amend; fix and create new commit |
