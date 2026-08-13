export interface SkillInstallReceipt {
  schema: 'agent.install.plan.v1';
  installer: string;
  target_platforms: string[];
  skills_planned: Array<{
    name: string;
    path: string;
    content_hash?: string;
    signature?: string;
  }>;
  files_planned: string[];
  writes_started: boolean;
  next_safe_action: string;
}

export function emitSkillInstallReceipt(
  installer: string,
  skills: Array<{
    name: string;
    path: string;
    content_hash?: string;
    signature?: string;
  }>,
  files: string[],
): SkillInstallReceipt {
  return {
    schema: 'agent.install.plan.v1',
    installer,
    target_platforms: ['opencode', 'kilocode'],
    skills_planned: skills.map((s) => ({
      name: s.name,
      path: s.path,
      content_hash: s.content_hash,
      signature: s.signature,
    })),
    files_planned: files,
    writes_started: false,
    next_safe_action: 'review plan, then run sync with --apply',
  };
}

export function validateSkillPermissions(
  skillName: string,
  permissions: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];

  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const denyWrite = Array.isArray(permissions.deny_write) ? permissions.deny_write : [];
  const network = permissions.network as Record<string, unknown> | undefined;

  if (allow.includes('bash') || allow.includes('write') || allow.includes('edit')) {
    warnings.push(
      `Skill "${skillName}" requests broad execution/write permissions. Consider narrowing to specific paths or commands.`,
    );
  }

  if (network && ((network.allow as string[] | undefined)?.length ?? 0) > 5) {
    warnings.push(
      `Skill "${skillName}" requests ${(network.allow as string[]).length} network allowlist entries. Consider whether all are necessary.`,
    );
  }

  if (network && (network.deny as string | undefined) === '*') {
    warnings.push(
      `Skill "${skillName}" uses network.deny="*" — this is good practice, but ensure required domains are in network.allow.`,
    );
  }

  if (!denyWrite.includes('SOUL.md') && !denyWrite.includes('MEMORY.md') && !denyWrite.includes('AGENTS.md')) {
    warnings.push(
      `Skill "${skillName}" does not deny_write to identity files (SOUL.md, MEMORY.md, AGENTS.md). Consider adding them.`,
    );
  }

  return warnings;
}
