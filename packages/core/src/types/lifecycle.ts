import type { ManagedArtifactFrontmatter, OntologyId, RuntimeId, WorkflowRun } from "@tori-agent/ontology";

export interface ArtifactState extends ManagedArtifactFrontmatter {
  file: string;
  runtime_id: RuntimeId;
  unchecked_blocks?: number;
  checked_blocks?: number;
}

export interface ProjectStateReport {
  runtime_id: RuntimeId;
  specs: ArtifactState[];
  exec_plans: ArtifactState[];
  briefs: ArtifactState[];
  workflow_runs: WorkflowRun[];
}

export interface ConsistencyIssue {
  type: "dead_reference" | "stale_status" | "missing_link";
  severity: "error" | "warning";
  artifact_id: OntologyId;
  reference?: OntologyId;
  message: string;
}

export interface ArtifactConsistencyReport {
  valid: boolean;
  issues: ConsistencyIssue[];
  summary: string;
}
