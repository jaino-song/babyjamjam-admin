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
  "080", // doc_expired: 문서 만료
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
export type DocumentStatusLabel = "대기" | "완료" | "만료";

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
export function getStatusCategory(statusCode: string | undefined | null): "completed" | "rejected" | "in-progress" {
  const normalized = normalizeStatusCode(statusCode);
  
  if (COMPLETED_CODES.includes(normalized as typeof COMPLETED_CODES[number])) {
    return "completed";
  }
  if (REJECTED_CODES.includes(normalized as typeof REJECTED_CODES[number])) {
    return "rejected";
  }
  return "in-progress";
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
      return "만료";
    default:
      return "대기";
  }
}

/**
 * Badge variant type for shadcn Badge component
 */
export type BadgeVariant = "success" | "warning" | "destructive" | "info" | "secondary" | "default";

/**
 * Get Badge variant for status (shadcn Badge compatible)
 */
export function getStatusColor(status: string): BadgeVariant {
  const lowerStatus = status.toLowerCase();

  if (lowerStatus.includes("완료") || lowerStatus.includes("complete") || lowerStatus.includes("signed")) {
    return "success";
  }
  if (lowerStatus.includes("대기") || lowerStatus.includes("pending") || lowerStatus.includes("진행")) {
    return "warning";
  }
  if (lowerStatus.includes("만료") || lowerStatus.includes("expired") || lowerStatus.includes("reject")) {
    return "destructive";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "secondary";
  }
  return "info";
}

