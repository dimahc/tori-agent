import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { CHECK_POLICY, CHECK_STATUS, type RuntimePaths } from "@tori-agent/ontology";
import type { CIConfig } from "../types/ci.js";
import { recordCheckResult } from "./workflow.js";

const exec = promisify(execCallback);

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
  try {
    const { stdout, stderr } = await exec(config.command, {
      cwd: config.working_dir || projectRoot,
      env: { ...process.env, ...config.env },
      timeout: config.timeout || 300000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await recordCheckResult(runtimePaths, workflowRunId, `check:ci:${config.command}`, CHECK_STATUS.passed, "CI command passed", CHECK_POLICY.blocking);
    return { success: true, stdout, stderr, exitCode: 0, durationMs: Date.now() - started };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message: string };
    await recordCheckResult(runtimePaths, workflowRunId, `check:ci:${config.command}`, CHECK_STATUS.failed, err.stderr ?? err.message, CHECK_POLICY.blocking);
    return {
      success: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: err.code ?? 1,
      durationMs: Date.now() - started,
    };
  }
}
