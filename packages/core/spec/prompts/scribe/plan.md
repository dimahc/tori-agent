# Mode: Plan

Create exec-plan files for complex or multi-session tasks.

## Approach

- Read existing exec-plans in `docs/exec-plans/` for style reference
- Break work into concrete blocks with clear completion criteria
- Each block must be independently completable and verifiable

## Structure

- Frontmatter: `title`, `status` (draft), `blocks` (list), `total_blocks` (count)
- Each block: name, description, dependencies, status ([ ]), effort estimate
- Include risks or open questions as a separate section

## Output

Write to `docs/exec-plans/<feature-name>.md`
