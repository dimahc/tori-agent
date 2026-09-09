import type {
  EvidenceAnchor,
  OntologyId,
  WorkflowCheckRecord,
  WorkflowRun,
  WorkflowTaskRecord,
  WorkflowTransitionRecord,
} from "@tori-agent/ontology";

export interface WorkflowProjectionMetadata {
  surface: "workflow_state";
  classification: "workflow-state-projection";
  authoritative: false;
  generated_at: string;
  reproducible_from: ["workflow snapshot", "workflow journal"];
  provenance: {
    workflow_run_id: OntologyId;
    snapshot_file: string;
    journal_directory: string;
  };
}

export interface WorkflowSnapshotSection {
  authority: "authoritative-snapshot";
  workflow_run: WorkflowRun;
}

export interface WorkflowJournalEvidenceSection {
  authority: "append-only-evidence";
  transition_records: WorkflowTransitionRecord[];
  task_records: WorkflowTaskRecord[];
  check_records: WorkflowCheckRecord[];
}

export interface WorkflowBoundedCognitionProjectionSection {
  authority: "authoritative-snapshot-derived";
  bounded_cognition: NonNullable<WorkflowRun["loop_state"]>["bounded_cognition"];
  evidence_anchor_expectation: "durable-decision-relevant-claims-require-anchors";
  durable_claim_anchor_kinds: EvidenceAnchor["anchor_kind_id"][];
}

export interface WorkflowLatestProjectionSection {
  authority: "latest-only-projection";
  task_records: WorkflowTaskRecord[];
  task_state_index?: WorkflowRun["task_state_index"];
  check_records: WorkflowCheckRecord[];
  check_state_index?: WorkflowRun["check_state_index"];
}

export interface WorkflowStateView {
  projection: WorkflowProjectionMetadata;
  snapshot: WorkflowSnapshotSection;
  journal_evidence: WorkflowJournalEvidenceSection;
  latest_projections: WorkflowLatestProjectionSection;
  bounded_cognition: WorkflowBoundedCognitionProjectionSection;
}
