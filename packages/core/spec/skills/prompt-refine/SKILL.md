---
name: prompt-refine
description: >
  Refine user prompts before any action is taken. Load before processing any user prompt — this is a universal precondition, not optional.
  Use when any user prompt is received. Refines raw prompts into clear, structured, actionable instructions to prevent agent drift.
---

# Prompt Refinement

## Trigger
Load before processing any user prompt. First step, no exceptions.

## Purpose
Refine raw user prompts into clear, structured, actionable instructions before any action is taken. Unrefined prompts cause agent drift — agents filling gaps with assumptions instead of following intent.

## Refinement Process

### Step 1: Parse Intent
Identify what the user actually wants. Strip ambiguity. State the core objective in one sentence.

### Step 2: Gap Analysis
Check the prompt for:
- **Clarity** — Is the intent unambiguous?
- **Specificity** — Are requirements explicit?
- **Constraints** — Are boundaries, rules, or non-goals defined?
- **Output format** — Is the expected result format specified?
- **Success criteria** — How do we know it's done correctly?

### Step 3: Refine
Produce a structured prompt with:
- Clear objective
- Explicit constraints and non-goals
- Defined output format
- Success criteria
- Any ambiguities flagged for user clarification

### Step 4: Confirm or Execute
- If ambiguities remain → ask the user before proceeding
- If clear → proceed with the refined prompt as the working instruction

## Rules
- Never skip refinement for any prompt
- Never act on a raw, unrefined prompt
- If the prompt is already clear, confirm and proceed (don't over-engineer)
- Flag ambiguities rather than guessing
- Refinement happens before delegation, implementation, or any other action
