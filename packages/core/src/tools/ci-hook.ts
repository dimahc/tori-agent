import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { CHECK_POLICY, CHECK_STATUS, EVIDENCE_ANCHOR_KIND, type RuntimePaths } from "@tori-agent/ontology";
import type { CIConfig } from "../types/ci.js";
import { getReviewCheck, splitCommandLine } from "./lifecycle.js";
import { recordCheckResult } from "./workflow.js";

const exec = promisify(execCallback);
const SAFE_VERIFICATION_BINARIES = new Set(["npm", "node"]);

export interface CICheckResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function trigger_ci_check(
  projectRoot: string,
  runtimePaths: RuntimePaths,
  config: CIConfig,
  workflowRunId: string,
): Promise<CICheckResult> {
  const started = Date.now();
  const reviewCheck = await getReviewCheck(projectRoot, config.check_id);
  if (!reviewCheck) {
    throw new Error(`Unknown review check: ${config.check_id}`);
  }
  const [binary] = splitCommandLine(reviewCheck.command);
  if (!binary || !SAFE_VERIFICATION_BINARIES.has(binary)) {
    throw new Error(`Unsafe CI check command for ${config.check_id}: ${reviewCheck.command}`);
  }

  try {
    const { stdout, stderr } = await exec(reviewCheck.command, {
      cwd: projectRoot,
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await recordCheckResult(
      runtimePaths,
      workflowRunId,
      `check:ci:${config.check_id}`,
      CHECK_STATUS.passed,
      `CI check passed: ${reviewCheck.command}`,
      CHECK_POLICY.blocking,
      [{
        anchor_kind_id: EVIDENCE_ANCHOR_KIND.toolInvocation,
        anchor_target: `ci:${config.check_id}:${reviewCheck.command}`,
        anchor_label: `CI check ${config.check_id}`,
        anchor_detail: reviewCheck.command,
      }],
    );
    return { success: true, stdout, stderr, exitCode: 0, durationMs: Date.now() - started };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message: string };
    await recordCheckResult(
      runtimePaths,
      workflowRunId,
      `check:ci:${config.check_id}`,
      CHECK_STATUS.failed,
      err.stderr ?? err.message,
      CHECK_POLICY.blocking,
      [{
        anchor_kind_id: EVIDENCE_ANCHOR_KIND.toolInvocation,
        anchor_target: `ci:${config.check_id}:${reviewCheck.command}`,
        anchor_label: `CI check ${config.check_id}`,
        anchor_detail: err.stderr ?? err.message,
      }],
    );
    return {
      success: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: err.code ?? 1,
      durationMs: Date.now() - started,
    };
  }
}
