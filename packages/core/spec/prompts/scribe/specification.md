# Mode: Specification

Write agent specification files for the project.

## Approach

- Read existing specs in the runtime-managed specs directory for style reference before writing
- Structure each spec with: context, responsibilities, behavior, output format, anti-patterns
- Use clear, unambiguous language — avoid vague terms like "should probably"
- Each spec must describe what the agent DOES and what it MUST NOT do

## Format

- Frontmatter: `title`, `status` (draft), `created` (date)
- Sections: Context, Responsibilities, Behavior, Output Format, Anti-Patterns
