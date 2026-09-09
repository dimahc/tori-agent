import {
  CHECK_POLICY,
  CHECK_STATUS,
  EVIDENCE_ANCHOR_KIND,
  TASK_STATUS,
  WORKFLOW_STAGE,
  buildRuntimePaths,
} from "@tori-agent/ontology";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { createWorkflowRun, recordCheckResult, transitionStage } from "../dist/tools/workflow.js";

const runtime = await initializeOntologyRuntime();
const bundle = runtime.getBundle();
const engine = runtime.getPolicyEngine();

const root = await mkdtemp(join(tmpdir(), "tori-policy-test-"));
const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
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

const allowStructuredReadReviewer = engine.authorize({
  agentId: "agent:reviewer:quality",
  toolName: "structured_read",
  toolId: "tool:structured_read",
  pattern: "README.md",
  runtimePaths,
});
if (allowStructuredReadReviewer.effect !== "allow") {
  console.error("FAIL reviewer structured_read should allow", allowStructuredReadReviewer);
  process.exit(1);
}

const allowStructuredReadSpecialist = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "structured_read",
  toolId: "tool:structured_read",
  pattern: "README.md",
  runtimePaths,
});
if (allowStructuredReadSpecialist.effect !== "allow") {
  console.error("FAIL specialist structured_read should allow", allowStructuredReadSpecialist);
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

const denyToriEdit = engine.authorize({
  agentId: "agent:tori",
  toolName: "edit",
  toolId: "tool:edit",
  pattern: "README.md",
  runtimePaths,
});
if (denyToriEdit.effect !== "deny") {
  console.error("FAIL tori edit should deny", denyToriEdit);
  process.exit(1);
}

const denyToriBash = engine.authorize({
  agentId: "agent:tori",
  toolName: "bash",
  toolId: "tool:bash",
  pattern: "npm test",
  runtimePaths,
});
if (denyToriBash.effect !== "deny") {
  console.error("FAIL tori bash should deny", denyToriBash);
  process.exit(1);
}

const denyToriCi = engine.authorize({
  agentId: "agent:tori",
  toolName: "trigger_ci_check",
  toolId: "tool:trigger_ci_check",
  runtimePaths,
});
if (denyToriCi.effect !== "deny") {
  console.error("FAIL tori trigger_ci_check should deny", denyToriCi);
  process.exit(1);
}

await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.planning);
await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.execution);
await transitionStage(runtimePaths, runtime, "workflow-run:policy-test", WORKFLOW_STAGE.verification);

let workflowState = await import("../dist/tools/workflow.js").then((mod) => mod.getWorkflowState(runtimePaths, "workflow-run:policy-test"));
let transition = engine.canTransition(workflowState.snapshot.workflow_run, WORKFLOW_STAGE.delivery);
if (transition.allowed) {
  console.error("FAIL delivery should block before mechanical check");
  process.exit(1);
}

const loopAnchors = [{
  anchor_kind_id: EVIDENCE_ANCHOR_KIND.toolInvocation,
  anchor_target: "check:mechanical",
  anchor_label: "mechanical check",
  anchor_detail: "ok",
}];
await recordCheckResult(runtimePaths, "workflow-run:policy-test", "check:mechanical", CHECK_STATUS.passed, "ok", CHECK_POLICY.blocking, loopAnchors);
workflowState = await import("../dist/tools/workflow.js").then((mod) => mod.getWorkflowState(runtimePaths, "workflow-run:policy-test"));
transition = engine.canTransition(workflowState.snapshot.workflow_run, WORKFLOW_STAGE.delivery);
if (!transition.allowed) {
  console.error("FAIL delivery should allow after mechanical check", transition);
  process.exit(1);
}

if (workflowState.snapshot.workflow_run.check_state_index["check:mechanical"].record_id !== workflowState.latest_projections.check_records[0]["@id"]) {
  console.error("FAIL snapshot should point to latest check record", workflowState.snapshot.workflow_run.check_state_index, workflowState.latest_projections.check_records);
  process.exit(1);
}

