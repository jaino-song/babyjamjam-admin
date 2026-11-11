// Mirror of new admin rules; pinned by backend parity specs and /tmp/legacy-contract-stage-parity.cjs.
import { UnsupportedKoreanHolidayYearError } from "../business-days";
import {
  CONTRACT_DOC_DISPLAY_STATUS_LABELS,
  resolveContractDocDisplayStatus,
  type ContractDocDisplayStatus,
  type ContractDocDisplayStatusLabel,
} from "./eformsign-doc-status";
import {
  getStatusCategory,
  isDeletedStatusCode,
  isReviewerRejectedEformsignStatus,
  isRevokeRequestedEformsignStatus,
  isRevokedEformsignStatus,
  type EformsignStatusCategory,
} from "./eformsign-status-codes";

export { getStatusCategory, normalizeStatusCode, mapStatusToLabel, isProviderReviewWorkflowStep } from "./eformsign-status-codes";
export type DocumentStatusLabel = ContractDocDisplayStatusLabel;
export type DocumentStatusCategory = EformsignStatusCategory;
export type DocumentFilterType = "all" | "in-progress" | "completed" | "expired";

type EformsignWorkflowStatus = {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: unknown;
};

type LegacyListDocument = {
  template?: { name?: unknown } | null;
  fields?: unknown;
  recipients?: unknown;
  current_status?: EformsignWorkflowStatus | null;
  last_editor?: { name?: unknown } | null;
  creator?: { name?: unknown } | null;
};

const CUSTOMER_NAME_FIELD_IDS = new Set(["이용자 성명", "고객명", "산모명", "산모 성명"]);
export const LEGACY_EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"] as const;

/** Inbox types 01/03/04 do not determine category membership. */
export function filterDocumentsByStatus<T extends { current_status?: EformsignWorkflowStatus | null }>(
  docs: T[], type: DocumentFilterType,
): T[] {
  return docs.filter((doc) => type === "all"
    ? !isDeletedStatusCode(doc.current_status?.status_type)
    : getStatusCategory(doc.current_status?.status_type) === type);
}

/** Preserve the new admin wrapper's revoke/reviewer checks, then unknown ordering. */
export function resolveDocDisplayStatus(
  currentStatus: EformsignWorkflowStatus | null | undefined,
  contractEndDate?: string | null,
  now?: Date,
): ContractDocDisplayStatus {
  if (isRevokeRequestedEformsignStatus(currentStatus?.status_type)) return "revoke_requested";
  if (isRevokedEformsignStatus(currentStatus?.status_type)) return "revoked";
  if (isReviewerRejectedEformsignStatus(currentStatus?.status_type)) return "rejected_by_reviewer";
  const category = getStatusCategory(currentStatus?.status_type);
  if (category === "unknown") return "unknown";
  return resolveContractDocDisplayStatus({ category, currentStatus, contractEndDate, now });
}

export function mapLegacyDocumentStatusToLabel(
  currentStatus: EformsignWorkflowStatus | null | undefined,
  contractEndDate?: string | null,
  now?: Date,
): DocumentStatusLabel {
  try {
    return CONTRACT_DOC_DISPLAY_STATUS_LABELS[resolveDocDisplayStatus(currentStatus, contractEndDate, now)];
  } catch (error) {
    if (error instanceof UnsupportedKoreanHolidayYearError) return CONTRACT_DOC_DISPLAY_STATUS_LABELS.review;
    throw error;
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

function collectCustomerFieldNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const field = item as Record<string, unknown>;
    const id = typeof field.id === "string" ? field.id.trim() : "";
    const fieldValue = typeof field.value === "string" ? field.value.trim() : "";
    return CUSTOMER_NAME_FIELD_IDS.has(id) && fieldValue ? [fieldValue] : [];
  });
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
    ...collectCustomerFieldNames(document.fields),
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

/** Exact labels only: signed and completed have different colours. */
export function getStatusColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  switch (status) {
    case "서명 대기":
    case "검토 필요":
    case "철회 요청됨":
    case "대기":
      return "warning";
    case "서명 완료":
      return "info";
    case "계약 완료":
    case "완료":
      return "success";
    case "반려됨":
    case "철회됨":
    case "기간 만료":
      return "error";
    default:
      return "default";
  }
}
