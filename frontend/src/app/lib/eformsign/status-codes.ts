/**
 * Eformsign Document Status Codes
 * 
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_api.html#current-status-status-type
 * 
 * These are 3-digit action codes from current_status.status_type
 */

// 완료 (Completed) codes
export const COMPLETED_CODES = [
  "003", // doc_complete: 문서 완료
  "012", // doc_accept_approval: 문서 결재 승인
  "022", // doc_accept_reception: 문서 내부자 승인
  "032", // doc_accept_outsider: 문서 외부자 승인
  "050", // PDF 전송
  "062", // doc_accept_participant: 참여자 승인
  "072", // doc_accept_reviewer: 검토자 승인
  "092", // 대면서명 완료
] as const;

// 거부/반려/취소 (Rejected/Cancelled) codes
export const REJECTED_CODES = [
  "011", // doc_reject_approval: 문서 결재 반려
  "021", // doc_reject_reception: 문서 내부자 반려
  "031", // doc_reject_outsider: 문서 외부자 반려
  "040", // doc_request_revoke: 문서 취소 요청
  "042", // doc_revoke: 문서 취소
  "045", // doc_request_reject: 문서 반려 요청
  "047", // doc_request_delete: 문서 삭제 요청
  "049", // doc_delete: 문서 삭제
  "061", // doc_reject_participant: 참여자 반려
  "071", // doc_reject_reviewer: 검토자 반려
] as const;

// 대기/진행 중 (In-progress) codes - for reference
export const IN_PROGRESS_CODES = [
  "001", // doc_tempsave: 초안
  "002", // doc_create: 문서 작성
  "010", // doc_request_approval: 문서 결재 요청
  "020", // doc_request_reception: 문서 내부자 요청
  "030", // doc_request_outsider: 문서 외부자 요청
  "043", // doc_update: 문서 수정
  "060", // doc_request_participant: 참여자 요청
  "070", // doc_request_reviewer: 검토자 요청
] as const;

// Korean status labels
export type DocumentStatusLabel = "대기" | "완료" | "거부";
export type DocumentStatusCategory = "completed" | "rejected" | "in-progress";

type EformsignWorkflowStatus = {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: unknown;
};

type LegacyListDocument = {
  template?: { name?: unknown } | null;
  recipients?: unknown;
  current_status?: EformsignWorkflowStatus | null;
  last_editor?: { name?: unknown } | null;
  creator?: { name?: unknown } | null;
};

const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];
export const LEGACY_EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"] as const;

// Filter types for API calls
export type DocumentFilterType = "in-progress" | "completed" | "rejected" | null;

/**
 * Normalize status code to 3-digit format
 */
export function normalizeStatusCode(code: string | undefined | null): string {
  return code?.trim()?.padStart(3, "0") || "000";
}

/**
 * Get document status category from status code
 */
export function getStatusCategory(statusCode: string | undefined | null): DocumentStatusCategory {
  const normalized = normalizeStatusCode(statusCode);
  
  if (COMPLETED_CODES.includes(normalized as typeof COMPLETED_CODES[number])) {
    return "completed";
  }
  if (REJECTED_CODES.includes(normalized as typeof REJECTED_CODES[number])) {
    return "rejected";
  }
  return "in-progress";
}

function isProviderReviewStep(currentStatus: EformsignWorkflowStatus | null | undefined): boolean {
  const stepType = currentStatus?.step_type?.trim() ?? "";
  const stepName = currentStatus?.step_name?.trim() ?? "";

  if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) return true;
  if (!stepName || CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) return false;

  const hasProviderOwner = PROVIDER_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
  const hasReviewAction = REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
  return hasProviderOwner && hasReviewAction;
}

/** Legacy only: reviewer/provider confirmation is shown as completed. */
export function getLegacyDocumentStatusCategory(
  currentStatus: EformsignWorkflowStatus | null | undefined,
): DocumentStatusCategory {
  const category = getStatusCategory(currentStatus?.status_type);
  if (category !== "in-progress") return category;

  return normalizeStatusCode(currentStatus?.status_type) === "070" || isProviderReviewStep(currentStatus)
    ? "completed"
    : "in-progress";
}

export function mapLegacyDocumentStatusToLabel(
  currentStatus: EformsignWorkflowStatus | null | undefined,
): DocumentStatusLabel {
  switch (getLegacyDocumentStatusCategory(currentStatus)) {
    case "completed":
      return "완료";
    case "rejected":
      return "거부";
    default:
      return "대기";
  }
}

function collectNames(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectNames(item, depth + 1));
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const ownName = typeof record.name === "string" ? record.name.trim() : "";
  const nestedNames = Object.values(record).flatMap((item) => collectNames(item, depth + 1));
  return ownName ? [ownName, ...nestedNames] : nestedNames;
}

/**
 * Provider-owned review/completed steps make current_status and last_editor
 * point at the branch. The participant list still retains the customer.
 */
export function getLegacyDocumentCustomerName(
  document: LegacyListDocument,
  excludedNames: readonly string[],
): string | null {
  const candidates = [
    ...collectNames(document.recipients),
    ...collectNames(document.current_status?.step_recipients),
    typeof document.last_editor?.name === "string" ? document.last_editor.name.trim() : "",
    typeof document.creator?.name === "string" ? document.creator.name.trim() : "",
  ];

  return candidates.find((name) => name && !excludedNames.includes(name)) ?? null;
}

export function needsLegacyDocumentDetail(
  document: LegacyListDocument,
  excludedNames: readonly string[],
): boolean {
  const templateName = typeof document.template?.name === "string"
    ? document.template.name.trim()
    : "";

  return templateName.includes("계약서")
    && getLegacyDocumentCustomerName(document, excludedNames) === null;
}

export function hydrateLegacyDocumentCustomerName<T extends LegacyListDocument>(
  document: T,
  customerName: string | null | undefined,
): T {
  const normalizedName = customerName?.trim();
  if (!normalizedName) return document;

  const recipients = Array.isArray(document.recipients) ? document.recipients : [];
  return {
    ...document,
    recipients: [...recipients, { name: normalizedName }],
  };
}

/**
 * Map status code to Korean label
 */
export function mapStatusToLabel(statusCode: string | undefined | null): DocumentStatusLabel {
  const category = getStatusCategory(statusCode);
  
  switch (category) {
    case "completed":
      return "완료";
    case "rejected":
      return "거부";
    default:
      return "대기";
  }
}

/**
 * Get chip color for status
 */
export function getStatusColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  const lowerStatus = status.toLowerCase();
  
  if (lowerStatus.includes("완료") || lowerStatus.includes("complete") || lowerStatus.includes("signed")) {
    return "success";
  }
  if (lowerStatus.includes("대기") || lowerStatus.includes("pending") || lowerStatus.includes("진행")) {
    return "warning";
  }
  if (lowerStatus.includes("거부") || lowerStatus.includes("reject")) {
    return "error";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "default";
  }
  return "info";
}
