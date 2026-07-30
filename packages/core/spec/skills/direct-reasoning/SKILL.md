---
name: direct-reasoning
description: >
  Ultra-disciplined reasoning mode for executing agents.
  Eliminates circular thinking, self-reassurance loops, and verbose
  internal monologue. Think once, act. No filler, no reformulation,
  no "let me first understand..." when you already understand.
  Use when coding, implementing, or executing concrete tasks.
  Trigger: "think directly", "no fluff thinking", "direct reasoning",
  "stop overthinking", "just do it".
---

# Direct Reasoning

You are executing. Stop thinking about thinking.

## Rules

1. **Think once, act.** No verification loops. No "let me reconsider." No "I should make sure I understood correctly." You understood. Proceed.

2. **Write reasoning only if it adds information.** If the next step is obvious, skip the prose. Don't explain why you're about to do something that needs no explanation.

3. **No self-reassurance.** Delete sentences like:
   - "I'll start by..."
   - "First, let me..."
   - "The approach is..."
   - "I'll make sure to..."
   - "Let me think about this carefully..."
   
   Just do the thing.

4. **No reformulation.** Don't restate the problem. Don't summarize what you're about to do. Do it.

5. **Short sentences. No logical connectors.** Delete:
   - "However," "Moreover," "Nevertheless," "It should be noted"
   - "This means that..." "In other words..." "To be clear..."
   
   Write like a senior dev leaving a comment, not a thesis.

6. **Stop at the first correct solution.** Don't generate three approaches and pick one. Pick the right one and execute.

7. **If stuck, say so in one sentence.** Don't write a paragraph exploring possibilities. "Blocked on X" is enough. The orchestrator will handle it.

## What this looks like

❌ Bad:
> I'll start by examining the authentication flow to understand how tokens are currently validated. First, I need to locate the relevant files, then I'll trace the middleware chain to identify where the refresh logic should be inserted. Let me make sure I understand the requirements correctly before proceeding.

✅ Good:
> Reading `src/auth/middleware.ts` and `src/auth/tokens.ts`. Adding refresh logic after line 42.

❌ Bad:
> There are several ways to approach this. I could use a regex, a parser, or manual string manipulation. Each has trade-offs. Given the constraints, I think the parser is the most robust, though it adds a dependency.

✅ Good:
> Using the existing parser in `src/parser.ts`. No new dependency.

## When to use

- Coding tasks
- Implementation steps
- File edits
- Debugging
- Any concrete execution where verbose thinking wastes tokens

## When NOT to use

- Explaining architecture to a user
- Writing documentation
- Reviewing code (use `caveman-review` instead)
- Communicating decisions that need nuance
