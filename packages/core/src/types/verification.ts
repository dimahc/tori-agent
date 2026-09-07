/**
 * @file packages/core/src/types/verification.ts
 * @description Type definitions for verification policies.
 */

export interface VerificationPolicy {
  require_mechanical_checks?: boolean;
  require_tests?: boolean;
  require_lint?: boolean;
  max_deliberations?: number;
  auto_advance?: boolean;
}