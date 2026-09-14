/**
 * Eformsign Document Status Codes
 * 
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_api.html#current-status-status-type
 * 
 * These are 3-digit action codes from current_status.status_type
 */

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

import {
  DELETED_STATUS_CODES,
  COMPLETED_STATUS_CODES,
  EXPIRED_STATUS_CODES,
  IN_PROGRESS_STATUS_CODES,
  getEformsignStatusCategory,
  getEformsignStatusLabel,
  isDeletedEformsignStatusCode,
  isProviderReviewWorkflowStep,
  normalizeEformsignStatusCode,
  type EformsignStatusCategory,
  type EformsignStatusInput,
} from "@babyjamjam/shared/constants/eformsign-status-codes";
import {
  CONTRACT_DOC_DISPLAY_STATUS_LABELS,
  isContractDocDisplayStatus,
  isContractReviewWindowOpen,
  resolveContractDocStatusLabel,
  type ContractDocDisplayStatusLabel,
} from "@babyjamjam/shared/constants/eformsign-doc-status";

export const COMPLETED_CODES = COMPLETED_STATUS_CODES;
export const EXPIRED_CODES = EXPIRED_STATUS_CODES;
export const IN_PROGRESS_CODES = IN_PROGRESS_STATUS_CODES;

// The frontend does not hide documents by status, but the canonical deleted
// set remains available for callers that need to distinguish visibility from
// semantic classification.
export const DELETED_CODES = DELETED_STATUS_CODES;

// Korean status labels. Derived from the shared label map rather than listed
// again here, so a status added on the backend cannot quietly go unlabelled.
export type DocumentStatusLabel = ContractDocDisplayStatusLabel;
export type DocumentStatusCategory = EformsignStatusCategory;

/** Compatibility aliases for the canonical shared status contract. */
export const normalizeStatusCode = normalizeEformsignStatusCode;
export const isDeletedStatusCode = isDeletedEformsignStatusCode;

// Existing frontend callers use this helper as a filter for the three tabs and
// therefore still narrow its legacy type. The implementation is the canonical
// shared classifier; callers that render unknown states use the canonical
// `getEformsignStatusCategory` export directly below.
type LegacyDocumentStatusCategory = Exclude<EformsignStatusCategory, "unknown">;
export function getStatusCategory(statusCode: EformsignStatusInput): LegacyDocumentStatusCategory {
  return getEformsignStatusCategory(statusCode) as LegacyDocumentStatusCategory;
}

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
  const category = getEformsignStatusCategory(currentStatus?.status_type);
  if (category === "unknown") return CONTRACT_DOC_DISPLAY_STATUS_LABELS.unknown;
  return resolveContractDocStatusLabel({
    category,
    currentStatus,
    contractEndDate: contractEndDate ?? null,
  });
}

/** Badge status token key for a contract document's display label. */
export function contractStatusBadgeType(
  label: DocumentStatusLabel,
): "pending" | "signed" | "review" | "completed" | "expired" {
  switch (label) {
    case "계약 완료":
      return "completed";
    case "기간 만료":
      return "expired";
    case "검토 필요":
    // Shares the attention colour with 검토 필요 because it is one — the row
    // needs an operator, just a different action. What must NOT be shared is
    // the label: the button that renders on 검토 필요 keys on the label text,
    // so this row gets the colour without getting the button.
    case "고객 등록 필요":
      return "review";
    case "서명 완료":
      return "signed";
    default:
      return "pending";
  }
}

// Filter types for API calls
export type DocumentFilterType = "in-progress" | "completed" | "expired" | null;

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
  if (lowerStatus.includes("기간 만료") || lowerStatus.includes("거부") || lowerStatus.includes("reject") || lowerStatus.includes("expired")) {
    return "destructive";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "secondary";
  }
  return "info";
}

/** The StatsBar counters on the contracts page. */
export interface ContractStatsBuckets {
  reviewNeeded: number;
  signed: number;
  sendRequired: number;
  drafting: number;
  expired: number;
}

/**
 * Fold the raw status signals from `GET /api/documents/status-counts` into the
 * four StatsBar buckets. This is the single source of truth for that mapping —
 * it mirrors the per-doc rule that used to live in contracts/page.tsx:
 *   - completed (003 등)           → counted nowhere
 *   - expired category, only 080   → expired (반려/취소 등은 제외)
 *   - draft (001)                  → drafting
 *   - 그 외 in-progress            → 현재 단계가 제공기관 검토/확인이면
 *                                     검토 창(종료일 영업일 1일 전~) 열림 여부에 따라
 *                                     reviewNeeded 또는 signed, 아니면 sendRequired
 * The reviewNeeded/signed test mirrors `mapDocStatusLabel` using the current
 * workflow step fields and contract end date returned by the status-counts
 * endpoint.
 */
export function foldContractStats(
  docs: ReadonlyArray<{
    status_type?: string | null;
    step_type?: string | null;
    step_name?: string | null;
    step_recipient_types?: ReadonlyArray<string | null>;
    contract_end_date?: string | null;
    display_status?: string | null;
  }>,
): ContractStatsBuckets {
  const buckets: ContractStatsBuckets = { reviewNeeded: 0, signed: 0, sendRequired: 0, drafting: 0, expired: 0 };
  for (const doc of docs) {
    const normalized = normalizeStatusCode(doc.status_type);
    const category = getEformsignStatusCategory(doc.status_type);

    if (category === "completed") continue;
    if (category === "unknown") continue;
    if (category === "expired") {
      if (normalized === "080") buckets.expired++;
      continue;
    }
    if (normalized === "001") {
      buckets.drafting++;
      continue;
    }

    if (!isProviderReviewWorkflowStep(doc)) {
      buckets.sendRequired++;
      continue;
    }
    // The backend's serve-time display_status decides the split when present.
    // "unassigned" falls to `signed`, which is true of it — the customer did
    // sign — and is the only honest option among the existing buckets: it is
    // not a review anyone can perform, so counting it under 검토 필요 would
    // send the operator back to the button this change just removed.
    const isReviewDue = isContractDocDisplayStatus(doc.display_status)
      ? doc.display_status === "review"
      : isContractReviewWindowOpen(doc.contract_end_date);
    if (isReviewDue) buckets.reviewNeeded++;
    else buckets.signed++;
  }
  return buckets;
}
