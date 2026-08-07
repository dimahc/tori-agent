// packages/core/src/types/adr.ts
// ADR schema types for architecture decision logging.

export type ADRStatus = "proposed" | "accepted" | "rejected" | "superseded";

export interface ADR {
  id: string;
  title: string;
  status: ADRStatus;
  context: string;
  decision: string;
  rationale: string;
  consequences: string;
  date: string;
  related_adrs: string[];
}

export interface RegisterADRResult {
  file: string;
  bytes: number;
}
