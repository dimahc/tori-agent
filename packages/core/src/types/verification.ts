// packages/core/src/types/verification.ts
// Verification schema types for the Tori redesign.
// Provides structured check results, policies, and routing decisions.

/**
 * Result of a single verification check.
 */
export interface VerificationCheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  confidence: number; // 0.0–1.0
  detail: string;
  auto_retry: boolean;
}

/**
 * A single check definition within a verification policy.
 */
export interface VerificationCheck {
  name: string;
  required: boolean;
  threshold?: number; // confidence threshold for this specific check
  max_iterations?: number; // per-check override of global max_iterations
}

/**
 * Policy governing how verification checks are executed and routed.
 */
export interface VerificationPolicy {
  task_type: string;
  max_iterations: number;
  auto_retry_threshold: number; // confidence below this triggers auto_retry
  escalate_threshold: number; // confidence below this triggers escalate (for required checks)
  checks: VerificationCheck[];
}

/**
 * Routing decision produced by confidence-based routing logic.
 */
export interface RoutingDecision {
  action: 'auto_retry' | 'return_to_orchestrator' | 'escalate';
  reason: string;
  retry_check_name?: string;
}
