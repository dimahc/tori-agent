import type { AgentPermissions } from '../codegen/types.js';

export function mergePermissionSets(
  parent: AgentPermissions,
  child: AgentPermissions
): AgentPermissions {
  const result: AgentPermissions = {};

  const denySet = new Set([...(parent.deny ?? []), ...(child.deny ?? [])]);
  if (denySet.size > 0) result.deny = [...denySet];

  const parentAllowedTools = new Set([
    ...(parent.allow ?? []),
    ...Object.keys(parent.allow_paths ?? {}),
    ...Object.keys(parent.allow_commands ?? {}),
  ]);

  const childAllowedTools = new Set(child.allow ?? []);
  const allowed = [...childAllowedTools].filter((tool) => parentAllowedTools.has(tool));
  if (allowed.length > 0) result.allow = allowed;

  const parentPaths = parent.allow_paths ?? {};
  const childPaths = child.allow_paths ?? {};
  const mergedPaths: Record<string, string[]> = {};

  for (const [tool, childToolPaths] of Object.entries(childPaths)) {
    if (!parentAllowedTools.has(tool)) continue;
    const parentToolPaths = parentPaths[tool];
    if (parentToolPaths) {
      const parentSet = new Set(parentToolPaths);
      const intersected = childToolPaths.filter((p) => parentSet.has(p));
      if (intersected.length > 0) mergedPaths[tool] = intersected;
    } else {
      mergedPaths[tool] = childToolPaths;
    }
  }

  for (const tool of allowed) {
    if (parentPaths[tool] && !(tool in childPaths)) {
      mergedPaths[tool] = parentPaths[tool];
    }
  }

  if (Object.keys(mergedPaths).length > 0) result.allow_paths = mergedPaths;

  const parentCommands = parent.allow_commands ?? {};
  const childCommands = child.allow_commands ?? {};
  const mergedCommands: Record<string, string[]> = {};

  for (const [tool, childToolCommands] of Object.entries(childCommands)) {
    if (!parentAllowedTools.has(tool)) continue;
    const parentToolCommands = parentCommands[tool];
    if (parentToolCommands) {
      const parentSet = new Set(parentToolCommands);
      const intersected = childToolCommands.filter((c) => parentSet.has(c));
      if (intersected.length > 0) mergedCommands[tool] = intersected;
    } else {
      mergedCommands[tool] = childToolCommands;
    }
  }

  for (const tool of allowed) {
    if (parentCommands[tool] && !(tool in childCommands)) {
      mergedCommands[tool] = parentCommands[tool];
    }
  }

  if (Object.keys(mergedCommands).length > 0) result.allow_commands = mergedCommands;

  return result;
}
