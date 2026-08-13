# ADR-001: Security Hardening Roadmap for Agentic Skills

## Status

Draft

## Context

The OWASP Agentic Skills Top 10 (AST10) identifies the behavior layer of AI agent skills as the most vulnerable and under-protected component of the AI agent ecosystem. Our audit of tori-agent reveals several critical and high-severity gaps:

- **AST04 (Insecure Metadata)**: Unsafe YAML parsing via `yaml.load()` in `packages/core/src/codegen/loader.ts` and `packages/core/src/codegen/skills.ts`. A malicious `SKILL.md` or agent spec can achieve remote code execution through YAML deserialization tags.
- **AST01/AST02 (Malicious Skills / Supply Chain Compromise)**: No cryptographic signing, content hashing, or provenance tracking for skills or agent specs.
- **AST06 (Weak Isolation)**: Skills execute in the same Node.js process as the agent runtime with no OS-level isolation.
- **AST08 (Poor Scanning)**: No behavioral or semantic scanning at install time.
- **AST09 (No Governance)**: No skill inventory, approval workflow, or structured audit logging.

The permission model is a strong foundation (default-deny, explicit allowlists, persona permission intersection), but it only covers tool-level access, not skill-level trust, integrity, or isolation.

## Decision

We will implement a phased security hardening roadmap aligned with AST10, prioritizing fixes by severity and effort:

### Phase 1: Immediate (P0) — RCE Prevention

1. **Verify YAML parsing safety**: The project uses `js-yaml` 4.3.1, where `yaml.load()` is safe by default and rejects dangerous tags like `!!js/function`. No code change required, but we must:
   - Pin `js-yaml` to `^4.x` in `package.json` to prevent accidental downgrade to 3.x.
   - Add a test that asserts `yaml.load()` rejects `!!js/function` payloads.
   - Document the js-yaml version requirement in `AGENTS.md`.
   - Effort: Low
   - Risk mitigated: AST04 (Insecure Metadata)

### Phase 2: Short-term (P1) — Trust & Integrity

2. **Add skill signing and content hashing**: Implement ed25519 signing for skills and agent specs, with `content_hash` in manifests. Enable Merkle-root registry verification.
   - Effort: Medium
   - Risk mitigated: AST01 (Malicious Skills), AST02 (Supply Chain Compromise)

3. **Implement skill isolation**: Run skill execution in worker threads or containers with restricted filesystem and network access.
   - Effort: High
   - Risk mitigated: AST06 (Weak Isolation)

### Phase 3: Medium-term (P2) — Detection & Governance

4. **Add install-time scanning**: Implement behavioral and semantic scanning pipeline for skills at install time. Pattern matching alone is insufficient.
   - Effort: Medium
   - Risk mitigated: AST08 (Poor Scanning)

5. **Build governance framework**: Skill inventory, approval workflow, structured audit logging for all skill actions.
   - Effort: Medium
   - Risk mitigated: AST09 (No Governance)

### Phase 4: Long-term (P3) — Ecosystem Compatibility

6. **Implement Universal Skill Format v1.0**: Support the cross-platform YAML standard as a superset of current formats, with `risk_tier`, `permissions.deny_write`, `network.allow` domain allowlists, and `scan_status`.
   - Effort: Medium
   - Risk mitigated: AST10 (Cross-Platform Reuse), AST03 (Over-Privileged Skills)

## Consequences

### Positive

- Eliminates RCE vector via YAML deserialization (Phase 1)
- Establishes cryptographic trust boundary for skills and specs (Phase 2)
- Reduces blast radius of compromised skills through isolation (Phase 2)
- Enables detection of malicious skills beyond pattern matching (Phase 3)
- Provides audit trail and governance for compliance (Phase 3)
- Aligns with OWASP AST10, NIST AI RMF, and EU AI Act requirements

### Negative

- `yaml.safeLoad()` may reject some advanced YAML features if used in agent specs or skills. We must validate that current specs and skills use only safe YAML constructs.
- Skill signing adds key management overhead for developers and registry operators.
- Worker-thread or container isolation adds complexity to the runtime and may impact performance.
- Scanning pipeline adds latency to skill installation.

### Neutral

- The existing default-deny permission model remains unchanged and continues to serve as the tool-access control foundation.
- No breaking changes to the agent spec YAML format in Phase 1; safe YAML is a strict subset of full YAML.

## Alternatives Considered

1. **Do nothing**: Accept the risk. Rejected — active exploitation in the wild (ClawHavoc, ToxicSkills) makes this unacceptable.
2. **Only fix YAML parsing**: Addresses immediate RCE but leaves supply chain, isolation, and governance gaps. Rejected — insufficient for AST10 compliance.
3. **Full isolation from day one**: Implement containerization for all skill execution immediately. Rejected — too large a change for Phase 1; better to sequence after fixing the RCE vector.

## References

- [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/)
- [OWASP AIVSS](https://owasp.org/www-project-agentic-ai-vulnerability-scoring-system/)
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- [Snyk ToxicSkills Report](https://snyk.io/blog/toxic-skills-ai-agent-security/) (Feb 2026)
- [Check Point Research: Caught in the Hook](https://research.checkpoint.com/2026/caught-in-the-hook/) (Feb 2026)
