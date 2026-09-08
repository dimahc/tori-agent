import type { OntologyId } from "@tori-agent/ontology";

export interface VerificationPolicy {
  required_check_ids?: OntologyId[];
  auto_transition_to?: OntologyId;
}
