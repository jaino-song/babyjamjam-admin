import type { DocumentStatusLabel } from "@/lib/eformsign/status-codes";

export * from "@babyjamjam/shared/types/eformsign";

// UI-only view model: derived from raw eformsign documents for list rendering.
export interface EformsignDocumentView {
  doc_id: string;
  customer_name: string;
  created_date: number;
  status: DocumentStatusLabel;
}

// Raw per-doc signals from `GET /api/documents/status-counts` (branch-scoped,
// HQ-aware). Folded into the StatsBar counters by `foldContractStats`. The
// fields come from each doc's live eformsign `current_status`.
export interface EformsignStatusCountsResponse {
  documents: Array<{ status_type: string | null; step_recipient_types: Array<string | null> }>;
}
