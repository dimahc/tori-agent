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

export function classifyTask(description: string, filePaths: string[] = []): TaskClassification {
  const lower = description.toLowerCase();
  const paths = filePaths.map((p) => p.toLowerCase());

  const ambiguityKeywords = /\b(fix|resolve|handle|implement|create|update|delete|refactor|migrate)\b/;
  const sensitivePathRe = /(^|[/\\])(\.env(\.|$)|\.pem$|id_rsa|\.ssh[/\\]|secrets?[/\\]|credentials?[/\\])/;
  const sensitiveSrcPathRe = /src[/\\][^\s]*[/\\](auth|security)/;
  const destructiveRe = /\b(drop|truncate|rm[ -]rf|git push --force|force.?push)\b/;
  const secretHandlingRe =
    /\b(reset|rotate|revoke|change|expose|leak|print|log|delete|remove)\b[^\n]{0,48}\b(passwords?|secrets?|api\s+keys?|access\s+tokens?|credentials?)\b/;
  const breakingChangeRe = /\bbreak(ing|s)?\s+(change|fix)\b|\bbreaking\s+changes?\b/;

  const touchesSensitivePath =
    paths.some((p) => sensitivePathRe.test(p) || sensitiveSrcPathRe.test(p)) ||
    sensitivePathRe.test(lower) ||
    sensitiveSrcPathRe.test(lower);

  const highRisk = touchesSensitivePath || destructiveRe.test(lower) || secretHandlingRe.test(lower);

  let risk_tier: RiskTier = 'low';
  if (highRisk) {
    risk_tier = 'high';
  } else if (ambiguityKeywords.test(lower)) {
    risk_tier = 'medium';
  }

  const complexity = ambiguityKeywords.test(lower) ? 'complex' : 'simple';
  const requires_human = highRisk || breakingChangeRe.test(lower);

  return {
    complexity,
    risk_tier,
    requires_human,
    confidence: 0.8,
  };
}
