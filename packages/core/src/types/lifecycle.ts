/**
 * @file packages/core/src/types/lifecycle.ts
 * @description Type definitions for lifecycle management (exec-plans, specs, briefs, workflows).
 */

export interface ArtifactPaths {
  specs: string;
  execPlans: string;
  briefs: string;
  workflows: string;
}

export interface SpecFrontmatter {
  title: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  created: string;
  updated?: string;
  id?: string;
}

export interface ExecPlanFrontmatter {
  title: string;
  status: 'planned' | 'active' | 'completed' | 'archived';
  created: string;
  updated?: string;
  id?: string;
  brief?: string;
}

export interface BriefFrontmatter {
  title: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  created: string;
  updated?: string;
  id?: string;
}

export interface WorkflowFrontmatter {
  title: string;
  status: 'active' | 'completed' | 'archived';
  created: string;
  updated?: string;
  id?: string;
  current_stage?: string;
  iteration?: number;
}

export interface ProjectStateReport {
  specs: SpecState[];
  execPlans: ExecPlanState[];
  briefs: BriefState[];
  workflows: WorkflowState[];
}

export interface SpecState {
  file: string;
  title: string;
  status: string;
  created: string;
  updated?: string;
}

export interface ExecPlanState {
  file: string;
  title: string;
  status: string;
  created: string;
  updated?: string;
  blocks: PlanBlock[];
}

export interface PlanBlock {
  name: string;
  checked: boolean;
  description?: string;
}

export interface BriefState {
  file: string;
  title: string;
  status: string;
  created: string;
  updated?: string;
}

export interface WorkflowState {
  file: string;
  title: string;
  status: string;
  created: string;
  updated?: string;
  current_stage?: string;
  iteration?: number;
}

export interface ArtifactConsistencyReport {
  valid: boolean;
  issues: ConsistencyIssue[];
}

export interface ConsistencyIssue {
  type: 'dead_reference' | 'stale_status' | 'missing_link';
  artifact: string;
  reference: string;
  message: string;
}