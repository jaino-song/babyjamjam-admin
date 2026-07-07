"use client";

import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileSignature,
  FileText,
  MessageCircle,
  MoreVertical,
  Send,
  SquarePen,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useRouter } from "next/navigation";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocumentEvents } from "@/hooks/useEformsignDocumentEvents";
import {
  useDeleteEformsignDocument,
  useEformsignDocumentsByType,
  eformsignQueryKeys,
} from "@/hooks/useEformsignDocuments";
import { useEformsign } from "@/hooks/useEformsign";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { useToast } from "@/hooks/use-toast";
import { fetchAllAlimtalkLogs } from "@/lib/alimtalk/logs";
import { EformsignDocument } from "@/lib/eformsign/types";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import {
  getStatusCategory,
  isDeletedStatusCode,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import {
  UNKNOWN_CUSTOMER_NAME,
  contractDisplayName,
  customerName,
  mergeDocumentForDisplayData,
} from "@/lib/eformsign/display-name";
import { isProviderReviewWorkflowStep } from "@/lib/eformsign/review-step";
import {
  CONTRACT_FINALIZE_PROGRESS_STEPS,
  INITIAL_HEADLESS_PROGRESS,
  createHeadlessProgressId,
  getSafeHeadlessFailureMessage,
  isHeadlessProgressStepKey,
  resolveFailedHeadlessProgress,
  resolveNextHeadlessProgress,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
} from "@/lib/eformsign/headless-progress";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import type { EformsignDocClientSummary } from "@babyjamjam/shared/types/eformsign";
import { eformsignApi } from "@/services/api";
import { Badge, ListCard, ListItemRow, ListLoadMoreButton, ListLoadMoreSentinel } from "@/components/app/mobile-redesign/primitives";
import { ActivityTimeline } from "@/components/app/v3";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DetailTabPills,
  type BadgeTone,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailSheet,
  MobileSearchBar,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { useClientDialogStore, type ClientWizardPrefill } from "@/stores/client-dialog-store";
import { useFormStore, type ContractCreationPrefill } from "@/stores/form-store";
import "@/components/app/mobile-redesign/redesign.css";

const STAFF_COMPLETION_IFRAME_ID = "contracts_staff_completion_iframe";

type ContractCategory = "in-progress" | "drafting" | "completed" | "rejected" | "unknown";
type FilterKey = "전체" | "대기" | "검토 필요" | "완료" | "기간 만료" | "상태 확인";
type DetailTabId = "basic" | "signers" | "alimtalk";
type NotificationStatus = "pending" | "sent" | "failed";
type NotificationLogRecord = {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string;
  clientId: number | null;
  messageBody: string;
  status: NotificationStatus | string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt?: string;
  ruleName: string | null;
  eventType: string | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
};
type ContractStageItem = {
  icon: ComponentType<{ className?: string }>;
  iconVariant: "success" | "warning" | "info" | "danger";
  text: ReactNode;
  time: string;
};

const EXCLUDED_CUSTOMER_NAMES: string[] = [];
const CONTRACT_ROUTE_BODY_CLASS = "mobile-contracts-route";
const FILTER_LABELS: FilterKey[] = ["전체", "대기", "검토 필요", "완료", "기간 만료", "상태 확인"];
const CONTRACT_LIST_INITIAL_VISIBLE_COUNT = 9;
const DROPDOWN_DIALOG_HANDOFF_DELAY_MS = 100;
const CONTRACT_OPEN_CODES = new Set(["034", "064", "074", "076"]);
const CONTRACT_OPEN_KEYWORDS = ["doc_open", "open_participant", "open_outsider", "open_reviewer", "open_reader", "열람"];
const CONTRACT_SIGNATURE_CODES = new Set(["032", "062", "092"]);
const CONTRACT_SIGNATURE_KEYWORDS = [
  "doc_accept_outsider",
  "doc_accept_participant",
  "participant_accept",
  "outside_accept",
  "signed",
  "signature",
  "서명 완료",
  "서명완료",
  "참여자 승인",
  "외부자 승인",
];
const CONTRACT_SEND_FAILURE_KEYWORDS = ["fail", "failed", "failure", "error", "실패", "오류"];
const CONTRACT_SEND_EVENT_KEYWORDS = [
  "send",
  "sent",
  "delivery",
  "deliver",
  "mail",
  "sms",
  "kakao",
  "alimtalk",
  "발송",
  "전송",
  "송신",
];
const CONTRACT_EVENT_TYPE_KEYS = [
  "status_type",
  "status",
  "code",
  "event_type",
  "action_type",
  "history_type",
  "type",
  "action",
  "event",
] as const;

type UnknownRecord = Record<string, unknown>;

function ContractListLoadingRows() {
  return (
    <>
      {Array.from({ length: CONTRACT_LIST_INITIAL_VISIBLE_COUNT }).map((_, index) => (
        <div
          className="contracts-loading-row"
          data-component="mobile-contracts-loading-row"
          aria-hidden="true"
          key={`contracts-loading-row-${index}`}
        >
          <span className="contracts-loading-avatar" />
          <span className="contracts-loading-text">
            <span className="contracts-loading-name" />
            <span className="contracts-loading-meta" />
          </span>
          <span className="contracts-loading-badge" />
        </div>
      ))}
    </>
  );
}

function categorize(doc: EformsignDocument): ContractCategory {
  const cat = getStatusCategory(doc.current_status?.status_type);
  if (cat === "completed" || cat === "rejected" || cat === "unknown") return cat;
  return isProviderReviewStep(doc) ? "in-progress" : "drafting";
}

function isProviderReviewStep(doc: EformsignDocument): boolean {
  return isProviderReviewWorkflowStep(doc.current_status);
}

function isReviewNeeded(doc: EformsignDocument): boolean {
  return categorize(doc) === "in-progress" && isProviderReviewStep(doc);
}

function yymmddToIsoDate(value: string): string {
  const v = value.replace(/\D/g, "");
  if (v.length !== 6) return "";
  return `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
}

function yymmddPrefillToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = yymmddToIsoDate(value);
  return iso || undefined;
}

function categoryTones(category: ContractCategory): {
  badge: string;
  badgeTone: "primary" | "green" | "muted" | "orange";
  badgeMini: "primary" | "green" | "muted" | "orange";
  infoTone: "primary" | "green" | "muted" | "orange";
} {
  switch (category) {
    case "completed":
      return {
        badge: "완료",
        badgeTone: "green",
        badgeMini: "green",
        infoTone: "green",
      };
    case "rejected":
      return {
        badge: "만료",
        badgeTone: "muted",
        badgeMini: "muted",
        infoTone: "muted",
      };
    case "drafting":
      return {
        badge: "대기",
        badgeTone: "muted",
        badgeMini: "muted",
        infoTone: "muted",
      };
    case "unknown":
      return {
        badge: "상태 확인",
        badgeTone: "orange",
        badgeMini: "orange",
        infoTone: "orange",
      };
    default:
      return {
        badge: "검토 필요",
        badgeTone: "primary",
        badgeMini: "primary",
        infoTone: "primary",
      };
  }
}

function contractNumber(doc: EformsignDocument): string {
  return doc.document_number || doc.id?.slice(0, 16) || "-";
}

function templateName(doc: EformsignDocument): string {
  return doc.template?.name?.replace(/\s*계약서$/, "") || "";
}

function formatDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "-";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "-";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// "최근 활동순" 정렬 키 — 수정일(updated_date) 우선, 없으면 작성일. (epoch/ISO 모두 허용)
function docRecency(doc: EformsignDocument): number {
  const v = doc.updated_date ?? doc.created_date;
  if (v === undefined || v === null) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
  ];
}

function eventTokensFromRecord(record: UnknownRecord): string[] {
  return [
    ...CONTRACT_EVENT_TYPE_KEYS.map((key) => stringFromUnknown(record[key])),
    ...Object.entries(record)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => `${key}:${value}`),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

function hasOpenEventRecord(record: UnknownRecord): boolean {
  const eventTokens = eventTokensFromRecord(record);

  return eventTokens.some((token) => {
    if (CONTRACT_OPEN_CODES.has(normalizeStatusCode(token))) return true;
    return CONTRACT_OPEN_KEYWORDS.some((keyword) => token.includes(keyword));
  });
}

function hasOpenedDocument(doc: EformsignDocument): boolean {
  for (const source of [doc.histories, doc.previous_status]) {
    if (collectRecords(source).some(hasOpenEventRecord)) return true;
  }
  return CONTRACT_OPEN_CODES.has(normalizeStatusCode(doc.current_status?.status_type));
}

function hasSignatureEventRecord(record: UnknownRecord): boolean {
  const eventTokens = eventTokensFromRecord(record);

  return eventTokens.some((token) => {
    if (CONTRACT_SIGNATURE_CODES.has(normalizeStatusCode(token))) return true;
    return CONTRACT_SIGNATURE_KEYWORDS.some((keyword) => token.includes(keyword));
  });
}

function hasCustomerSignatureDocument(doc: EformsignDocument): boolean {
  for (const source of [doc.histories, doc.previous_status]) {
    if (collectRecords(source).some(hasSignatureEventRecord)) return true;
  }
  return CONTRACT_SIGNATURE_CODES.has(normalizeStatusCode(doc.current_status?.status_type));
}

function hasSendFailureEventRecord(record: UnknownRecord): boolean {
  const eventTokens = eventTokensFromRecord(record);
  const hasFailure = eventTokens.some((token) =>
    CONTRACT_SEND_FAILURE_KEYWORDS.some((keyword) => token.includes(keyword)),
  );
  if (!hasFailure) return false;

  return eventTokens.some((token) =>
    CONTRACT_SEND_EVENT_KEYWORDS.some((keyword) => token.includes(keyword)),
  );
}

function hasDocumentSendFailure(doc: EformsignDocument): boolean {
  for (const source of [
    doc.current_status,
    doc.histories,
    doc.previous_status,
    doc.next_status,
    doc.recipients,
  ]) {
    if (collectRecords(source).some(hasSendFailureEventRecord)) return true;
  }
  return false;
}

function reRequestStepType(doc: EformsignDocument): string {
  return stringFromUnknown(doc.current_status?.step_type) ?? "05";
}

function reRequestStepSeq(doc: EformsignDocument): string {
  return stringFromUnknown(doc.current_status?.step_index) ?? "";
}

function canReRequestDocument(doc: EformsignDocument): boolean {
  return (
    getStatusCategory(doc.current_status?.status_type) === "in-progress" &&
    reRequestStepType(doc) === "05" &&
    Boolean(reRequestStepSeq(doc))
  );
}

function progressLabel(doc: EformsignDocument): string {
  const category = categorize(doc);
  if (category === "completed") return "6/6 - 계약서 완료";
  if (category === "rejected") return "기간 만료";
  if (category === "unknown") return "상태 확인 필요";
  if (hasDocumentSendFailure(doc)) return "이용자 문서 전송 실패";
  if (isReviewNeeded(doc)) return "5/6 - 제공기관 검토 필요";
  if (hasCustomerSignatureDocument(doc)) return "4/6 - 이용자 서명 완료";
  if (hasOpenedDocument(doc)) return "4/6 - 이용자 서명 대기";
  return "3/6 - 이용자 문서 열람 대기";
}

function requestErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ error?: string; message?: string | string[] }>(error)) {
    const data = error.response?.data;
    const message = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    return message ?? data?.error ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
  const valueKeys = ["value", "field_value", "fieldValue", "data", "text"] as const;
  for (const key of valueKeys) {
    const value = stringFromUnknown(record[key]);
    if (value) return value;
  }
  for (const nested of collectRecords(record).slice(1)) {
    for (const key of valueKeys) {
      const value = stringFromUnknown(nested[key]);
      if (value) return value;
    }
  }
  return null;
}

function documentFieldValue(doc: EformsignDocument, fieldIds: readonly string[]): string | null {
  const normalizeFieldId = (value: string) => value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
  const normalizedIds = fieldIds.map(normalizeFieldId);
  for (const record of collectRecords(doc.fields)) {
    const idTokens = [
      stringFromUnknown(record.id),
      stringFromUnknown(record.field_id),
      stringFromUnknown(record.fieldId),
      stringFromUnknown(record.name),
      stringFromUnknown(record.label),
      stringFromUnknown(record.field_name),
      stringFromUnknown(record.fieldName),
      stringFromUnknown(record.display_name),
      stringFromUnknown(record.displayName),
      stringFromUnknown(record.input_id),
      stringFromUnknown(record.inputId),
    ].filter((value): value is string => Boolean(value));

    if (idTokens.some((token) => {
      const normalizedToken = normalizeFieldId(token);
      return normalizedIds.some(
        (id) => normalizedToken === id || normalizedToken.includes(id) || id.includes(normalizedToken),
      );
    })) {
      const value = valueFromFieldRecord(record);
      if (value) return value;
    }
  }
  return null;
}

function providerName(doc: EformsignDocument, metadata?: EformsignDocClientSummary): string {
  const metadataProvider = metadata?.providerName?.trim();
  if (metadataProvider) return metadataProvider;

  const fieldProvider = documentFieldValue(doc, [
    "제공인력 1 성명",
    "제공인력1성명",
    "제공인력 성명",
    "제공인력명",
    "제공인력",
    "관리사 성명",
    "관리사",
    "산후관리사 성명",
    "제공자 성명",
    "caretaker1Name",
    "caretakerName",
    "employeeName",
    "providerName",
  ]);
  if (fieldProvider) return fieldProvider;

  const customer = customerName(doc, metadata);
  const recipients = doc.current_status?.step_recipients ?? [];
  const providerRecipient = recipients.find((recipient) => {
    const name = recipient.name?.trim();
    return Boolean(name && name !== customer);
  });
  return providerRecipient?.name || "-";
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function formatClientPhone(value: string | null | undefined): string | undefined {
  const digits = normalizePhone(value);
  if (digits.length <= 0) return undefined;
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function normalizeDateToYymmdd(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length >= 8) {
    return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  }
  return undefined;
}

function numericText(value: string | null | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || undefined;
}

function parseDuration(value: string | null | undefined): number | null | undefined {
  const digits = numericText(value);
  if (!digits) return undefined;
  const duration = Number(digits);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function twoDigitPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.slice(-2).padStart(2, "0");
}

function documentDatePartValue(doc: EformsignDocument, fieldIds: readonly string[]): string | undefined {
  return numericText(documentFieldValue(doc, fieldIds));
}

function documentDateFromParts(
  doc: EformsignDocument,
  parts: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | undefined {
  const year = twoDigitPart(documentDatePartValue(doc, parts.year));
  const month = twoDigitPart(documentDatePartValue(doc, parts.month));
  const day = twoDigitPart(documentDatePartValue(doc, parts.day));
  if (!year || !month || !day) return undefined;
  const iso = yymmddToIsoDate(`${year}${month}${day}`);
  return iso || undefined;
}

function documentDateFieldToIso(
  doc: EformsignDocument,
  fieldIds: readonly string[],
  parts?: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | undefined {
  const date = normalizeDateToYymmdd(documentFieldValue(doc, fieldIds));
  if (date) return yymmddPrefillToIso(date);
  return parts ? documentDateFromParts(doc, parts) : undefined;
}

const PAYMENT_RECEIPT_DATE_FIELD_IDS = [
  "본인부담금 수령 날짜",
  "본인부담금수령날짜",
  "본인부담금 수령 일자",
  "본인부담금수령일자",
  "본인부담금 수령일",
  "본인부담금수령일",
  "본인 부담금 수령 날짜",
  "본인부담금 결제일",
  "본인부담금 납부일",
  "본인부담금 입금일",
  "결제 예정일",
  "결제예정일",
  "결제일",
  "수령 날짜",
  "수령일",
  "paymentDate",
  "paymentDueDate",
  "receiptDate",
  "receiveDate",
  "receivedDate",
  "actualPriceReceiptDate",
] as const;

const PAYMENT_RECEIPT_DATE_PART_IDS = {
  year: [
    "본인부담금 수령 날짜 년",
    "본인부담금수령날짜년",
    "본인부담금 수령 연도",
    "본인부담금수령연도",
    "본인부담금 수령 년도",
    "본인부담금수령년도",
    "본인부담금 수령 년",
    "본인부담금수령년",
    "본인부담금 수령일 년",
    "본인부담금수령일년",
    "본인 부담금 수령 연도",
    "수령 연도",
    "수령연도",
    "수령 년도",
    "수령년도",
    "수령 년",
    "수령년",
    "결제 연도",
    "결제연도",
    "결제 년도",
    "결제년도",
    "결제 년",
    "결제년",
    "paymentYear",
    "receiptYear",
    "receiveYear",
    "receivedYear",
    "actualPricePaymentYear",
    "actualPriceReceiptYear",
    "copayReceiptYear",
    "selfPayReceiptYear",
    "outOfPocketPaymentYear",
  ],
  month: [
    "본인부담금 수령 날짜 월",
    "본인부담금수령날짜월",
    "본인부담금 수령 월",
    "본인부담금수령월",
    "본인부담금 수령일 월",
    "본인부담금수령일월",
    "본인 부담금 수령 월",
    "수령 월",
    "수령월",
    "결제 월",
    "결제월",
    "paymentMonth",
    "receiptMonth",
    "receiveMonth",
    "receivedMonth",
    "actualPricePaymentMonth",
    "actualPriceReceiptMonth",
    "copayReceiptMonth",
    "selfPayReceiptMonth",
    "outOfPocketPaymentMonth",
  ],
  day: [
    "본인부담금 수령 날짜 일",
    "본인부담금수령날짜일",
    "본인부담금 수령 일",
    "본인부담금수령일",
    "본인부담금 수령일 일",
    "본인부담금수령일일",
    "본인 부담금 수령 일",
    "수령 일",
    "수령일",
    "결제 일",
    "결제일",
    "paymentDay",
    "receiptDay",
    "receiveDay",
    "receivedDay",
    "actualPricePaymentDay",
    "actualPriceReceiptDay",
    "copayReceiptDay",
    "selfPayReceiptDay",
    "outOfPocketPaymentDay",
  ],
} as const;

function contractRecipientPhone(
  doc: EformsignDocument,
  metadata?: EformsignDocClientSummary,
): string | null {
  const recipients = doc.current_status?.step_recipients ?? [];
  const customer = customerName(doc, metadata);
  const customerRecipient =
    recipients.find((recipient) => recipient.name?.trim() === customer && recipient.sms?.trim()) ??
    recipients.find((recipient) => recipient.recipient_type !== "01" && recipient.sms?.trim()) ??
    recipients.find((recipient) => recipient.sms?.trim());
  return customerRecipient?.sms ?? null;
}

function providerRecipientPhone(
  doc: EformsignDocument,
  metadata?: EformsignDocClientSummary,
): string | null {
  const recipients = doc.current_status?.step_recipients ?? [];
  const customer = customerName(doc, metadata);
  const provider = providerName(doc, metadata);
  const providerRecipient =
    recipients.find((recipient) => recipient.name?.trim() === provider && recipient.sms?.trim()) ??
    recipients.find((recipient) => {
      const name = recipient.name?.trim();
      return Boolean(name && name !== customer && recipient.sms?.trim());
    });
  return providerRecipient?.sms ?? null;
}

function buildClientPrefillFromContract(
  doc: EformsignDocument,
  metadata?: EformsignDocClientSummary,
): ClientWizardPrefill {
  const prefill: ClientWizardPrefill = {};
  const name = customerName(doc, metadata);
  const phone = formatClientPhone(
    metadata?.clientPhone?.trim() ||
      contractRecipientPhone(doc, metadata) ||
      documentFieldValue(doc, ["연락처", "휴대폰", "전화번호", "customerContact", "customerPhone"]),
  );

  if (name && name !== "고객 미지정") prefill.name = name;
  if (phone) prefill.phone = phone;

  const birthday = normalizeDateToYymmdd(
    documentFieldValue(doc, ["생년월일", "주민번호 앞자리", "customerDOB", "customerBirthDate", "birthday"]),
  );
  const dueDate = normalizeDateToYymmdd(
    documentFieldValue(doc, ["출산 예정일", "출산예정일", "dueDate", "expectedBirthDate"]),
  );
  const startDate = normalizeDateToYymmdd(
    documentFieldValue(doc, ["서비스 시작일", "서비스시작일", "startDate", "contractStartDate"]),
  );
  const endDate = normalizeDateToYymmdd(
    documentFieldValue(doc, ["서비스 종료일", "서비스종료일", "endDate", "contractEndDate"]),
  );
  const address = documentFieldValue(doc, ["주소", "customerAddress", "address"]);
  const type = documentFieldValue(doc, [
    "바우처 유형",
    "바우처유형",
    "유형",
    "서비스 유형",
    "서비스유형",
    "type",
    "serviceType",
  ]);
  const duration = parseDuration(
    documentFieldValue(doc, [
      "바우처 기간",
      "바우처기간",
      "서비스 기간",
      "서비스기간",
      "서비스 일수",
      "서비스일수",
      "기간",
      "일수",
      "days",
      "duration",
      "contractDuration",
    ]),
  );
  const fullPrice = numericText(documentFieldValue(doc, [
    "총 서비스 금액",
    "총서비스금액",
    "서비스 비용",
    "서비스비용",
    "서비스 가격",
    "서비스가격",
    "서비스 총액",
    "서비스총액",
    "총액",
    "fullPrice",
  ]));
  const grant = numericText(documentFieldValue(doc, ["정부지원금", "지원금", "grant"]));
  const actualPrice = numericText(documentFieldValue(doc, ["본인부담금", "실결제금액", "actualPrice"]));

  if (birthday) prefill.birthday = birthday;
  if (dueDate) prefill.dueDate = dueDate;
  if (address) prefill.address = address;
  if (type) prefill.type = type;
  if (duration !== undefined) prefill.duration = duration;
  if (fullPrice) prefill.fullPrice = fullPrice;
  if (grant) prefill.grant = grant;
  if (actualPrice) prefill.actualPrice = actualPrice;
  if (startDate) prefill.startDate = startDate;
  if (endDate) prefill.endDate = endDate;

  return prefill;
}

function contractEndDateInputValue(
  doc: EformsignDocument,
  metadata?: EformsignDocClientSummary,
): string {
  const clientPrefill = buildClientPrefillFromContract(doc, metadata);
  if (clientPrefill.endDate) return clientPrefill.endDate;

  const endDateIso = documentDateFieldToIso(
    doc,
    ["계약 종료일", "계약종료일", "서비스 종료일", "서비스종료일", "endDate", "contractEndDate"],
    {
      year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "종료 연도", "종료년도", "endYear"],
      month: ["계약 종료 월", "계약종료월", "종료 월", "종료월", "endMonth"],
      day: ["계약 종료 일", "계약종료일", "종료 일", "종료일", "endDay"],
    },
  );

  return normalizeDateToYymmdd(endDateIso) ?? "";
}

function buildContractCreationPrefillFromContract(
  doc: EformsignDocument,
  metadata: EformsignDocClientSummary | undefined,
  employees: readonly Employee[],
): ContractCreationPrefill {
  const clientPrefill = buildClientPrefillFromContract(doc, metadata);
  const startDate =
    yymmddPrefillToIso(clientPrefill.startDate) ??
    documentDateFieldToIso(
      doc,
      ["계약 시작일", "계약시작일", "서비스 시작일", "서비스시작일", "startDate", "contractStartDate"],
      {
        year: ["계약 시작 년도", "계약시작년도", "계약 시작 연도", "계약시작연도", "시작 연도", "시작년도", "startYear"],
        month: ["계약 시작 월", "계약시작월", "시작 월", "시작월", "startMonth"],
        day: ["계약 시작 일", "계약시작일", "시작 일", "시작일", "startDay"],
      },
    );
  const endDate =
    yymmddPrefillToIso(clientPrefill.endDate) ??
    documentDateFieldToIso(
      doc,
      ["계약 종료일", "계약종료일", "서비스 종료일", "서비스종료일", "endDate", "contractEndDate"],
      {
        year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "종료 연도", "종료년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "종료 월", "종료월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "종료 일", "종료일", "endDay"],
      },
    );
  const paymentDate =
    documentDateFieldToIso(
      doc,
      [...PAYMENT_RECEIPT_DATE_FIELD_IDS],
      PAYMENT_RECEIPT_DATE_PART_IDS,
    );
  const provider = providerName(doc, metadata);
  const providerPhone = formatClientPhone(
    documentFieldValue(doc, [
      "제공인력 1 연락처",
      "제공인력1연락처",
      "제공인력 연락처",
      "제공인력 전화번호",
      "관리사 연락처",
      "산후관리사 연락처",
      "caretaker1Contact",
      "caretakerContact",
      "employeePhone",
      "providerPhone",
    ]) || providerRecipientPhone(doc, metadata),
  );
  const normalizedProviderPhone = normalizePhone(providerPhone);
  const matchedEmployee =
    employees.find((employee) => {
      const nameMatches = employee.name.trim() === provider;
      if (!nameMatches) return false;
      return !normalizedProviderPhone || normalizePhone(employee.phone) === normalizedProviderPhone;
    }) ??
    employees.find((employee) => employee.name.trim() === provider);

  return {
    clientId: metadata?.clientId ?? null,
    name: clientPrefill.name,
    phone: clientPrefill.phone,
    birthday: clientPrefill.birthday,
    dueDate: yymmddPrefillToIso(clientPrefill.dueDate),
    address: clientPrefill.address,
    employeeId: matchedEmployee?.id,
    employeeName: matchedEmployee?.name ?? (provider !== "-" ? provider : undefined),
    employeePhone: matchedEmployee?.phone ?? providerPhone,
    startDate,
    endDate,
    fullPrice: clientPrefill.fullPrice,
    grant: clientPrefill.grant,
    actualPrice: clientPrefill.actualPrice,
    paymentDate,
    voucherType: clientPrefill.type,
    voucherDuration: clientPrefill.duration != null ? String(clientPrefill.duration) : undefined,
    area: "",
  };
}

function notificationChannelLabel(log: NotificationLogRecord): "알림톡" | "메시지" {
  return log.provider.toLowerCase().includes("sms") ? "메시지" : "알림톡";
}

function notificationTitle(log: NotificationLogRecord): string {
  if (log.ruleName?.trim()) return log.ruleName;
  if (log.templateKey === "manual_sms") return "수동 메시지";
  return log.templateKey || "발송 내역";
}

function notificationStatusLabel(status: string): string {
  if (status === "failed") return "실패";
  if (status === "pending") return "대기";
  return "완료";
}

function notificationStatusTone(status: string): "green" | "orange" | "burgundy" {
  if (status === "failed") return "burgundy";
  if (status === "pending") return "orange";
  return "green";
}

function formatNotificationTime(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function notificationMatchesDocument(
  log: NotificationLogRecord,
  doc: EformsignDocument,
  metadata?: EformsignDocClientSummary,
): boolean {
  if (metadata?.clientId && log.clientId === metadata.clientId) return true;

  const customer = customerName(doc, metadata);
  const names = new Set(
    [customer, metadata?.clientName]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  if (log.clientName && names.has(log.clientName.trim())) return true;
  if (log.recipientName && names.has(log.recipientName.trim())) return true;

  const phones = new Set(
    [
      metadata?.clientPhone,
      ...((doc.current_status?.step_recipients ?? []).map((recipient) => recipient.sms)),
    ]
      .map(normalizePhone)
      .filter(Boolean),
  );
  return Boolean(normalizePhone(log.receiver) && phones.has(normalizePhone(log.receiver)));
}

function contractStageItems(
  doc: EformsignDocument,
  category: ContractCategory,
): ContractStageItem[] {
  const createdAt = formatDateTime(doc.created_date);
  const updatedAt = formatDateTime(doc.updated_date || doc.created_date);
  const sendFailed = hasDocumentSendFailure(doc);
  const hasOpened = hasOpenedDocument(doc);
  const reviewNeeded = isReviewNeeded(doc);
  const hasCustomerSigned = category === "completed" || reviewNeeded || hasCustomerSignatureDocument(doc);
  const items: ContractStageItem[] = [
    {
      icon: FileText,
      iconVariant: "info",
      text: "문서가 생성되었습니다",
      time: createdAt,
    },
    {
      icon: sendFailed ? X : Send,
      iconVariant: sendFailed ? "danger" : "info",
      text: sendFailed
        ? "이용자에게 문서 전송에 실패했습니다."
        : "이용자에게 문서가 발송되었습니다.",
      time: createdAt,
    },
  ];

  if (sendFailed) return items;

  if (hasOpened || hasCustomerSigned) {
    items.push({
      icon: Eye,
      iconVariant: "info",
      text: "이용자가 문서를 열람했습니다",
      time: updatedAt,
    });
  }

  if (hasCustomerSigned) {
    items.push({
      icon: FileSignature,
      iconVariant: "info",
      text: "이용자가 서명을 완료했습니다",
      time: updatedAt,
    });
  }

  if (category === "completed") {
    items.push(
      {
        icon: FileSignature,
        iconVariant: "success",
        text: "제공기관 검토 완료",
        time: updatedAt,
      },
      {
        icon: CheckCircle2,
        iconVariant: "success",
        text: "계약서가 완료되었습니다",
        time: updatedAt,
      },
    );
    return items;
  }

  if (category === "rejected") {
    items.push({
      icon: AlertTriangle,
      iconVariant: "danger",
      text: "문서 기간이 만료되었습니다",
      time: updatedAt,
    });
    return items;
  }

  items.push({
    icon: reviewNeeded ? FileSignature : hasOpened ? FileSignature : Eye,
    iconVariant: "warning",
    text: reviewNeeded
      ? "제공기관 검토 필요"
      : hasOpened
        ? "이용자 서명 대기중입니다"
        : "이용자 문서 열람 대기중입니다",
    time: "현재",
  });

  return items;
}

function ContractDocRow({
  icon,
  title,
  meta,
  badge,
  tone,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  badge: string;
  tone: "primary" | "green" | "orange" | "muted" | "burgundy";
}) {
  return (
    <div className="doc-row">
      <div className={`doc-icon contract-doc-icon-${tone}`}>{icon}</div>
      <div className="doc-info">
        <div className="doc-title">{title}</div>
        <div className="doc-meta">{meta}</div>
      </div>
      <span className={`badge-mini ${tone}`}>{badge}</span>
    </div>
  );
}

function ContractDetailContent({
  doc,
  metadata,
  notificationLogs,
  activeTab,
  onTabChange,
  onFinalize,
  onOpenClient,
  onEditSend,
  onDeleteRequest,
}: {
  doc: EformsignDocument;
  metadata?: EformsignDocClientSummary;
  notificationLogs: NotificationLogRecord[];
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onFinalize?: (doc: EformsignDocument, metadata?: EformsignDocClientSummary) => void;
  onOpenClient: (doc: EformsignDocument, metadata?: EformsignDocClientSummary) => void;
  onEditSend: (doc: EformsignDocument, metadata?: EformsignDocClientSummary) => void;
  onDeleteRequest: (doc: EformsignDocument) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const [isReRequesting, setIsReRequesting] = useState(false);
  const [detailMenuKey, setDetailMenuKey] = useState(0);
  const category = categorize(doc);
  const tones = categoryTones(category);
  const reviewNeeded = isReviewNeeded(doc);
  const shouldReRequest =
    category === "drafting" && !hasDocumentSendFailure(doc) && canReRequestDocument(doc);
  const shouldShareReceipt = category === "completed";
  const contractNum = contractNumber(doc);
  const name = contractDisplayName(doc, metadata, true);
  const downloadUrl = eformsignApi.getDocumentDownloadUrl(doc.id);
  const receiptDownloadUrl = eformsignApi.getDocumentReceiptDownloadUrl(doc.id);
  const previewUrl = eformsignApi.getDocumentPreviewUrl(doc.id);
  const isPreviewOpen = previewDocumentId === doc.id;
  const statusLabel = tones.badge;
  const stageItems = contractStageItems(doc, category);
  const receiptFilename = `${name} 영수증.pdf`;
  const notificationRows = useMemo(
    () =>
      notificationLogs
        .filter((log) => notificationMatchesDocument(log, doc, metadata))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [doc, metadata, notificationLogs],
  );
  const handleDocumentReRequest = async () => {
    const stepType = reRequestStepType(doc);
    const stepSeq = reRequestStepSeq(doc);

    if (!stepSeq || stepType !== "05") {
      toast({
        variant: "destructive",
        description: "현재 단계에서는 재알림을 보낼 수 없습니다.",
      });
      return;
    }

    setIsReRequesting(true);
    try {
      await eformsignApi.reRequestDocument(doc.id, {
        stepType,
        stepSeq,
        comment: "재요청입니다.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() }),
        queryClient.invalidateQueries({ queryKey: ["eformsign-document-detail", doc.id] }),
        queryClient.invalidateQueries({ queryKey: ["alimtalk", "logs", "all"] }),
      ]);
      toast({
        description: `${customerName(doc, metadata)}님에게 전자문서 작성을 재요청했습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description: requestErrorMessage(error, "재알림 전송 중 오류가 발생했습니다."),
      });
    } finally {
      setIsReRequesting(false);
    }
  };
  const handleReceiptShare = async () => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function" ||
      typeof navigator.canShare !== "function" ||
      typeof File === "undefined"
    ) {
      window.location.assign(receiptDownloadUrl);
      return;
    }

    let canShareReceiptFile = false;
    try {
      canShareReceiptFile = navigator.canShare({
        files: [new File([""], receiptFilename, { type: "application/pdf" })],
      });
    } catch {
      window.location.assign(receiptDownloadUrl);
      return;
    }

    if (!canShareReceiptFile) {
      window.location.assign(receiptDownloadUrl);
      return;
    }

    try {
      const response = await fetch(receiptDownloadUrl, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`Receipt PDF request failed with ${response.status}`);
      }

      const receiptBlob = await response.blob();
      const receiptFile = new File([receiptBlob], receiptFilename, {
        type: receiptBlob.type || "application/pdf",
      });

      if (!navigator.canShare({ files: [receiptFile] })) {
        throw new Error("Receipt PDF file sharing is not supported.");
      }

      await navigator.share({ files: [receiptFile] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.location.assign(receiptDownloadUrl);
    }
  };

  return (
    <MobileDetailPage name="contracts">
      <MobileDetailHeader
        name="contracts"
        avatar={<FileCheck2 size={24} strokeWidth={2.5} />}
        avatarTone="primary"
        title={name}
        badges={[{ label: tones.badge, tone: tones.badgeMini as BadgeTone }]}
        menu={
          <DropdownMenu key={detailMenuKey} modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-v3-text-muted transition-colors hover:bg-v3-dim-white [&_svg]:pointer-events-none"
                aria-label="계약 옵션"
                data-component="mobile-contracts-detail-menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile-contracts-detail-menu"
            >
              <DropdownMenuItem
                onClick={() => onOpenClient(doc, metadata)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-contracts-detail-menu-client"
              >
                <UserPlus className="size-[15px]" strokeWidth={2} />
                {metadata?.clientId ? "고객 수정" : "고객 등록"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onEditSend(doc, metadata)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-contracts-detail-menu-edit-send"
              >
                <Send className="size-[15px]" strokeWidth={2} />
                수정 전송
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDetailMenuKey((key) => key + 1);
                  setTimeout(() => onDeleteRequest(doc), DROPDOWN_DIALOG_HANDOFF_DELAY_MS);
                }}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-contracts-detail-menu-delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {!isPreviewOpen || (reviewNeeded && onFinalize) ? (
        <MobileDetailActions
          name="contracts"
          actions={[
            ...(!isPreviewOpen
              ? [
                  {
                    label: "미리보기",
                    variant: "secondary" as const,
                    onClick: () => setPreviewDocumentId(doc.id),
                    dataComponent: "mobile-contracts-preview",
                  },
                  ...(shouldReRequest || shouldShareReceipt
                    ? [
                        {
                          label: shouldReRequest
                            ? isReRequesting
                              ? "재알림 보내는 중"
                              : "재알림 보내기"
                            : "영수증 공유",
                          variant: "primary" as const,
                          onClick: shouldReRequest ? handleDocumentReRequest : handleReceiptShare,
                          disabled: shouldReRequest ? isReRequesting : false,
                          busy: shouldReRequest ? isReRequesting : false,
                          dataComponent: shouldReRequest
                            ? "mobile-contracts-rerequest"
                            : "mobile-contracts-receipt-share",
                        },
                      ]
                    : []),
                ]
              : []),
            ...(reviewNeeded && onFinalize
              ? [
                  {
                    label: "지금 서명",
                    variant: "primary" as const,
                    onClick: () => onFinalize(doc, metadata),
                    dataComponent: "mobile-contracts-sign",
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {isPreviewOpen ? (
        <section
          className="contract-preview-panel"
          data-component="mobile-contracts-pdf-preview"
          aria-label="계약서 PDF 미리보기"
        >
          <div className="contract-preview-header">
            <button
              type="button"
              className="contract-preview-back"
              data-component="mobile-contracts-pdf-preview-back"
              aria-label="계약 상세로 돌아가기"
              onClick={() => setPreviewDocumentId(null)}
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
              <span>돌아가기</span>
            </button>
            <a
              className="contract-preview-receipt"
              data-component="mobile-contracts-receipt-download"
              href={receiptDownloadUrl}
              download={receiptFilename}
              aria-label={`${name} 영수증 PDF 다운로드`}
            >
              <Download size={16} strokeWidth={2.5} />
              <span>영수증</span>
            </a>
            <a
              className="contract-preview-download"
              data-component="mobile-contracts-pdf-download"
              href={downloadUrl}
              download={`${name}.pdf`}
              aria-label={`${name} PDF 다운로드`}
            >
              <Download size={16} strokeWidth={2.5} />
              <span>다운로드</span>
            </a>
          </div>
          <iframe
            className="contract-preview-frame"
            data-component="mobile-contracts-pdf-preview-frame"
            title={`${name} PDF 미리보기`}
            src={previewUrl}
          />
        </section>
      ) : (
        <>
          <DetailTabPills
            tabs={[
              { id: "basic", label: "기본 정보" },
              { id: "signers", label: "서명 진행" },
              { id: "alimtalk", label: "알림 발송" },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => onTabChange(id as DetailTabId)}
          />

          <MobileDetailTabPanel name="contracts" tabId="basic" activeTab={activeTab}>
            <InfoCard title="이용자 정보">
              <InfoRow label="이용자" value={customerName(doc, metadata)} />
              {metadata?.clientPhone ? (
                <InfoRow label="연락처" value={formatClientPhone(metadata.clientPhone) ?? metadata.clientPhone} />
              ) : null}
              <InfoRow label="제공인력" value={providerName(doc, metadata)} />
            </InfoCard>
            <InfoCard title="계약 정보" delay={60}>
              <InfoRow
                label="계약서 종류"
                value={<span style={{ fontFamily: "'SF Mono', monospace" }}>{contractNum}</span>}
              />
              <InfoRow label="현재 단계" value={statusLabel} tone={tones.infoTone} />
              <InfoRow label="생성일" value={formatDate(doc.created_date)} />
              <InfoRow label="작성자" value={doc.creator?.name ?? "-"} />
              <InfoRow
                label="문서 ID"
                value={<span style={{ fontFamily: "'SF Mono', monospace", wordBreak: "break-all" }}>{doc.id || "-"}</span>}
              />
            </InfoCard>
          </MobileDetailTabPanel>

          <MobileDetailTabPanel name="contracts" tabId="signers" activeTab={activeTab}>
            <InfoCard title="계약서 단계">
              <ActivityTimeline items={stageItems} maxHeight="360px" />
            </InfoCard>
          </MobileDetailTabPanel>

          <MobileDetailTabPanel name="contracts" tabId="alimtalk" activeTab={activeTab}>
            <InfoCard title="발송 내역">
              {notificationRows.length > 0 ? (
                notificationRows.map((log) => {
                  const tone = notificationStatusTone(log.status);
                  const channel = notificationChannelLabel(log);
                  return (
                    <ContractDocRow
                      key={`${channel}-${log.id}`}
                      icon={
                        tone === "burgundy" ? (
                          <CircleAlert size={16} strokeWidth={2.5} />
                        ) : (
                          <MessageCircle size={16} strokeWidth={2.5} />
                        )
                      }
                      title={`${channel} · ${notificationTitle(log)}`}
                      meta={`${formatNotificationTime(log.createdAt)} · ${log.receiver}`}
                      badge={notificationStatusLabel(log.status)}
                      tone={tone}
                    />
                  );
                })
              ) : (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                    padding: "12px 0",
                    textAlign: "center",
                  }}
                >
                  내역이 없습니다.
                </div>
              )}
            </InfoCard>
          </MobileDetailTabPanel>
        </>
      )}
    </MobileDetailPage>
  );
}

export default function ContractsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: employees = [] } = useEmployees();
  const setPrefillClient = useClientDialogStore((state) => state.setPrefillClient);
  const clearPrefillClient = useClientDialogStore((state) => state.clearPrefillClient);
  const prefillContractCreation = useFormStore((state) => state.prefillFromContract);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<EformsignDocument | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("basic");
  const [deleteTargetDoc, setDeleteTargetDoc] = useState<EformsignDocument | null>(null);

  // Finalize (mode:"02" — staff completion) flow state
  const queryClient = useQueryClient();
  const deleteDocument = useDeleteEformsignDocument();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const [finalizeDoc, setFinalizeDoc] = useState<EformsignDocument | null>(null);
  const [finalizeEndDateInput, setFinalizeEndDateInput] = useState("");
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);
  const [isFinalizeSubmitting, setIsFinalizeSubmitting] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [isFinalizeProgressOpen, setIsFinalizeProgressOpen] = useState(false);
  const [finalizeErrorHint, setFinalizeErrorHint] = useState<string | null>(null);
  const [isStaffIframeOpen, setIsStaffIframeOpen] = useState(false);
  const [staffDocumentOption, setStaffDocumentOption] = useState<EformsignDocumentOption | null>(null);
  const [finalizeFeedback, setFinalizeFeedback] = useState<string | null>(null);
  const finalizeProgressSourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => {
    finalizeProgressSourceRef.current?.close();
  }, []);

  // When iframe option is set, open the iframe + invoke SDK
  useEffect(() => {
    if (!isStaffIframeOpen || !staffDocumentOption || !isEformsignLoaded) return;
    const handle = setTimeout(() => {
      openDocument(staffDocumentOption, STAFF_COMPLETION_IFRAME_ID, {
        onSuccess: () => {
          setIsStaffIframeOpen(false);
          setStaffDocumentOption(null);
          setFinalizeDoc(null);
          setFinalizeEndDateInput("");
          setFinalizeFeedback("계약서가 완료 처리되었습니다.");
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          [2000, 5000].forEach((delay) => {
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
            }, delay);
          });
        },
        onError: (response) => {
          setIsStaffIframeOpen(false);
          setStaffDocumentOption(null);
          setFinalizeFeedback(`최종 확인 실패: ${response.message ?? "알 수 없는 오류"}`);
        },
        onAction: (response) => {
          const t = response.type?.toLowerCase() ?? "";
          if (t.includes("cancel") || t.includes("close")) {
            setIsStaffIframeOpen(false);
            setStaffDocumentOption(null);
          }
        },
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [isStaffIframeOpen, staffDocumentOption, isEformsignLoaded, openDocument, queryClient]);

  const openFinalize = (
    doc: EformsignDocument,
    metadata?: EformsignDocClientSummary,
  ) => {
    setFinalizeDoc(doc);
    setFinalizeEndDateInput(contractEndDateInputValue(doc, metadata));
    setFinalizeErrorHint(null);
    setFinalizeProgress(INITIAL_HEADLESS_PROGRESS);
    setIsFinalizeDialogOpen(true);
  };

  const closeFinalizeDialog = () => {
    setIsFinalizeDialogOpen(false);
  };

  const handleOpenClientFromContract = (
    doc: EformsignDocument,
    metadata?: EformsignDocClientSummary,
  ) => {
    if (metadata?.clientId) {
      clearPrefillClient();
      router.push(`/clients/new?clientId=${metadata.clientId}`);
      return;
    }

    setPrefillClient(buildClientPrefillFromContract(doc, metadata));
    router.push("/clients/new");
  };

  const handleEditSendFromContract = (
    doc: EformsignDocument,
    metadata?: EformsignDocClientSummary,
  ) => {
    clearPrefillClient();
    prefillContractCreation(buildContractCreationPrefillFromContract(doc, metadata, employees));
    router.push("/contracts/new");
  };

  const handleDeleteDocumentConfirm = async () => {
    if (!deleteTargetDoc) return;
    try {
      await deleteDocument.mutateAsync(deleteTargetDoc.id);
      await queryClient.invalidateQueries({ queryKey: ["eformsign-doc-client-names"] });
      setSelectedDoc(null);
      setDeleteTargetDoc(null);
      toast({
        description: `${contractDisplayName(
          deleteTargetDoc,
          documentClientSummaryById.get(deleteTargetDoc.id),
          true,
        )}를 삭제했습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description: requestErrorMessage(error, "계약서 삭제 중 오류가 발생했습니다."),
      });
    }
  };

  const handleFinalizeSubmit = async () => {
    if (!finalizeDoc) return;
    const endDateIso = yymmddToIsoDate(finalizeEndDateInput);
    if (!endDateIso) {
      setFinalizeErrorHint("서비스 종료일을 6자리(YYMMDD)로 입력해주세요.");
      return;
    }

    setIsFinalizeSubmitting(true);
    setFinalizeErrorHint(null);
    setIsFinalizeDialogOpen(false);
    setFinalizeProgress({ step: "client-started", completed: false, failed: false });
    setIsFinalizeProgressOpen(true);

    const documentId = finalizeDoc.id;
    const progressId = createHeadlessProgressId("finalize");
    let progressSource: EventSource | null = null;
    let headlessOk = false;

    try {
      progressSource = new EventSource(
        `/api/eformsign-docs/finalize-headless/progress?progressId=${encodeURIComponent(progressId)}`,
      );
      finalizeProgressSourceRef.current = progressSource;
      progressSource.addEventListener("progress", (event) => {
        let data: HeadlessProgressEvent;
        try { data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent; }
        catch { return; }
        if (data.step === "failed") {
          const errorHint = getSafeHeadlessFailureMessage(data.reason);
          setFinalizeProgress((current) => {
            const next = resolveFailedHeadlessProgress(
              current,
              data.failedStep,
              CONTRACT_FINALIZE_PROGRESS_STEPS,
            );
            if (next !== current) {
              setFinalizeErrorHint(errorHint);
            }
            return next;
          });
          return;
        }
        if (!isHeadlessProgressStepKey(data.step, CONTRACT_FINALIZE_PROGRESS_STEPS)) return;
        const nextStep = data.step;
        setFinalizeProgress((current) =>
          resolveNextHeadlessProgress(current, nextStep, CONTRACT_FINALIZE_PROGRESS_STEPS),
        );
      });

      const headless = await eformsignApi.finalizeHeadless(documentId, endDateIso, progressId);

      if (headless.ok) {
        headlessOk = true;
        setFinalizeProgress({ step: "sent", completed: true, failed: false });
        queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
        [2000, 5000].forEach((delay) => {
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          }, delay);
        });
        setTimeout(() => {
          setIsFinalizeProgressOpen(false);
          setFinalizeFeedback("계약서가 완료 처리되었습니다.");
          setFinalizeDoc(null);
          setFinalizeEndDateInput("");
        }, 800);
        return;
      }

      console.warn("[finalize] headless ok=false", headless.reason);
      const errorHint = getSafeHeadlessFailureMessage(headless.reason);
      setFinalizeProgress((current) => {
        const next = resolveFailedHeadlessProgress(
          current,
          undefined,
          CONTRACT_FINALIZE_PROGRESS_STEPS,
        );
        if (next !== current) {
          setFinalizeErrorHint(errorHint);
        }
        return next;
      });
    } catch (err) {
      console.warn("[finalize] headless threw", err);
      const errorHint = getSafeHeadlessFailureMessage(err instanceof Error ? err.message : undefined);
      setFinalizeProgress((current) => {
        const next = resolveFailedHeadlessProgress(
          current,
          undefined,
          CONTRACT_FINALIZE_PROGRESS_STEPS,
        );
        if (next !== current) {
          setFinalizeErrorHint(errorHint);
        }
        return next;
      });
    } finally {
      progressSource?.close();
      finalizeProgressSourceRef.current = null;
    }

    if (!headlessOk) {
      // Fallback to iframe via generateStaffDocument
      setIsFinalizeProgressOpen(false);
      try {
        const authResult = await eformsignApi.authenticate(Date.now(), undefined, { force: true });
        if (!authResult.success) throw new Error("eformsign 인증에 실패했습니다.");
        const option = await eformsignApi.generateStaffDocument(documentId, undefined, undefined, endDateIso);
        setStaffDocumentOption(option as EformsignDocumentOption);
        setIsStaffIframeOpen(true);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : "최종 확인 준비 중 오류가 발생했습니다.";
        setFinalizeFeedback(msg);
      }
    }

    setIsFinalizeSubmitting(false);
  };

  // Auto-clear finalize feedback after 4s
  useEffect(() => {
    if (!finalizeFeedback) return;
    const handle = setTimeout(() => setFinalizeFeedback(null), 4000);
    return () => clearTimeout(handle);
  }, [finalizeFeedback]);

  useEffect(() => {
    document.body.classList.add(CONTRACT_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(CONTRACT_ROUTE_BODY_CLASS);
    };
  }, []);

  const { isAuthenticated, isLoading: isAuthLoading } = useEformsignAuth();
  const refreshContractsFromEvent = useCallback(
    (event: { documentId?: string }) => {
      void queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
      void queryClient.invalidateQueries({ queryKey: ["eformsign-doc-client-names"] });
      void queryClient.invalidateQueries({ queryKey: ["eformsign-document-detail"] });

      if (event.documentId) {
        void queryClient.invalidateQueries({ queryKey: ["eformsign-document-detail", event.documentId] });
      }
    },
    [queryClient],
  );

  useEformsignDocumentEvents({
    enabled: isAuthenticated,
    onDocsChanged: refreshContractsFromEvent,
  });

  const { data: allData, isLoading: isDocumentsLoading } = useEformsignDocumentsByType(isAuthenticated, null);
  const isContractsLoading = isAuthLoading || (isAuthenticated && isDocumentsLoading && !allData);
  const { data: documentClientSummaries = [] } = useQuery({
    queryKey: ["eformsign-doc-client-names"],
    queryFn: eformsignApi.getDocumentClientNames,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });
  const { data: notificationLogsData = [] } = useQuery<NotificationLogRecord[]>({
    queryKey: ["alimtalk", "logs", "all"],
    queryFn: () => fetchAllAlimtalkLogs<NotificationLogRecord>(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60,
  });
  const notificationLogs = useMemo(
    () => (Array.isArray(notificationLogsData) ? notificationLogsData : []),
    [notificationLogsData],
  );
  const { data: selectedDocDetail } = useQuery({
    queryKey: ["eformsign-document-detail", selectedDoc?.id],
    queryFn: () => eformsignApi.getDocument(selectedDoc!.id),
    enabled: isAuthenticated && Boolean(selectedDoc?.id),
    staleTime: 1000 * 60,
  });

  const documentClientSummaryById = useMemo(
    () => new Map(documentClientSummaries.map((summary) => [summary.documentId, summary])),
    [documentClientSummaries],
  );

  const missingCustomerNameDocumentIds = useMemo(
    () =>
      (allData?.documents ?? [])
        .filter((doc) => !isDeletedStatusCode(doc.current_status?.status_type))
        .filter((doc) => customerName(doc, documentClientSummaryById.get(doc.id)) === UNKNOWN_CUSTOMER_NAME)
        .map((doc) => doc.id)
        .filter((id): id is string => Boolean(id)),
    [allData?.documents, documentClientSummaryById],
  );

  const { data: missingCustomerNameDetails = [] } = useQuery<EformsignDocument[]>({
    queryKey: ["eformsign-document-details", "missing-customer-names", missingCustomerNameDocumentIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        missingCustomerNameDocumentIds.map((documentId) => eformsignApi.getDocument(documentId)),
      );

      return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    },
    enabled: isAuthenticated && missingCustomerNameDocumentIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const missingCustomerNameDetailById = useMemo(
    () => new Map(missingCustomerNameDetails.map((doc) => [doc.id, doc])),
    [missingCustomerNameDetails],
  );

  const displayDocuments = useMemo(
    () =>
      (allData?.documents ?? []).map((doc) =>
        mergeDocumentForDisplayData(doc, missingCustomerNameDetailById.get(doc.id)),
      ),
    [allData?.documents, missingCustomerNameDetailById],
  );

  const selectedListDoc = useMemo(() => {
    if (!selectedDoc?.id) return null;
    return displayDocuments.find((doc) => doc.id === selectedDoc.id) ?? null;
  }, [displayDocuments, selectedDoc?.id]);

  const documentIdsSignature = useMemo(
    () => (allData?.documents ?? []).map((doc) => doc.id).join("|"),
    [allData?.documents],
  );

  useEffect(() => {
    if (!isAuthenticated || !documentIdsSignature) return;
    void queryClient.invalidateQueries({ queryKey: ["eformsign-doc-client-names"] });
  }, [documentIdsSignature, isAuthenticated, queryClient]);

  const selectedDetailDoc = useMemo(() => {
    if (!selectedDoc) return null;
    return {
      ...selectedDoc,
      ...(selectedDocDetail?.id === selectedDoc.id ? selectedDocDetail : null),
      ...(selectedListDoc?.id === selectedDoc.id ? selectedListDoc : null),
    };
  }, [selectedDoc, selectedDocDetail, selectedListDoc]);

  const selectedDocMetadata = useMemo(() => {
    const selectedIds = [selectedDoc?.id, selectedDetailDoc?.id, selectedListDoc?.id];
    for (const id of selectedIds) {
      if (!id) continue;
      const metadata = documentClientSummaryById.get(id);
      if (metadata) return metadata;
    }
    return undefined;
  }, [documentClientSummaryById, selectedDetailDoc?.id, selectedDoc?.id, selectedListDoc?.id]);

  const allDocuments = useMemo(
    () =>
      displayDocuments.filter((doc) => {
        if (isDeletedStatusCode(doc.current_status?.status_type)) return false;
        const metadata = documentClientSummaryById.get(doc.id);
        return !EXCLUDED_CUSTOMER_NAMES.includes(customerName(doc, metadata));
      }),
    [displayDocuments, documentClientSummaryById],
  );

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return allDocuments;
    return allDocuments.filter(
      (doc) => {
        const metadata = documentClientSummaryById.get(doc.id);
        return (
          matchesKoreanSearch(customerName(doc, metadata), q) ||
          matchesKoreanSearch(doc.document_name ?? "", q) ||
          matchesKoreanSearch(templateName(doc), q) ||
          matchesKoreanSearch(contractNumber(doc), q)
        );
      },
    );
  }, [allDocuments, documentClientSummaryById, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<ContractCategory, EformsignDocument[]> = {
      "in-progress": [],
      drafting: [],
      completed: [],
      rejected: [],
      unknown: [],
    };
    for (const doc of filteredDocuments) {
      groups[categorize(doc)].push(doc);
    }
    return groups;
  }, [filteredDocuments]);

  const filterItems = useMemo(() => {
    if (isContractsLoading) {
      return FILTER_LABELS.map((label) => ({ label, count: "00", skeleton: true }));
    }

    const counts: Record<FilterKey, number> = {
      전체: filteredDocuments.length,
      대기: grouped.drafting.length,
      "검토 필요": grouped["in-progress"].length,
      완료: grouped.completed.length,
      "기간 만료": grouped.rejected.length,
      "상태 확인": grouped.unknown.length,
    };
    return FILTER_LABELS.map((label) => ({ label, count: String(counts[label]) }));
  }, [filteredDocuments.length, grouped, isContractsLoading]);

  const sectionsFull = useMemo(() => {
    type Section = {
      key: string;
      title: string;
      fullDocs: EformsignDocument[];
      fullCount: number;
      category: ContractCategory;
    };
    const section = (
      key: string,
      title: string,
      docs: EformsignDocument[],
      category: ContractCategory,
    ): Section => ({ key, title, fullDocs: docs, fullCount: docs.length, category });

    // 전체: 카테고리 grouping 없이 최신순 단일 리스트 (총 8개부터 teaser → 무한 스크롤).
    if (activeFilter === "전체") {
      const flat = [...filteredDocuments].sort((a, b) => docRecency(b) - docRecency(a));
      return flat.length > 0 ? [section("all", "", flat, "in-progress")] : [];
    }

    // 개별 필터: 해당 카테고리 단일 섹션.
    if (activeFilter === "검토 필요") {
      return grouped["in-progress"].length > 0
        ? [section("in-progress", "검토 필요", grouped["in-progress"], "in-progress")]
        : [];
    }
    if (activeFilter === "대기") {
      return grouped.drafting.length > 0
        ? [section("drafting", "대기", grouped.drafting, "drafting")]
        : [];
    }
    if (activeFilter === "완료") {
      return grouped.completed.length > 0
        ? [section("completed", "완료 · 최근", grouped.completed, "completed")]
        : [];
    }
    if (activeFilter === "기간 만료") {
      return grouped.rejected.length > 0
        ? [section("rejected", "기간 만료/반려", grouped.rejected, "rejected")]
        : [];
    }
    if (activeFilter === "상태 확인") {
      return grouped.unknown.length > 0
        ? [section("unknown", "상태 확인", grouped.unknown, "unknown")]
        : [];
    }
    return [];
  }, [grouped, activeFilter, filteredDocuments]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
      fallbackInitialCount: CONTRACT_LIST_INITIAL_VISIBLE_COUNT,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, docs: s.fullDocs.slice(0, visibleCount) }))
        .filter((s) => s.docs.length > 0),
    [sectionsFull, visibleCount],
  );

  const totalDocs = filteredDocuments.length;
  const listCount = isContractsLoading ? (
    <span className="contracts-count-placeholder" aria-label="계약서 불러오는 중" />
  ) : (
    `${totalDocs}건`
  );

  const mainSheet = (
    <MobileDetailSheet
      name="contracts"
      isOpen={Boolean(selectedDoc)}
      onClose={() => setSelectedDoc(null)}
      list={
        <div className="shell-content" data-component="mobile-contracts-content">
          <ListCard
            title="계약서"
            count={listCount}
            actionLabel="계약 작성"
            actionHref="/contracts/new"
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={(label) => setActiveFilter(label as FilterKey)}
            scrollRef={scrollContainerRef}
            loadMoreFooter={
              isContractsLoading ? (
                <div
                  className="contracts-load-more-placeholder"
                  data-component="mobile-contracts-load-more-placeholder"
                  aria-hidden="true"
                />
              ) : isInitialLoad && hasMore ? (
                <ListLoadMoreButton
                  onLoadMore={loadMore}
                  dataComponentPrefix="mobile-contracts"
                />
              ) : null
            }
            beforeFilters={
              <MobileSearchBar
                placeholder="고객명, 계약서명, 계약 번호 검색"
                label="contracts"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            }
          >
            {isContractsLoading ? (
              <ContractListLoadingRows />
            ) : visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-contracts-empty"
              >
                {searchQuery.trim() || activeFilter !== "전체"
                  ? "조건에 맞는 계약서가 없습니다."
                  : "등록된 계약서가 없습니다."}
              </div>
            ) : (
              <>
                {visibleSections.map((section) => (
                <div className="section-block" key={section.key}>
                  {section.docs.map((doc, idx) => {
                    const cat = categorize(doc);
                    const tones = categoryTones(cat);
                    const meta = progressLabel(doc);
                    const metadata = documentClientSummaryById.get(doc.id);
                    const name = contractDisplayName(doc, metadata);

                    return (
                      <ListItemRow
                        key={doc.id}
                        dataComponent="mobile-contracts-row"
                        left={
                          <div
                            className={`list-avatar av-${tones.badgeTone}`}
                            data-component="mobile-contracts-row-avatar"
                          >
                            {cat === "completed" ? (
                              <FileCheck2 size={16} strokeWidth={2.25} />
                            ) : cat === "drafting" ? (
                              <SquarePen size={16} strokeWidth={2.25} />
                            ) : (
                              <FileText size={16} strokeWidth={2.25} />
                            )}
                          </div>
                        }
                        name={name}
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                        meta={
                          <span
                            className={
                              tones.badgeMini === "muted" || cat === "completed"
                                ? "step-label muted"
                                : "step-label"
                            }
                          >
                            {meta}
                          </span>
                        }
                        right={<Badge label={tones.badge} tone={tones.badgeTone} />}
                        onClick={() => {
                          setSelectedDoc(doc);
                          setActiveTab("basic");
                        }}
                      />
                    );
                  })}
                </div>
                ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    sentinelRef={sentinelRef}
                    dataComponentPrefix="mobile-contracts"
                  />
                )}
              </>
            )}
          </ListCard>
        </div>
      }
      detail={
        selectedDetailDoc ? (
          <ContractDetailContent
            doc={selectedDetailDoc}
            metadata={selectedDocMetadata}
            notificationLogs={notificationLogs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onFinalize={openFinalize}
            onOpenClient={handleOpenClientFromContract}
            onEditSend={handleEditSendFromContract}
            onDeleteRequest={setDeleteTargetDoc}
          />
        ) : (
          <div className="detail-body" />
        )
      }
    />
  );

  return (
    <>
      {mainSheet}

      <ConfirmActionModal
        open={deleteTargetDoc !== null}
        title="계약서 삭제"
        description="선택한 계약서를 삭제할까요?"
        cancelLabel="취소"
        confirmLabel="삭제"
        loading={deleteDocument.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) {
            setDeleteTargetDoc(null);
          }
        }}
        onCancel={() => setDeleteTargetDoc(null)}
        onConfirm={handleDeleteDocumentConfirm}
      />

      {isFinalizeDialogOpen && finalizeDoc ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-6" data-component="mobile-contracts-finalize-dialog">
          <div className="w-full max-w-[360px] rounded-2xl bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
            <h2 className="mb-1 text-base font-extrabold text-v3-dark">최종 확인</h2>
            <p className="mb-4 text-[0.72rem] text-v3-text-muted">
              계약을 완료 처리하기 전에 서비스 종료일을 확인해주세요.
            </p>
            <label className="mb-1.5 block text-[0.7rem] font-bold uppercase tracking-wide text-v3-text-muted">
              서비스 종료일
            </label>
            <input
              className="box-border w-full rounded-xl border-[1.5px] border-v3-border bg-white px-3.5 py-3 text-[0.9rem] text-v3-dark outline-none focus:border-v3-primary"
              value={finalizeEndDateInput}
              onChange={(e) => setFinalizeEndDateInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="YYMMDD"
              autoFocus
            />
            {finalizeErrorHint ? (
              <div className="mt-2 text-[0.72rem] font-semibold text-v3-burgundy">
                {finalizeErrorHint}
              </div>
            ) : null}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-[hsl(220_20%_97%)] py-3 text-[0.88rem] font-bold text-v3-text"
                onClick={closeFinalizeDialog}
                disabled={isFinalizeSubmitting}
              >
                취소
              </button>
              <button
                type="button"
                className="flex-[2] rounded-xl bg-v3-primary py-3 text-[0.88rem] font-bold text-white shadow-[0_4px_14px_rgba(20,50,100,0.18)] disabled:opacity-45"
                onClick={handleFinalizeSubmit}
                disabled={isFinalizeSubmitting}
              >
                {isFinalizeSubmitting ? "처리 중..." : "완료"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <HeadlessProgressModal
        open={isFinalizeProgressOpen}
        title="최종 확인 처리 중"
        steps={CONTRACT_FINALIZE_PROGRESS_STEPS}
        progress={finalizeProgress}
        errorHint={finalizeErrorHint}
        dataComponentPrefix="mobile-contracts-finalize-progress"
      />

      {isStaffIframeOpen ? (
        <div className="fixed inset-0 z-[200] flex flex-col bg-[hsl(var(--v3-dim-white))]" data-component="mobile-contracts-staff-iframe-modal">
          <div className="flex h-14 items-center justify-between border-b border-v3-border bg-white px-4 text-base font-bold text-v3-dark">
            <span>계약서 최종 확인</span>
            <button
              type="button"
              onClick={() => setIsStaffIframeOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-v3-text"
              aria-label="닫기"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>
          <iframe
            id={STAFF_COMPLETION_IFRAME_ID}
            className="w-full flex-1 border-0 bg-white"
            title="staff completion"
          />
        </div>
      ) : null}

      {finalizeFeedback ? (
        <div
          className="fixed right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-[1001] max-w-[320px] overflow-hidden rounded-2xl bg-v3-primary px-4 py-3 text-[0.8rem] font-semibold text-white shadow-[0_8px_24px_rgba(20,50,100,0.25)]"
          role="status"
          data-component="mobile-contracts-finalize-feedback"
        >
          {finalizeFeedback}
        </div>
      ) : null}
    </>
  );
}
