import type { OntologyId, WorkflowRun } from "@tori-agent/ontology";

export interface WorkflowStateView {
  workflow_run: WorkflowRun;
  task_records: Array<{
    "@id": OntologyId;
    label: string;
    requesting_agent_id: OntologyId;
    result_status_id: OntologyId;
    plan_block_name?: string;
    detail?: string;
  }>;
  task_record_index?: WorkflowRun["task_record_index"];
  check_records: Array<{
    "@id": OntologyId;
    label: string;
    check_policy_id: OntologyId;
    result_status_id: OntologyId;
    detail: string;
  }>;
}
