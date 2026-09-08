import {
  CHECK_POLICY,
  CHECK_STATUS,
  TASK_STATUS,
  WORKFLOW_STAGE,
  buildRuntimePaths,
} from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { createWorkflowRun, recordCheckResult, transitionStage } from "../dist/tools/workflow.js";

const runtime = await initializeOntologyRuntime();
const bundle = runtime.getBundle();
const engine = runtime.getPolicyEngine();

const runtimePaths = buildRuntimePaths("/tmp/tori-policy-test", "opencode", "/tmp/tori-policy-test/.opencode");
await createWorkflowRun(runtimePaths, "workflow-run:policy-test");

const allowRead = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "read",
  toolId: "tool:read",
  runtimePaths,
});
if (allowRead.effect !== "allow") {
  console.error("FAIL specialist read should allow", allowRead);
  process.exit(1);
}

const denyToriWrite = engine.authorize({
  agentId: "agent:tori",
  toolName: "write",
  toolId: "tool:write",
  pattern: "README.md",
  runtimePaths,
});
if (denyToriWrite.effect !== "deny") {
  console.error("FAIL tori write should deny", denyToriWrite);
  process.exit(1);
}

await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.planning);
await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.execution);
await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.verification);

let workflowState = await import("../dist/tools/workflow.js").then((mod) => mod.getWorkflowState(runtimePaths, "workflow-run:policy-test"));
let transition = engine.canTransition(workflowState.workflow_run, WORKFLOW_STAGE.delivery);
if (transition.allowed) {
  console.error("FAIL delivery should block before mechanical check");
  process.exit(1);
}

await recordCheckResult(runtimePaths, "workflow-run:policy-test", "check:mechanical", CHECK_STATUS.passed, "ok", CHECK_POLICY.blocking);
workflowState = await import("../dist/tools/workflow.js").then((mod) => mod.getWorkflowState(runtimePaths, "workflow-run:policy-test"));
transition = engine.canTransition(workflowState.workflow_run, WORKFLOW_STAGE.delivery);
if (!transition.allowed) {
  console.error("FAIL delivery should allow after mechanical check", transition);
  process.exit(1);
}

transition = engine.canTransition(workflowState.workflow_run, WORKFLOW_STAGE.execution);
if (transition.allowed) {
  console.error("FAIL verification to execution should block without failed blocking check", transition);
  process.exit(1);
}

const denyEnv = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "read",
  toolId: "tool:read",
  pattern: ".env",
  runtimePaths,
});
if (denyEnv.effect !== "deny") {
  console.error("FAIL env read should deny", denyEnv);
  process.exit(1);
}

console.log("ALL CHECKS PASSED", {
  agents: bundle.agents.length,
  roles: bundle.roles.length,
  checks: [allowRead.effect, denyToriWrite.effect, transition.allowed],
  sampleStatus: TASK_STATUS.running,
});
