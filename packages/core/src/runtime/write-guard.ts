import { join, isAbsolute, resolve, sep } from 'node:path';
import type { WriteTier, WritePolicy } from '../types/write-path.js';

export function getWritePolicyForTier(tier: WriteTier, taskScope?: string): WritePolicy {
  switch (tier) {
    case 'restricted': {
      const featureDir = taskScope ? extractFeatureDir(taskScope) : 'src/';
      return {
        tier,
        allow_paths: [`${featureDir}**`],
        deny_paths: ['*.env', '**/.env', 'config/**', 'packages/core/src/shared/**'],
      };
    }
    case 'standard':
      return {
        tier,
        allow_paths: ['src/**', 'packages/**', 'docs/**', 'spec/**'],
        deny_paths: ['*.env', '**/.env', 'config/production/**'],
      };
    case 'full':
      return {
        tier,
        allow_paths: ['**'],
        deny_paths: ['*.env', '**/.env'],
      };
  }
}

export function validateWritePath(projectRoot: string, relPath: string, policy: WritePolicy): void {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }

  const relative = normalizedPath.slice(normalizedRoot.length);

  for (const deny of policy.deny_paths) {
    if (pathMatches(relative, deny)) {
      throw new Error(`Write denied by policy: ${relPath} matches deny pattern ${deny}`);
    }
  }

  const allowed = policy.allow_paths.some((pattern) => pathMatches(relative, pattern));
  if (!allowed) {
    throw new Error(`Write denied by policy: ${relPath} does not match any allow pattern`);
  }
}

function pathMatches(relativePath: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*\*/g, '(.*)').replace(/\*/g, '[^/]*') + '$');
  return regex.test(relativePath);
}

function extractFeatureDir(scope: string): string {
  const match = scope.match(/(\w+)/);
  if (match) {
    const feature = match[1].toLowerCase().replace(/\s+/g, '-');
    return `src/${feature}/`;
  }
  return 'src/';
}
