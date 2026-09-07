/**
 * Temporary verification for PolicyEngineImpl (SC-03 task).
 * Run: node packages/core/tests/verify-policy-engine.mjs
 */
import { PolicyEngineImpl } from "../dist/policy/engine.js";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (expected=${expected}, actual=${actual})`);
}

// --- Scenario 1: can_access via role + manages --------------------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.addFact({ predicate: "has_role", args: ["alice", "dev"] });
  e.addFact({ predicate: "manages", args: ["dev", "repo"] });
  check("role-based can_access granted", await e.evaluate("alice", "access", "repo"), true);
  check("read alias maps to can_access", await e.evaluate("alice", "read", "repo"), true);
  check("no role -> denied", await e.evaluate("bob", "access", "repo"), false);
  check("unknown action predicate -> denied", await e.evaluate("alice", "delete", "repo"), false);
}

// --- Scenario 2: admin override ------------------------------------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.addFact({ predicate: "has_role", args: ["carol", "admin"] });
  check("admin can_access anything", await e.evaluate("carol", "access", "anything"), true);
  check("admin can_edit anything", await e.evaluate("carol", "edit", "file.ts"), true);
}

// --- Scenario 3: restricted resource requires clearance -------------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.addFact({ predicate: "has_role", args: ["alice", "dev"] });
  e.addFact({ predicate: "manages", args: ["dev", "secret"] });
  e.addFact({ predicate: "is_restricted", args: ["secret"] });
  check("restricted without clearance -> denied", await e.evaluate("alice", "access", "secret"), false);
  e.addFact({ predicate: "has_clearance", args: ["alice", "secret"] });
  check("restricted with clearance -> allowed", await e.evaluate("alice", "access", "secret"), true);
}

// --- Scenario 4: can_edit via capability ----------------------------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.addFact({ predicate: "has_capability", args: ["alice", "edit_code"] });
  e.addFact({ predicate: "requires_capability", args: ["main.ts", "edit_code"] });
  check("capability-based can_edit granted", await e.evaluate("alice", "edit", "main.ts"), true);
  check("missing capability -> cannot edit", await e.evaluate("bob", "edit", "main.ts"), false);
  check("capability-based can_access granted", await e.evaluate("alice", "read", "main.ts"), true);
}

// --- Scenario 5: ingestOntology(Agent) produces expected facts ------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  const role = {
    "@id": "role-dev", "@type": "Role", name: "Developer", description: "dev",
    permissions: ["read"],
    capabilities: [{ "@id": "cap-code", "@type": "Capability", name: "code", description: "", scope: "repo" }],
  };
  e.ingestOntology(role);
  e.ingestOntology({
    "@id": "agent-1", "@type": "Agent", name: "Tori", description: "orchestrator",
    roles: [role],
    capabilities: [{ "@id": "cap-plan", "@type": "Capability", name: "plan", description: "", scope: "global" }],
    tools: [{ "@id": "tool-read", "@type": "Tool", name: "read", description: "", capability_id: "cap-read" }],
    metadata: {},
  });
  // has_role fact -> role capability inheritance -> can_edit file requiring cap-code
  e.addFact({ predicate: "requires_capability", args: ["x.ts", "cap-code"] });
  check("ingested agent inherits role capability (can_edit)", await e.evaluate("agent-1", "edit", "x.ts"), true);
  // direct has_capability fact
  e.addFact({ predicate: "requires_capability", args: ["y.ts", "cap-plan"] });
  check("ingested agent direct capability (can_edit)", await e.evaluate("agent-1", "edit", "y.ts"), true);
  // has_tool fact reachable through a custom rule
  e.addRule({
    head: { predicate: "can_execute", terms: ["?A", "?T"] },
    body: [{ predicate: "has_tool", terms: ["?A", "?T"] }],
  });
  check("ingested agent has_tool (can_execute)", await e.evaluate("agent-1", "execute", "tool-read"), true);
  check("other agent has no tool", await e.evaluate("agent-2", "execute", "tool-read"), false);
}

// --- Scenario 6: ingestOntology(Artifact) -> resource / restricted / owner ------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.ingestOntology({
    "@id": "art-1", "@type": "Artifact", name: "spec", type: "doc",
    owner_id: "alice", metadata: [{ restricted: true }],
  });
  check("restricted artifact denied for stranger", await e.evaluate("bob", "access", "art-1"), false);
  check("restricted artifact denied for owner without clearance", await e.evaluate("alice", "access", "art-1"), false);
  e.addFact({ predicate: "has_clearance", args: ["alice", "art-1"] });
  check("owner with clearance can access (owned_by rule)", await e.evaluate("alice", "access", "art-1"), true);
  // requires via base relation -> requires_capability
  e.ingestOntology({
    "@id": "art-2", "@type": "Artifact", name: "code", type: "file",
    owner_id: "bob", requires: ["cap-code"], metadata: [],
  });
  e.addFact({ predicate: "has_capability", args: ["dave", "cap-code"] });
  check("artifact 'requires' -> requires_capability (can_access)", await e.evaluate("dave", "read", "art-2"), true);
}

// --- Scenario 7: context injection ----------------------------------------------
{
  const e = new PolicyEngineImpl();
  e.addRule({
    head: { predicate: "can_access", terms: ["?A", "?R"] },
    body: [
      { predicate: "current_user", terms: ["?A"] },
      { predicate: "target_file", terms: ["?R"] },
      { predicate: "business_hours", terms: ["true"] },
    ],
  });
  check("context facts injected (business_hours=true)", await e.evaluate("alice", "read", "f", { business_hours: true }), true);
  check("no context -> denied", await e.evaluate("alice", "read", "f"), false);
  check("context does not leak between calls", await e.evaluate("alice", "read", "f"), false);
  check("context override (business_hours=false)", await e.evaluate("alice", "read", "f", { business_hours: false }), false);
  // structured escape hatch
  const e2 = new PolicyEngineImpl();
  e2.addRule({
    head: { predicate: "can_access", terms: ["?A", "?R"] },
    body: [{ predicate: "on_call", terms: ["?A"] }],
  });
  check("context.facts injected verbatim", await e2.evaluate("alice", "read", "f", {
    facts: [{ predicate: "on_call", args: ["alice"] }],
  }), true);
}

// --- Scenario 8: clear() and loadDefaultRules() idempotency ----------------------
{
  const e = new PolicyEngineImpl();
  e.loadDefaultRules();
  e.loadDefaultRules(); // no-op
  e.addFact({ predicate: "has_role", args: ["alice", "admin"] });
  check("rules work before clear", await e.evaluate("alice", "access", "x"), true);
  e.clear();
  check("clear removes facts and rules", await e.evaluate("alice", "access", "x"), false);
  e.loadDefaultRules(); // reloadable after clear
  e.addFact({ predicate: "has_role", args: ["alice", "admin"] });
  check("rules reloadable after clear", await e.evaluate("alice", "access", "x"), true);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
