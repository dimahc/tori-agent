/**
 * @file packages/core/src/tools/skill-validation.ts
 * @description Skill permission validation.
 */

import type { AgentPermissions } from '../types/spec.js';

export function validateSkillPermissions(
  agentId: string,
  permissions: Record<string, unknown>
): string[] {
  const warnings: string[] = [];
  
  // Check for overly broad permissions
  const allow = permissions.allow;
  if (Array.isArray(allow) && allow.includes('*')) {
    warnings.push(`Agent ${agentId}: 'allow: ["*"]' grants unrestricted access`);
  }
  
  // Check for missing deny_write on sensitive paths
  const denyWrite = permissions.deny_write;
  if (Array.isArray(denyWrite) && !denyWrite.some(p => typeof p === 'string' && p.includes('.env'))) {
    warnings.push(`Agent ${agentId}: Consider adding deny_write for .env files`);
  }
  
  // Check for network permissions without domain restrictions
  const network = permissions.network;
  if (network && typeof network === 'object' && 'allow' in network) {
    const allow = (network as { allow?: unknown }).allow;
    if (Array.isArray(allow) && allow.includes('*')) {
      warnings.push(`Agent ${agentId}: 'network.allow: ["*"]' allows unrestricted network access`);
    }
  }
  
  return warnings;
}