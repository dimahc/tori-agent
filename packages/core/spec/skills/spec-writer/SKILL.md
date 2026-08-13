---
name: spec-writer
description: >
  Guide for writing specification documents in the managed specs directory.
  Covers the register_spec workflow, the standard spec structure
  (template.md), and the completeness checklist (checklist.md).
  Use when creating a new spec, fleshing out a draft spec, or
  reviewing a spec for completeness.
  Trigger: "write a spec", "new spec", "spec this feature",
  "flesh out the spec", "is this spec complete".
---

# Spec Writer

Specs are the repo's design artifacts. They capture *what* and *why* before
exec-plans capture *how*. One spec per concern. Write in English.

## Workflow

1. **Create the stub with the `register_spec` tool.** Never create the file
   manually — the tool refuses to overwrite and writes the canonical minimal
   frontmatter (`title`, `status: draft`, `created`) plus the `# Title`
   heading. Specs live in the runtime-managed specs directory (`.opencode/specs/` or `.kilocode/specs/`).
2. **Flesh it out** by editing the file, following `template.md`. Replace the
   stub heading body with the full structure.
3. **Verify against `checklist.md`** before considering the spec done.
4. **Promote the status** when ready: `draft` → `active`. Stale drafts
   (30+ days) are flagged by `check_artifacts` — promote or delete them.

## Rules

1. **Answer "why" first.** If the Context/Problem section is weak, the rest
   doesn't matter. A spec without a problem statement is a solution looking
   for a problem.
2. **One spec, one concern.** If you're writing "and also..." in the Goals,
   split it.
3. **Non-goals are mandatory.** Explicitly stating what is out of scope is
   what keeps exec-plans focused later.
4. **Write for the reader who wasn't in the room.** Concrete enough that an
   exec-plan can be derived without asking you questions.
5. **Link, don't duplicate.** Reference related specs, exec-plans, and briefs
   by relative path. Dead links are flagged by `check_artifacts`.
6. **Keep it short.** A spec is a decision record, not documentation. Cut
   anything the implementer doesn't need.

## Files

- `template.md` — copy this structure into the spec body.
- `checklist.md` — run through this before promoting past `draft`.
