import type { ManagedArtifactFrontmatter, OntologyId, RuntimeId, WorkflowRun } from "@tori-agent/ontology";

export interface ProjectionMetadata {
  classification: "derived-operational-view" | "narrative-checkpoint" | "narrative-append";
  authoritative: false;
  generated_at: string;
}

export interface ScanProvenance {
  scan_mode: "filesystem-scan";
  runtime_root: string;
  sources: string[];
}

export interface ArtifactState extends ManagedArtifactFrontmatter {
  file: string;
  runtime_id: RuntimeId;
  unchecked_blocks?: number;
  checked_blocks?: number;
}

export interface ProjectStateReport {
  projection: ProjectionMetadata & {
    surface: "project_state";
    reproducible_from: ["managed artifact frontmatter", "workflow snapshots", "workflow journals"];
  };
  provenance: ScanProvenance;
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
  projection: ProjectionMetadata & {
    surface: "check_artifacts";
    reproducible_from: ["project_state projection"];
  };
  provenance: ScanProvenance & {
    based_on_project_state_generated_at: string;
  };
  valid: boolean;
  issues: ConsistencyIssue[];
  summary: string;
}

export interface CheckpointWriteResult {
  file: string;
  bytes: number;
  projection: ProjectionMetadata & {
    surface: "checkpoint";
    classification: "narrative-checkpoint";
    narrative_only: true;
    reproducible_from: [];
  };
}

export interface ScratchpadWriteResult {
  file: string;
  bytes: number;
  projection: ProjectionMetadata & {
    surface: "scratchpad" | "write_append";
    classification: "narrative-append";
    narrative_only: true;
    reproducible_from: [];
  };
}
