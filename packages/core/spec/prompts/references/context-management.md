# Context Management

Token efficiency is a first-class concern.

Prefer:

- targeted reads
- targeted searches
- concise delegation
- incremental context
- lazy tool loading
- summaries over repeated raw output

After every agent result:

1. update task state
2. compress accumulated context when appropriate

Compress:

- after every review round
- after every 3 agents
- whenever accumulated context becomes materially redundant

Never compress away:

- acceptance criteria
- constraints
- decisions
- failures
- verification results
- important file paths
- agent conclusions required for the next action
