/**
 * @file packages/core/src/tools/ci-hook.ts
 * @description CI check trigger tool.
 * 
 * Runs a CI command and records the result as a workflow check.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CIConfig } from '../types/ci.js';

const execAsync = promisify(exec);

export interface CICheckResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export async function trigger_ci_check(
  projectRoot: string,
  config: CIConfig,
  workflowId: string
): Promise<CICheckResult> {
  const startTime = Date.now();
  
  try {
    const { stdout, stderr } = await execAsync(config.command, {
      cwd: config.working_dir || projectRoot,
      env: { ...process.env, ...config.env },
      timeout: config.timeout || 300000,
      maxBuffer: 1024 * 1024 * 10, // 10MB
    });

    return {
      success: true,
      stdout,
      stderr,
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      duration: Date.now() - startTime,
    };
  }
}