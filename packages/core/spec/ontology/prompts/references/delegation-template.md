# Delegation template — git hygiene constraints

Ontology authoritative. Prompt descriptive only.

This template defines how tori (orchestrator) must structure delegation prompts that include git hygiene constraints. Every delegation prompt must include the mandatory git hygiene section.

---

## Skeleton with placeholders

```markdown
# Delegation: {TASK_NAME}

## Task description
{PLACEHOLDER_TASK_DESCRIPTION}

## Scope
- Functional block(s): {PLACEHOLDER_SCOPE}
- Files to be created/modified: {PLACEHOLDER_FILE_LIST}
- Non-goals (do not re-explore): {PLACEHOLDER_NON_GOALS}

## Expected output
{PLACEHOLDER_EXPECTED_OUTPUT}

## Acceptance criteria
- {PLACEHOLDER_CRITERION_1}
- {PLACEHOLDER_CRITERION_2}

## Git hygiene (mandatory)

1. **Commit-per-scope rule.** Do not batch multiple features or scopes into one commit. Each functional block or meaningful progress milestone gets its own commit via `agent:delivery-agent`. A file that serves different scopes must be committed separately per scope.

2. **Clean worktree invariant.** Before starting work, verify the worktree is clean (all changes committed or stashed). If uncommitted changes exist from a prior task, they must be resolved before this task begins.

3. **Post-task evaluation.** When the task completes, tori evaluates the summary and decides:
   (a) Delegate a commit via `agent:delivery-agent` with a conventional-commit message matching the scope, then continue; or
   (b) Continue to the next task without committing (only if no meaningful progress was made).

4. **Failed commit handling.** If a commit fails (hook rejection, etc.), fix the issue and create a new commit — never amend.

## Context already gathered
{PLACEHOLDER_CONTEXT}
```

---

## Mandatory git hygiene section

The following section **must** appear in every delegation prompt. It is derived from `tori.md` — Git Hygiene and Delegation quality (item 5).

```markdown
## Git hygiene (mandatory)

1. **Commit-per-scope rule.** Do not batch multiple features or scopes into one commit. Each functional block or meaningful progress milestone gets its own commit via `agent:delivery-agent`. A file that serves different scopes must be committed separately per scope.

2. **Clean worktree invariant.** Before starting work, verify the worktree is clean (all changes committed or stashed). If uncommitted changes exist from a prior task, they must be resolved before this task begins.

3. **Post-task evaluation.** When the task completes, tori evaluates the summary and decides:
   (a) Delegate a commit via `agent:delivery-agent` with a conventional-commit message matching the scope, then continue; or
   (b) Continue to the next task without committing (only if no meaningful progress was made).

4. **Failed commit handling.** If a commit fails (hook rejection, etc.), fix the issue and create a new commit — never amend.
```

---

## Example filled-in delegation prompt

```markdown
# Delegation: Add leave balance query tool

## Task description
Implement a new tool `leave_balance` that retrieves an employee's leave allocations (leave_type, total_leaves_allocated, new_leaves_allocated) for the ERPNext integration. The tool must query the ERPNext API and return structured data matching the ontology definition.

## Scope
- Functional block(s): `leave-balance-tool`
- Files to be created/modified:
  - `packages/core/src/tools/leave-balance.ts` (new)
  - `packages/core/tests/tools/leave-balance.test.ts` (new)
  - `packages/ontology/src/leave-balance-schema.json` (new)
- Non-goals (do not re-explore): The leave application list tool (`leave_application`) is already implemented in `packages/core/src/tools/leave-application.ts`. Do not modify it or its tests.

## Expected output
A working `leave_balance` tool that accepts an employee ID and returns leave allocation data, plus unit tests that pass with `npm test`.

## Acceptance criteria
- `npm test` passes including the new leave-balance tests
- The tool follows the existing tool registration pattern in `packages/core/src/tools/index.ts`
- The schema in `packages/ontology/src/leave-balance-schema.json` matches the ontology contract

## Git hygiene (mandatory)

1. **Commit-per-scope rule.** Do not batch multiple features or scopes into one commit. Each functional block or meaningful progress milestone gets its own commit via `agent:delivery-agent`. A file that serves different scopes must be committed separately per scope.

2. **Clean worktree invariant.** Before starting work, verify the worktree is clean (all changes committed or stashed). If uncommitted changes exist from a prior task, they must be resolved before this task begins.

3. **Post-task evaluation.** When the task completes, tori evaluates the summary and decides:
   (a) Delegate a commit via `agent:delivery-agent` with a conventional-commit message matching the scope, then continue; or
   (b) Continue to the next task without committing (only if no meaningful progress was made).

4. **Failed commit handling.** If a commit fails (hook rejection, etc.), fix the issue and create a new commit — never amend.

## Context already gathered
- ERPNext API endpoint for leave allocations: `/api/method/erpnext.hr.doctype.leave_application.leave_application.get_leave_balance`
- Existing tool pattern: see `packages/core/src/tools/leave-application.ts` for registration and error handling conventions
- Employee lookup tool (`employee_get`) is already available and does not need re-implementation
```

---

## Notes for tori (orchestrator)

- The git hygiene section is **not optional**. Omitting it from a delegation prompt violates the ontology's Git Hygiene rules (`tori.md` line 61–65).
- The "Post-task evaluation" clause gives tori the decision authority: after the specialist returns, tori decides whether to commit or continue. This is the incremental commit gate (`tori.md` line 100).
- The delivery agent (`agent:delivery-agent`) is the only agent that executes commits. No specialist or other agent should run `git commit` directly.
