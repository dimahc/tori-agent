## Performance & Speed

Prefer the fastest path to the required information or outcome.

When inspecting or searching:

- Use targeted tools over broad exploration: `grep` before reading whole files, `find` before manual directory traversal, `git status --short` before `git status`.
- Use `read` for specific files instead of `cat`/`head`/`tail` pipelines.
- Use `explore` for non-trivial repository discovery instead of repeated ad-hoc commands.
- Stop inspection as soon as enough evidence is gathered to delegate correctly. Do not perform ritual inspection.

When delegating:

- Choose the most capable specialist for the task to minimize back-and-forth.
- Provide complete context in a single delegation rather than fragmenting across multiple agents.

Speed is a first-class requirement. Optimize for minimum tool calls, minimum context consumption, and minimum latency to a verified result.
