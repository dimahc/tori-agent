import { spawnSync } from 'node:child_process';
import type { CIConfig, CIResult } from '../types/ci.js';
import { splitCommandLine } from '../tools/lifecycle.js';
import { emitProgress } from '../runtime/feedback.js';

export async function trigger_ci_check(
  projectRoot: string,
  config: CIConfig,
  workflowId: string,
): Promise<CIResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  emitProgress({
    session_id: workflowId,
    stage: 'verify',
    percent: 85,
    message: `Starting CI check (${config.provider})`,
    timestamp,
  });

  let bin: string, args: string[];
  try {
    [bin, ...args] = splitCommandLine(config.command);
  } catch (err) {
    const result: CIResult = {
      status: 'error',
      output: `malformed command: ${(err as Error).message}`,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    emitProgress({
      session_id: workflowId,
      stage: 'verify',
      percent: 90,
      message: `CI check error`,
      timestamp: result.timestamp,
    });
    return result;
  }

  if (!bin) {
    const result: CIResult = {
      status: 'error',
      output: 'empty command',
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    emitProgress({
      session_id: workflowId,
      stage: 'verify',
      percent: 90,
      message: `CI check error`,
      timestamp: result.timestamp,
    });
    return result;
  }

  const result = spawnSync(bin, args, {
    cwd: projectRoot,
    shell: false,
    encoding: 'utf-8',
    timeout: config.timeout_ms,
    maxBuffer: 1024 * 1024,
  });

  const duration_ms = Date.now() - startTime;
  let status: CIResult['status'];
  let output: string;

  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    status = 'timeout';
    output = `command timed out after ${config.timeout_ms}ms: ${config.command}`;
  } else if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOBUFS') {
    status = 'error';
    output = `command output exceeded maxBuffer: ${config.command}`;
  } else if (result.error) {
    status = 'error';
    output = result.error.message;
  } else if (result.status === 127 || result.status === 126) {
    status = 'error';
    output = `command not found: ${bin}`;
  } else if (result.status === 0) {
    status = 'passed';
    output = (result.stdout ?? '').trim();
  } else {
    status = 'failed';
    output = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  }

  const ciResult: CIResult = {
    status,
    output: output || '(no output)',
    duration_ms,
    timestamp: new Date().toISOString(),
  };

  emitProgress({
    session_id: workflowId,
    stage: 'verify',
    percent: 90,
    message: `CI check ${status}`,
    timestamp: ciResult.timestamp,
  });

  return ciResult;
}
