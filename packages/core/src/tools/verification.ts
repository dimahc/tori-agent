// packages/core/src/tools/verification.ts
// Confidence-based routing logic for verification check results.
// Routes check results to auto_retry, return_to_orchestrator, or escalate
// based on policy thresholds and check requirements.
//
// All functions are pure (no side effects) and unit-testable.

import type {
  VerificationCheckResult,
  VerificationCheck,
  VerificationPolicy,
  RoutingDecision,
} from '../types/verification.js';

/**
 * Route a single verification check result to the appropriate action.
 *
 * Routing rules (evaluated in order):
 *
 * 1. PASS  → return_to_orchestrator ("Check passed")
 * 2. SKIP  → return_to_orchestrator ("Check skipped — no retry or escalation")
 * 3. FAIL + required check + confidence < escalate_threshold → escalate
 *    ("Required check failed with low confidence — escalate to human")
 * 4. FAIL + confidence < auto_retry_threshold → auto_retry
 *    ("Low confidence failure — auto-retry with fix")
 * 5. FAIL + confidence >= auto_retry_threshold → return_to_orchestrator
 *    ("High confidence failure — return to orchestrator for decision")
 *
 * The escalate rule takes precedence over auto_retry for required checks
 * with very low confidence, because retrying a fundamentally broken required
 * check is unlikely to succeed and wastes iteration budget.
 */
export function routeCheckResult(
  policy: VerificationPolicy,
  result: VerificationCheckResult,
  check?: VerificationCheck,
): RoutingDecision {
  // Pass: no further action needed.
  if (result.status === 'PASS') {
    return {
      action: 'return_to_orchestrator',
      reason: 'Check passed',
    };
  }

  // Skip: cannot retry or escalate a skipped check.
  if (result.status === 'SKIP') {
    return {
      action: 'return_to_orchestrator',
      reason: 'Check skipped — no retry or escalation',
    };
  }

  // FAIL: evaluate confidence against policy thresholds.
  const isRequired = check?.required === true;
  const belowEscalate = result.confidence < policy.escalate_threshold;
  const belowAutoRetry = result.confidence < policy.auto_retry_threshold;

  // Required checks with very low confidence bypass retry and go straight
  // to human escalation. This prevents burning iteration budget on checks
  // that are unlikely to pass without human intervention.
  if (isRequired && belowEscalate) {
    return {
      action: 'escalate',
      reason: 'Required check failed with low confidence — escalate to human',
    };
  }

  // Low-confidence failures are candidates for automatic retry with fix.
  if (belowAutoRetry) {
    return {
      action: 'auto_retry',
      reason: 'Low confidence failure — auto-retry with fix',
      retry_check_name: result.name,
    };
  }

  // High-confidence failures need orchestrator judgment; the failure is
  // trustworthy enough that automatic retry is unlikely to help.
  return {
    action: 'return_to_orchestrator',
    reason: 'High confidence failure — return to orchestrator for decision',
  };
}
