import type { DocumentStatusLabel } from "@/lib/eformsign/status-codes";

export * from "@babyjamjam/shared/types/eformsign";

// UI-only view model: derived from raw eformsign documents for list rendering.
export interface EformsignDocumentView {
  doc_id: string;
  customer_name: string;
  created_date: number;
  status: DocumentStatusLabel;
}
