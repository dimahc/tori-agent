export type RiskTier = 'low' | 'medium' | 'high';

export interface ClassificationScore {
  complexity: number;
  risk_tier: RiskTier;
  confidence: number;
}

export interface TaskClassification {
  complexity: string;
  risk_tier: RiskTier;
  requires_human: boolean;
  suggested_agent?: string;
  confidence: number;
}

export function classifyTask(description: string, _filePaths: string[]): TaskClassification {
  const lower = description.toLowerCase();
  const ambiguityKeywords = /\b(fix|resolve|handle|implement|create|update|delete|refactor|migrate|security|auth|password|secret|key|token)\b/;
  const sensitivePaths = /\b(src\/.*auth|src\/.*security|config|\.env|secret|key)\b/;

  let risk_tier: RiskTier = 'low';
  if (sensitivePaths.test(lower) || /security|auth|password|secret|migrate/.test(lower)) {
    risk_tier = 'high';
  } else if (ambiguityKeywords.test(lower)) {
    risk_tier = 'medium';
  }

  const complexity = ambiguityKeywords.test(lower) ? 'complex' : 'simple';
  const requires_human = risk_tier === 'high' || /break(ing|s)?\s+(change|fix)/.test(lower);

  return {
    complexity,
    risk_tier,
    requires_human,
    confidence: 0.8,
  };
}
