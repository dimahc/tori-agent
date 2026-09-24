import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ENTITY_TYPES, POLICY_EFFECT, POLICY_KIND, buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { PolicyEngineImpl } from "../dist/policy/engine.js";
import { buildPlugin } from "../../harness/dist/plugin.js";
import { buildReadOnlyTools, buildWriteTools, createAuthorizedToolExecutor } from "../dist/plugin/index.js";

const AGENTS = {
    tori: "agent:tori",
    engineer: "agent:specialist:software-engineer",
    reviewer: "agent:reviewer:quality",
};

const OPERATION_SIZE_POLICIES = {
    write: "policy:operation-size-write",
    task: "policy:operation-size-task",
    compress: "policy:operation-size-compress",
};

async function makeRuntime() {
    const root = await mkdtemp(join(tmpdir(), "tori-operation-size-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({});
    return { runtime, runtimePaths, root };
}

function authorize(runtime, runtimePaths, agentId, toolName, operation) {
    return runtime.getPolicyEngine().authorize({
        agentId,
        toolName,
        toolId: `tool:${toolName}`,
        runtimePaths,
        ...operation,
    });
}

// Synthetic bundle: an ask policy is the only match for write when no payload
// measurement is present, so the engine must choose ask unless the
// operation-size deny fires first (deny > allow > ask).
function makeSyntheticAskEngine() {
    const engineer = {
        "@id": AGENTS.engineer,
        "@type": ENTITY_TYPES.Agent,
        label: "Engineer",
        description: "Synthetic engineer for precedence test",
        role_ids: ["role:test-engineer"],
        capability_ids: [],
        tool_ids: ["tool:write"],
        prompt_ref: "prompt:test-engineer",
        metadata: { color: "blue", human_tone: false, mode: "subagent", temperature: 0.1, runtime_ids: ["opencode"] },
    };
    const role = {
        "@id": "role:test-engineer",
        "@type": ENTITY_TYPES.Role,
        label: "Test engineer",
        description: "Synthetic role with no write grant",
        capability_ids: [],
        permission_grants: [],
    };
    const writeTool = {
        "@id": "tool:write",
        "@type": ENTITY_TYPES.Tool,
        label: "write",
        description: "Synthetic write tool",
        capability_ids: [],
    };
    const askPolicy = {
        "@id": "policy:test-write-ask",
        "@type": ENTITY_TYPES.Policy,
        label: "Write ask",
        description: "Synthetic ask policy for write",
        policy_kind_id: POLICY_KIND.authorization,
        effect: POLICY_EFFECT.ask,
        tool_ids: ["tool:write"],
    };
    const sizePolicy = {
        "@id": "policy:test-operation-size-write",
        "@type": ENTITY_TYPES.Policy,
        label: "Write size",
        description: "Synthetic operation-size policy for write",
        policy_kind_id: POLICY_KIND.operationSize,
        effect: POLICY_EFFECT.deny,
        tool_ids: ["tool:write"],
        max_operation_bytes: 100,
    };
    const bundle = {
        graph: [engineer, role, writeTool, askPolicy, sizePolicy],
        agents: [engineer],
        roles: [role],
        capabilities: [],
        reasoningModes: [],
        tools: [writeTool],
        workflowDefinitions: [],
        workflowStages: [],
        workflowTransitions: [],
        policies: [askPolicy, sizePolicy],
        byId: new Map(),
    };
    return new PolicyEngineImpl(bundle);
}

describe("operation-size policy", () => {
    test("operation-size policies resolve from the ontology bundle", async () => {
        const { runtime } = await makeRuntime();
        const bundle = runtime.getBundle();
        const policies = bundle.policies.filter((policy) => policy.policy_kind_id === POLICY_KIND.operationSize);
        assert.equal(policies.length, 3);
        const byId = new Map(policies.map((policy) => [policy["@id"], policy]));

        const write = byId.get(OPERATION_SIZE_POLICIES.write);
        assert.ok(write, "policy:operation-size-write present");
        assert.equal(write.effect, POLICY_EFFECT.deny);
        assert.deepEqual([...write.tool_ids].sort(), ["tool:edit", "tool:write", "tool:write_append"]);
        assert.equal(write.max_operation_bytes, 8192);
        assert.equal(write.max_operation_lines, 300);

        const task = byId.get(OPERATION_SIZE_POLICIES.task);
        assert.ok(task, "policy:operation-size-task present");
        assert.equal(task.effect, POLICY_EFFECT.deny);
        assert.deepEqual(task.tool_ids, ["tool:task"]);
        assert.equal(task.max_operation_bytes, 8192);

        const compress = byId.get(OPERATION_SIZE_POLICIES.compress);
        assert.ok(compress, "policy:operation-size-compress present");
        assert.equal(compress.effect, POLICY_EFFECT.deny);
        assert.deepEqual(compress.tool_ids, ["tool:compress"]);
        assert.equal(compress.max_operation_bytes, 8192);

        for (const policy of policies) {
            assert.equal(policy.subject_agent_ids, undefined, `${policy["@id"]} binds all agents`);
            assert.equal(policy.subject_role_ids, undefined, `${policy["@id"]} binds all roles`);
        }
    });

    test("oversized write/edit/task/compress payloads deny with limit-naming reason", async () => {
        const { runtime, runtimePaths } = await makeRuntime();
        const cases = [
            {
                agent: AGENTS.engineer,
                tool: "write",
                operation: { operation_bytes: 9000 },
                reason: /write denied by policy:operation-size-write: payload 9000 bytes exceeds 8192/,
            },
            {
                agent: AGENTS.engineer,
                tool: "edit",
                operation: { operation_bytes: 9000 },
                reason: /edit denied by policy:operation-size-write: payload 9000 bytes exceeds 8192/,
            },
            {
                agent: AGENTS.engineer,
                tool: "write",
                operation: { operation_lines: 301 },
                reason: /write denied by policy:operation-size-write: payload 301 lines exceeds 300/,
            },
            {
                agent: AGENTS.tori,
                tool: "task",
                operation: { operation_bytes: 9000 },
                reason: /task denied by policy:operation-size-task: payload 9000 bytes exceeds 8192/,
            },
            {
                agent: AGENTS.tori,
                tool: "compress",
                operation: { operation_bytes: 9000 },
                reason: /compress denied by policy:operation-size-compress: payload 9000 bytes exceeds 8192/,
            },
        ];
        for (const { agent, tool, operation, reason } of cases) {
            const decision = authorize(runtime, runtimePaths, agent, tool, operation);
            assert.equal(decision.effect, "deny", `${agent} ${tool}`);
            assert.match(decision.reason, reason);
            const expectedPolicy = tool === "edit" ? OPERATION_SIZE_POLICIES.write : OPERATION_SIZE_POLICIES[tool];
            assert.ok(decision.matchedGrantIds.includes(expectedPolicy), `${tool} matched ${expectedPolicy}`);
        }
    });

    test("undersized payloads allow when a grant exists", async () => {
        const { runtime, runtimePaths } = await makeRuntime();
        const cases = [
            { agent: AGENTS.engineer, tool: "write", operation: { operation_bytes: 100, operation_lines: 10 } },
            { agent: AGENTS.engineer, tool: "edit", operation: { operation_bytes: 100, operation_lines: 10 } },
            { agent: AGENTS.tori, tool: "task", operation: { operation_bytes: 100 } },
            { agent: AGENTS.tori, tool: "compress", operation: { operation_bytes: 100 } },
        ];
        for (const { agent, tool, operation } of cases) {
            const decision = authorize(runtime, runtimePaths, agent, tool, operation);
            assert.equal(decision.effect, "allow", `${agent} ${tool}`);
        }
    });

    test("operation-size deny beats allow grant and ask policy", async () => {
        const { runtime, runtimePaths } = await makeRuntime();

        // deny > allow: engineer holds a write allow grant; oversized payload still denies
        const overAllow = authorize(runtime, runtimePaths, AGENTS.engineer, "write", { operation_bytes: 9000 });
        assert.equal(overAllow.effect, "deny");
        assert.match(overAllow.reason, /policy:operation-size-write/);
        const underAllow = authorize(runtime, runtimePaths, AGENTS.engineer, "write", { operation_bytes: 100 });
        assert.equal(underAllow.effect, "allow");

        // deny > ask: synthetic bundle where an ask policy is the only match without
        // measurement; the operation-size deny must still fire first
        const synthetic = makeSyntheticAskEngine();
        const askBaseline = synthetic.authorize({ agentId: AGENTS.engineer, toolName: "write", toolId: "tool:write", runtimePaths });
        assert.equal(askBaseline.effect, "ask");
        const overAsk = synthetic.authorize({
            agentId: AGENTS.engineer,
            toolName: "write",
            toolId: "tool:write",
            runtimePaths,
            operation_bytes: 300,
        });
        assert.equal(overAsk.effect, "deny");
        assert.match(overAsk.reason, /policy:test-operation-size-write/);
        const underAsk = synthetic.authorize({
            agentId: AGENTS.engineer,
            toolName: "write",
            toolId: "tool:write",
            runtimePaths,
            operation_bytes: 50,
        });
        assert.equal(underAsk.effect, "ask");
    });

    test("operation-size policies bind tori and sub-agents", async () => {
        const { runtime, runtimePaths } = await makeRuntime();
        // tori write/edit are shadowed by policy:tori-no-direct-mutation (a deny
        // authorization policy evaluated before operation-size), so tori is
        // asserted on task/compress where the operation-size deny is observable.
        const cases = [
            { agent: AGENTS.tori, tool: "task", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.tori, tool: "compress", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.engineer, tool: "write", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.engineer, tool: "task", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.engineer, tool: "compress", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.reviewer, tool: "write", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.reviewer, tool: "task", operation: { operation_bytes: 9000 } },
            { agent: AGENTS.reviewer, tool: "compress", operation: { operation_bytes: 9000 } },
        ];
        for (const { agent, tool, operation } of cases) {
            const decision = authorize(runtime, runtimePaths, agent, tool, operation);
            assert.equal(decision.effect, "deny", `${agent} ${tool}`);
            assert.match(decision.reason, new RegExp(`policy:operation-size-${tool}`));
        }
    });

    test("compress payload measurement flows through the native tool hook", async () => {
        const root = await mkdtemp(join(tmpdir(), "tori-operation-size-hook-"));
        const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
        const plugin = await factory({ directory: root, worktree: root });

        await plugin["chat.message"]({ sessionID: "s-tori-compress", agent: "tori" }, {});

        await assert.rejects(
            () => plugin["tool.execute.before"](
                { tool: "compress", sessionID: "s-tori-compress", callID: "1" },
                { args: { content: "x".repeat(9000) } },
            ),
            /Unauthorized native tool execution for compress: compress denied by policy:operation-size-compress: payload \d+ bytes exceeds 8192/,
        );

        await plugin["tool.execute.before"](
            { tool: "compress", sessionID: "s-tori-compress", callID: "2" },
            { args: { content: "small payload" } },
        );
    });

    test("write_append managed-path payload measurement flows through createAuthorizedToolExecutor", async () => {
        const root = await mkdtemp(join(tmpdir(), "tori-operation-size-write-append-"));
        const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
        const runtime = await initializeOntologyRuntime({});
        const { buildReadOnlyTools, buildWriteTools, createAuthorizedToolExecutor } = await import("../dist/plugin/index.js");
        const tools = createAuthorizedToolExecutor(
            { ...buildReadOnlyTools(root, runtimePaths), ...buildWriteTools(root, runtimePaths, "opencode") },
            { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
        );

        // engineer: oversized write_append (>8192 B) denied with limit-naming reason
        await assert.rejects(
            () => tools.write_append.execute({ file: "notes.md", content: "x".repeat(9000) }, { sessionID: "s-engineer-wa", directory: root, agent: "specialist:software-engineer" }),
            /Unauthorized tool execution for write_append: write_append denied by policy:operation-size-write: payload \d+ bytes exceeds 8192/,
        );

        // engineer: undersized write_append allowed
        const under = await tools.write_append.execute({ file: "small.md", content: "tiny payload" }, { sessionID: "s-engineer-wa2", directory: root, agent: "specialist:software-engineer" });
        assert.match(under, /"file"/);

        // tori: write_append denied by policy:tori-no-direct-mutation (not operation-size)
        await assert.rejects(
            () => tools.write_append.execute({ file: "tori.md", content: "x".repeat(100) }, { sessionID: "s-tori-wa", directory: root, agent: "tori" }),
            /Unauthorized tool execution for write_append: write_append denied by policy:tori-no-direct-mutation/,
        );
    });
});
