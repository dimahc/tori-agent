import type { Conversation } from '../conversation/types.js';
import { getToolSchema } from './tool-schema.js';
import {
  projectState,
  markBlockDone,
  completePlan,
  registerSpec as registerSpecImpl,
  checkArtifacts,
  runMechanicalChecks,
} from '../tools/lifecycle.js';
import type { ArtifactPaths } from '../tools/lifecycle.js';

export interface ToolRegistry {
  [name: string]: {
    description: string;
    args: Record<string, unknown>;
    execute(args: Record<string, unknown>): Promise<string>;
  };
}

export function buildReadOnlyTools(
  projectRoot: string,
  paths: ArtifactPaths
): ToolRegistry {
  return {
    project_state: {
      description:
        'Return a structured report of the current state of all management artifacts ' +
        '(exec-plans, specs, briefs) in the project. Call at the start of every mission.',
      args: {},
      async execute() {
        try {
          return JSON.stringify(await projectState(projectRoot, paths));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    check_artifacts: {
      description:
        'Cross-artifact consistency scan — detects dead references, stale statuses, ' +
        'and missing links between exec-plans, specs, and briefs.',
      args: {},
      async execute() {
        try {
          return JSON.stringify(await checkArtifacts(projectRoot, paths));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    run_mechanical_checks: {
      description:
        'Run the project\'s mechanical pre-filter (lint then tests) before spawning ' +
        'semantic reviewers. Call at the start of every review.',
      args: {},
      async execute() {
        try {
          return JSON.stringify(await runMechanicalChecks(projectRoot));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  };
}

export function buildWriteTools(
  projectRoot: string,
  paths: ArtifactPaths
): ToolRegistry {
  return {
    mark_block_done: {
      description: 'Check a specific block in an exec-plan ([ ] → [x]). Call after each validated delivery.',
      args: { plan_file: {}, block_name: {} },
      async execute({ plan_file, block_name }: { plan_file?: string; block_name?: string }) {
        try {
          return JSON.stringify(await markBlockDone(projectRoot, plan_file!, block_name!));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    complete_plan: {
      description:
        'Set an exec-plan\'s status to "completed" in its frontmatter. ' +
        'Refuses if any unchecked blocks remain.',
      args: { plan_file: {} },
      async execute({ plan_file }: { plan_file?: string }) {
        try {
          return JSON.stringify(await completePlan(projectRoot, plan_file!));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    register_spec: {
      description:
        'Create a new spec file with minimal frontmatter (title, status: draft, created). ' +
        'Refuses to overwrite existing files.',
      args: {
        spec_file: {},
        title: {},
      },
      async execute({ spec_file, title }: { spec_file?: string; title?: string }) {
        try {
          return JSON.stringify(await registerSpecImpl(projectRoot, paths, spec_file!, title!));
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  };
}
