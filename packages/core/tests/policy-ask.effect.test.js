import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";

const AGENTS = {
  engineer: "agent:specialist:software-engineer",
  architect: "agent:specialist:software-architect",
  reviewer: "agent:reviewer:quality",
  infra: "agent:specialist:infrastructure",
  security: "agent:specialist:security",
  researcher: "agent:specialist:researcher",
  scribe: "agent:scribe:documentation",
  delivery: "agent:delivery-agent",
};

async function makeRuntime() {
  const root = await mkdtemp(join(tmpdir(), "tori-ask-effect-"));
  const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
  const runtime = await initializeOntologyRuntime({});
  return { runtime, runtimePaths };
}

function decide(runtime, runtimePaths, agentName, command) {
  const sessionID = `s-${agentName}-${Math.random().toString(36).slice(2)}`;
  runtime.bindSession(sessionID, AGENTS[agentName]);
  return runtime.authorizeSession(sessionID, "bash", [command], runtimePaths);
}

describe("bash ask effect", () => {
  test("deny policies are hard and precede allow", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    for (const [agent, command] of [
      ["engineer", "git add README.md"],
      ["reviewer", "git commit -m x"],
      ["engineer", "cat .env"],
      ["engineer", "git push origin main"],
      ["infra", "rm -rf dist"],
      ["scribe", "git commit -m x"],
    ]) {
      const decision = decide(runtime, runtimePaths, agent, command);
      assert.equal(decision.effect, "deny", `${agent} ${command}`);
    }
  });

  test("unmatched engineer and architect commands resolve to ask", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    for (const agent of ["engineer", "architect"]) {
      const decision = decide(runtime, runtimePaths, agent, "node -e console.log(1)");
      assert.equal(decision.effect, "ask", agent);
      assert.match(decision.reason, /pending approval by policy:bash-unknown-ask/);
    }
  });

  test("role mutation families resolve to ask", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    assert.equal(decide(runtime, runtimePaths, "infra", "terraform apply -auto-approve").effect, "ask");
    assert.equal(decide(runtime, runtimePaths, "security", "nmap -sS localhost").effect, "ask");
    assert.equal(decide(runtime, runtimePaths, "researcher", "node -e 1").effect, "ask");
  });

  test("have no ask gate and deny unknown commands", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    for (const agent of ["reviewer", "scribe"]) {
      const decision = decide(runtime, runtimePaths, agent, "node -e console.log(1)");
      assert.equal(decision.effect, "deny", agent);
    }
  });

  test("delivery keeps exclusive git mutation allow", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    assert.equal(decide(runtime, runtimePaths, "delivery", "git add .").effect, "allow");
    assert.equal(decide(runtime, runtimePaths, "delivery", "git commit -m x").effect, "allow");
  });

  test("allow globs match slash-containing paths", async () => {
    const { runtime, runtimePaths } = await makeRuntime();
    assert.equal(decide(runtime, runtimePaths, "reviewer", "git diff packages/core/src/file.ts").effect, "allow");
    assert.equal(decide(runtime, runtimePaths, "infra", "terraform plan -out /tmp/plan.out").effect, "allow");
  });

  test("host permission overlay marks bash ask for catch-all roles and stays allow for reviewer", async () => {
    const { runtime } = await makeRuntime();
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.equal(configs["specialist:software-engineer"].permission.bash, "ask");
    assert.equal(configs["specialist:software-architect"].permission.bash, "ask");
    assert.equal(configs["specialist:infrastructure"].permission.bash, "ask");
    assert.equal(configs["reviewer:quality"].permission.bash, "allow");
  });
});