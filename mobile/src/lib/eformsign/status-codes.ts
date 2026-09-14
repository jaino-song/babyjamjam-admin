/**
 * Eformsign Document Status Codes
 * 
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_api.html#current-status-status-type
 * 
 * These are 3-digit action codes from current_status.status_type
 */
import {
  DELETED_STATUS_CODES,
  COMPLETED_STATUS_CODES,
  EXPIRED_STATUS_CODES,
  IN_PROGRESS_STATUS_CODES,
  getEformsignStatusCategory,
  getEformsignStatusLabel,
  isDeletedEformsignStatusCode,
  normalizeEformsignStatusCode,
  type EformsignStatusCategory,
  type EformsignStatusInput,
} from "@babyjamjam/shared/constants/eformsign-status-codes";
import {
  CONTRACT_DOC_DISPLAY_STATUS_LABELS,
  isContractDocDisplayStatus,
  resolveContractDocStatusLabel,
  type ContractDocDisplayStatusLabel,
} from "@babyjamjam/shared/constants/eformsign-doc-status";

export {
  DELETED_STATUS_CODES,
  COMPLETED_STATUS_CODES,
  EXPIRED_STATUS_CODES,
  IN_PROGRESS_STATUS_CODES,
  getEformsignStatusCategory,
  getEformsignStatusLabel,
  isDeletedEformsignStatusCode,
  isProviderReviewWorkflowStep,
  normalizeEformsignStatusCode,
} from "@babyjamjam/shared/constants/eformsign-status-codes";
export { isContractReviewWindowOpen } from "@babyjamjam/shared/constants/eformsign-doc-status";

// 완료 (Completed) codes
export const COMPLETED_CODES = COMPLETED_STATUS_CODES;

// 삭제됨 (Deleted) codes. Mobile keeps these hidden from the contracts UI.
export const DELETED_CODES = DELETED_STATUS_CODES;

// 기간 만료/반려/취소 bucket codes
export const EXPIRED_CODES = EXPIRED_STATUS_CODES;

// 대기/진행 중 (In-progress) codes - for reference
export const IN_PROGRESS_CODES = IN_PROGRESS_STATUS_CODES;

// Korean status labels. Derived from the shared label map rather than listed
// again here, so a status added on the backend cannot quietly go unlabelled.
export type DocumentStatusLabel = ContractDocDisplayStatusLabel;
export type DocumentStatusCategory = EformsignStatusCategory;

/** Compatibility aliases for the canonical shared status contract. */
export const normalizeStatusCode = normalizeEformsignStatusCode;
export const getStatusCategory = getEformsignStatusCategory;
export const isDeletedStatusCode = isDeletedEformsignStatusCode;

export function mapStatusToLabel(statusCode: EformsignStatusInput): DocumentStatusLabel {
  return getEformsignStatusLabel(statusCode) as DocumentStatusLabel;
}

type EformsignWorkflowStatus = {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: Array<{ recipient_type?: string | null }>;
};

/**
 * Step-aware variant: when a doc is in-progress AND the current workflow step
 * is explicitly the provider review/confirmation step, the customer has signed.
 * That state reads 서명 완료 until the contract end date is within 1 business
 * day, when it flips to 검토 필요 (shared rule — see eformsign-doc-status).
 * Callers that cannot supply an end date get 검토 필요, the pre-date-rule
 * behavior.
 */
export function mapDocStatusLabel(
  currentStatus: EformsignWorkflowStatus | null | undefined,
  contractEndDate?: string | null,
  displayStatus?: string | null,
): DocumentStatusLabel {
  // The backend's serve-time display_status is authoritative when present.
  if (isContractDocDisplayStatus(displayStatus)) {
    return CONTRACT_DOC_DISPLAY_STATUS_LABELS[displayStatus];
  }
  const category = getStatusCategory(currentStatus?.status_type);
  if (category === "unknown") return CONTRACT_DOC_DISPLAY_STATUS_LABELS.unknown;
  return resolveContractDocStatusLabel({
    category,
    currentStatus,
    contractEndDate: contractEndDate ?? null,
  });
}

// Filter types for API calls
export type DocumentFilterType = "in-progress" | "completed" | "expired" | "rejected" | null;

/**
 * Badge variant type for shadcn Badge component
 */
export type BadgeVariant = "success" | "warning" | "destructive" | "info" | "secondary" | "default";

/**
 * Get Badge variant for status (shadcn Badge compatible)
 */
export function getStatusColor(status: string): BadgeVariant {
  const lowerStatus = status.toLowerCase();

  if (lowerStatus.includes("서명 완료")) {
    return "info";
  }
  if (lowerStatus.includes("완료") || lowerStatus.includes("complete") || lowerStatus.includes("signed")) {
    return "success";
  }
  if (lowerStatus.includes("대기") || lowerStatus.includes("pending") || lowerStatus.includes("진행")) {
    return "warning";
  }
  if (lowerStatus.includes("기간 만료") || lowerStatus.includes("만료") || lowerStatus.includes("expired") || lowerStatus.includes("reject")) {
    return "destructive";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "secondary";
  }
  return "info";
}
