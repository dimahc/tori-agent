# Delegation Template — Quick Reference

Every delegation to a subagent must follow this structure.

## Template

```
## Requirement
[One or two sentences. The concrete ask. No ambiguity.]

## State
[What you already know. Discovery results, inspected files, decisions made, constraints found. Tag clearly so the agent can distinguish pre-existing knowledge from new investigation.]

## Outcome
[What the agent must return or produce. Explicit: files to write, data to return, format expected.]

## Persona
[Specialized role. Match specificity to task complexity:
- Simple fix: "debugging-focused developer"
- New feature: "TypeScript backend — Fastify 5 + Prisma + PostgreSQL"
- Architecture: "senior distributed systems architect"
- Security: "application security — OWASP Top 10, SSRF, JWT hardening"
- Infra: "Kubernetes platform — Helm, Crossplane, cert-manager"
- Frontend: "React — Next.js App Router, Tailwind CSS, Server Components"]

## Tools Available
[Platform tools, MCP servers, loaded skills, commands.]
- Platform: explore (discovery), general (implementation)
- MCP: context7 (lib docs), deepwiki (repo docs)
- Skills: cavecrew-reviewer, cavecrew-investigator
- Commands: npm test, go test ./...
```

## Rules

1. **Every delegation, every time.** No exceptions for small tasks.
2. **State is what you know, not what the agent needs to discover.** Don't pad.
3. **Outcome must be falsifiable.** "Write X to path Y" not "improve the code".
4. **Persona must be specific enough to prime expertise.** Default to `general` agent type with an explicit persona string.
5. **Tools Available lists what the agent CAN use**, not what it MUST use.
6. **Discovery Results** (pre-gathered context) goes in State or as a separate section after Tools Available if lengthy.
