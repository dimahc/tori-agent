/**
 * @file packages/core/src/types/ci.ts
 * @description Type definitions for CI configuration.
 */

export interface CIConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  working_dir?: string;
}