transition = engine.canTransition(workflowState.snapshot.workflow_run, WORKFLOW_STAGE.execution);
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

const denyEnvStructuredRead = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "structured_read",
  toolId: "tool:structured_read",
  pattern: ".env",
  runtimePaths,
});
if (denyEnvStructuredRead.effect !== "deny") {
  console.error("FAIL env structured_read should deny", denyEnvStructuredRead);
  process.exit(1);
}

const allowSpecialistPwd = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "bash",
  toolId: "tool:bash",
  pattern: "pwd",
  runtimePaths,
});
if (allowSpecialistPwd.effect !== "allow") {
  console.error("FAIL specialist pwd should allow", allowSpecialistPwd);
  process.exit(1);
}

const allowReviewerGitLog = engine.authorize({
  agentId: "agent:reviewer:quality",
  toolName: "bash",
  toolId: "tool:bash",
  pattern: "git log --oneline -10",
  runtimePaths,
});
if (allowReviewerGitLog.effect !== "allow") {
  console.error("FAIL reviewer git log should allow", allowReviewerGitLog);
  process.exit(1);
}

const denySpecialistGitAdd = engine.authorize({
  agentId: "agent:specialist:software-engineer",
  toolName: "bash",
  toolId: "tool:bash",
  pattern: "git add README.md",
  runtimePaths,
});
if (denySpecialistGitAdd.effect !== "deny") {
  console.error("FAIL specialist git add should deny", denySpecialistGitAdd);
  process.exit(1);
}

const loopPolicy = engine.getExecutionLoopPolicy("agent:tori", "tool:skill");
if (
  loopPolicy.max_identical_invocations !== 2 ||
  loopPolicy.max_identical_failures !== 2 ||
  loopPolicy.max_consecutive_failures !== 3 ||
  loopPolicy.max_investigation_actions !== 6 ||
  loopPolicy.max_search_actions !== 4 ||
  loopPolicy.max_speculation_actions !== 2 ||
  loopPolicy.max_missing_context_failures !== 1
) {
  console.error("FAIL tori loop policy missing", loopPolicy);
  process.exit(1);
}

const outputPolicy = engine.getOutputGovernancePolicy("agent:tori");
if (outputPolicy.max_repeated_paragraphs !== 1 || outputPolicy.max_repeated_sentences !== 1 || outputPolicy.max_self_talk_markers !== 0) {
  console.error("FAIL tori output policy missing", outputPolicy);
  process.exit(1);
}

console.log("ALL CHECKS PASSED", {
  agents: bundle.agents.length,
  roles: bundle.roles.length,
  checks: [allowRead.effect, allowStructuredReadReviewer.effect, allowStructuredReadSpecialist.effect, denyToriWrite.effect, denyToriEdit.effect, denyToriBash.effect, denyToriCi.effect, denyEnvStructuredRead.effect, allowSpecialistPwd.effect, allowReviewerGitLog.effect, denySpecialistGitAdd.effect, transition.allowed, loopPolicy.max_identical_invocations, outputPolicy.max_self_talk_markers],
  sampleStatus: TASK_STATUS.running,
});
const anchorKinds = workflowState.snapshot.workflow_run.check_state_index["check:mechanical"].evidence_anchors.map((anchor) => anchor.anchor_kind_id).sort();
if (JSON.stringify(anchorKinds) !== JSON.stringify([
  EVIDENCE_ANCHOR_KIND.journalRecord,
  EVIDENCE_ANCHOR_KIND.toolInvocation,
  EVIDENCE_ANCHOR_KIND.workflowField,
].sort())) {
  console.error("FAIL check snapshot should persist evidence anchors", workflowState.snapshot.workflow_run.check_state_index["check:mechanical"]);
  process.exit(1);
}
