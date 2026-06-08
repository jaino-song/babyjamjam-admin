import type { DocumentStatusLabel } from "./status-codes";

export * from "@babyjamjam/shared/types/eformsign";

// View model for displaying documents
export interface EformsignDocumentView {
  doc_id: string;
  customer_name: string;
  created_date: number;
  status: DocumentStatusLabel;
}
