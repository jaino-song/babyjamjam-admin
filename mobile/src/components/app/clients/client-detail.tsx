"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, FileCheck2, MessageCircle, MoreVertical, SquarePen, Trash2, User } from "lucide-react";

import { Client } from "@/lib/client/types";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import { ClientMessageHistoryDetail } from "@/components/app/clients/client-message-history-detail";

type UnknownRecord = Record<string, unknown>;

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

function documentFieldValue(doc: EformsignDocument | null | undefined, fieldIds: readonly string[]): string | null {
  if (!doc) return null;

  const normalizeFieldId = (value: string) => value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
  const canUseReverseContains = (value: string) => /^[a-z0-9]+$/.test(value) && value.length >= 5;
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
        (id) =>
          normalizedToken === id ||
          normalizedToken.includes(id) ||
          (canUseReverseContains(normalizedToken) && id.includes(normalizedToken)),
      );
    })) {
      const value = valueFromFieldRecord(record);
      if (value) return value;
    }
  }

  return null;
}

function numericText(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeYymmdd(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length >= 8) return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  return null;
}

function yymmddToIsoDate(value: string | null | undefined): string | null {
  const yymmdd = normalizeYymmdd(value);
  if (!yymmdd) return null;

  const yy = Number(yymmdd.slice(0, 2));
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function compactDateToIsoDate(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;

  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function formatIsoDateParts(isoDate: string): string | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}년 ${match[2]}월 ${match[3]}일`;
}

function isoDateFromTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;

  const timestamp = numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function twoDigitPart(value: string | null | undefined): string | null {
  const digits = numericText(value);
  if (!digits) return null;
  return digits.slice(-2).padStart(2, "0");
}

function fourDigitYear(value: string | null | undefined): string | null {
  const digits = numericText(value);
  if (!digits) return null;
  if (digits.length >= 4) return digits.slice(-4);
  const yy = Number(digits.slice(-2));
  return String(yy >= 70 ? 1900 + yy : 2000 + yy);
}

function documentDateFromParts(
  doc: EformsignDocument | null | undefined,
  parts: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | null {
  const year = fourDigitYear(documentFieldValue(doc, parts.year));
  const month = twoDigitPart(documentFieldValue(doc, parts.month));
  const day = twoDigitPart(documentFieldValue(doc, parts.day));
  if (!year || !month || !day) return null;

  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function firstValue(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    const normalized = typeof value === "number" ? String(value) : value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const normalized = compactDateToIsoDate(dateStr) ?? yymmddToIsoDate(dateStr) ?? dateStr;
  const formatted = formatIsoDateParts(normalized);
  if (formatted) return formatted;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return dateStr;
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}년 ${month}월 ${day}일`;
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const amount = Number(price.replace(/,/g, ""));
  if (Number.isNaN(amount)) return price;
  return `${amount.toLocaleString("ko-KR")}원`;
}

function contractDateValue(
  doc: EformsignDocument | null | undefined,
  fieldIds: readonly string[],
  parts: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | null {
  return yymmddToIsoDate(documentFieldValue(doc, fieldIds)) ?? documentDateFromParts(doc, parts);
}

function contractDurationValue(doc: EformsignDocument | null | undefined): string | null {
  return numericText(documentFieldValue(doc, [
    "바우처 기간",
    "바우처기간",
    "서비스 일수",
    "서비스일수",
    "일수",
    "days",
    "duration",
    "contractDuration",
  ]));
}

function documentServicePeriodRange(doc: EformsignDocument | null | undefined): { start: string; end: string } | null {
  const value = documentFieldValue(doc, [
    "서비스 기간",
    "서비스기간",
    "계약 기간",
    "계약기간",
    "contractPeriod",
    "servicePeriod",
  ]);
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (digits.length < 16) return null;

  const start = compactDateToIsoDate(digits.slice(0, 8));
  const end = compactDateToIsoDate(digits.slice(8, 16));
  if (!start || !end) return null;

  return { start, end };
}

function formatDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  if (!startDate && !endDate) return "-";
  if (!startDate) return formatDate(endDate);
  if (!endDate) return formatDate(startDate);
  return `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
}

function contractPrimaryEmployeeName(doc: EformsignDocument | null | undefined): string | null {
  return documentFieldValue(doc, [
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
}

function clientFeatureLabel(client: Client): string | null {
  if (client.breastPump) return "유축기 대여";
  if (client.careCenter) return "조리원 이용";
  if (client.voucherClient) return "바우처";
  return client.type;
}

function clientFeatureLabelTone(client: Client): "green" | "burgundy" {
  if (client.voucherClient) return "green";
  return "burgundy";
}

function documentStatusLabel(status: Client["documentStatus"]): string {
  switch (status) {
    case "completed":
      return "완료";
    case "opened":
    case "requested":
      return "검토 필요";
    case "created":
      return "발송 대기";
    case "rejected":
    case "revoked":
    case "deleted":
      return "확인 필요";
    default:
      return "미발급";
  }
}

function documentStatusTone(status: Client["documentStatus"]): "green" | "primary" | "orange" | "muted" | "burgundy" {
  switch (status) {
    case "completed":
      return "green";
    case "opened":
    case "requested":
      return "primary";
    case "created":
      return "orange";
    case "rejected":
    case "revoked":
    case "deleted":
      return "burgundy";
    default:
      return "muted";
  }
}

export interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: "burgundy" | "primary" | "muted" | "green" | "orange";
  badgeMini: "burgundy" | "primary" | "muted" | "green" | "orange";
  match: (c: Client) => boolean;
  counter: string;
}

export const GROUPS: ClientGroup[] = [
  {
    key: "active",
    title: "진행중",
    badge: "진행중",
    badgeTone: "primary",
    badgeMini: "primary",
    match: (c) => c.serviceStatus === "active",
    counter: "명",
  },
  {
    key: "replacement_requested",
    title: "교체 요청",
    badge: "교체 요청",
    badgeTone: "burgundy",
    badgeMini: "burgundy",
    match: (c) => c.serviceStatus === "replacement_requested",
    counter: "명",
  },
  {
    key: "waiting",
    title: "대기",
    badge: "대기",
    badgeTone: "orange",
    badgeMini: "orange",
    match: (c) => c.serviceStatus === "waiting",
    counter: "명",
  },
  {
    key: "terminated",
    title: "중단",
    badge: "중단",
    badgeTone: "muted",
    badgeMini: "muted",
    match: (c) => c.serviceStatus === "terminated",
    counter: "명",
  },
  {
    key: "completed",
    title: "완료",
    badge: "완료",
    badgeTone: "green",
    badgeMini: "green",
    match: (c) => c.serviceStatus === "completed",
    counter: "명",
  },
];

export function shouldShowMissingContractBadge(client: Client): boolean {
  return client.serviceStatus === "active" && client.documentStatus !== "completed";
}

export type DetailTabId = "basic" | "contracts" | "alimtalk";

export interface ClientNotificationLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string | null;
  recipientName: string | null;
  clientId: number | null;
  status: "pending" | "sent" | "failed" | string;
  messageBody: string;
  errorMessage: string | null;
  createdAt: string;
  ruleName: string | null;
  variables?: Record<string, unknown> | null;
}

type DetailRowTone = "green" | "primary" | "orange" | "muted" | "burgundy" | "purple";
const CLIENT_GREETING_SMS_TEMPLATE_KEY = "client_greeting_sms";
const CLIENT_GREETING_SMS_TITLE = "인사 메시지";
const SERVICE_FEEDBACK_LINK_SMS_TEMPLATE_KEY = "service_feedback_link_sms";
const SERVICE_FEEDBACK_LINK_SMS_TITLE = "제공기록지 작성 링크";

function DetailDocRow({
  icon,
  title,
  meta,
  badge,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  badge: string;
  tone: DetailRowTone;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={interactive ? "doc-row doc-row-tappable" : "doc-row"}
      data-component="mobile-clients-doc-row"
      {...(interactive
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            },
          }
        : {})}
    >
      <div className={`doc-icon doc-icon-${tone}`} data-component="mobile-clients-doc-icon">
        {icon}
      </div>
      <div className="doc-info" data-component="mobile-clients-doc-info">
        <div className="doc-title" data-component="mobile-clients-doc-title">
          {title}
        </div>
        <div className="doc-meta" data-component="mobile-clients-doc-meta">
          {meta}
        </div>
      </div>
      <span className={`badge-mini ${tone}`}>{badge}</span>
    </div>
  );
}

function notificationChannelLabel(log: ClientNotificationLogRecord): "알림톡" | "SMS" {
  return log.provider.toLowerCase().includes("sms") ? "SMS" : "알림톡";
}

function notificationVariables(log: ClientNotificationLogRecord): Record<string, unknown> {
  return isRecord(log.variables) ? log.variables : {};
}

function notificationTitle(log: ClientNotificationLogRecord): string {
  if (log.ruleName?.trim()) return log.ruleName;
  const variables = notificationVariables(log);
  const variableTitle = stringFromUnknown(variables.title);
  if (variableTitle) return variableTitle;
  if (log.templateKey === CLIENT_GREETING_SMS_TEMPLATE_KEY) return CLIENT_GREETING_SMS_TITLE;
  if (log.templateKey === SERVICE_FEEDBACK_LINK_SMS_TEMPLATE_KEY) return SERVICE_FEEDBACK_LINK_SMS_TITLE;
  if (log.templateKey === "manual_sms") return "수동 메시지";
  return log.templateKey || "발송 내역";
}

function isClientGreetingSmsLog(log: ClientNotificationLogRecord): boolean {
  const variables = notificationVariables(log);
  return (
    log.templateKey === CLIENT_GREETING_SMS_TEMPLATE_KEY ||
    variables.automationKey === "CLIENT_GREETING_SMS" ||
    variables.systemTemplateKey === "GREETING"
  );
}

function notificationReceiverKey(receiver: string | null): string {
  return (receiver ?? "").replace(/\D/g, "");
}

function visibleNotificationLogs(logs: ClientNotificationLogRecord[]): ClientNotificationLogRecord[] {
  const sortedLogs = [...logs].sort((a, b) => {
    const bTime = new Date(b.createdAt).getTime();
    const aTime = new Date(a.createdAt).getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
  const seenGreetingKeys = new Set<string>();

  return sortedLogs.filter((log) => {
    const key = `${notificationChannelLabel(log)}:${notificationReceiverKey(log.receiver)}:${notificationTitle(log)}`;
    if (seenGreetingKeys.has(key)) return false;
    if (isClientGreetingSmsLog(log)) seenGreetingKeys.add(key);
    return true;
  });
}

function notificationStatusLabel(status: string): string {
  switch (status) {
    case "failed":
      return "실패";
    case "pending":
      return "대기";
    case "sent":
      return "완료";
    default:
      return status || "-";
  }
}

function notificationStatusTone(status: string): DetailRowTone {
  switch (status) {
    case "failed":
      return "burgundy";
    case "pending":
      return "orange";
    case "sent":
      return "green";
    default:
      return "muted";
  }
}

function formatNotificationTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt || "-";

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${year}년 ${month}월 ${day}일 ${time}`;
}

export function ClientDetailContent({
  client,
  contractDocument,
  activeTab,
  notificationLogs = [],
  isNotificationLogsLoading = false,
  isIssuingContract = false,
  onTabChange,
  onMessage,
  onIssueContract,
  onEdit,
  onDelete,
}: {
  client: Client;
  contractDocument?: EformsignDocument | null;
  activeTab: DetailTabId;
  notificationLogs?: ClientNotificationLogRecord[];
  isNotificationLogsLoading?: boolean;
  isIssuingContract?: boolean;
  onTabChange: (id: DetailTabId) => void;
  onMessage: () => void;
  onIssueContract: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: number) => void;
}) {
  // Keyed selection so the open message-detail auto-resets when the tab or client changes
  // (derive-during-render — avoids a setState-in-effect).
  const detailKey = `${activeTab}:${client.id}`;
  const [selectedEntry, setSelectedEntry] = useState<{ key: string; log: ClientNotificationLogRecord } | null>(null);
  const selectedLog = selectedEntry && selectedEntry.key === detailKey ? selectedEntry.log : null;

  const group = GROUPS.find((g) => g.match(client)) ?? GROUPS[1];
  const featureLabel = clientFeatureLabel(client);
  const featureLabelTone = clientFeatureLabelTone(client);
  const docTone = documentStatusTone(client.documentStatus);
  const hasContractDocument = Boolean(client.eDocId);
  const showMissingContractBadge = shouldShowMissingContractBadge(client);
  const displayNotificationLogs = visibleNotificationLogs(notificationLogs);
  const birthDate = firstValue(
    client.birthday,
    documentFieldValue(contractDocument, [
      "이용자 생년월일",
      "생년월일",
      "주민번호 앞자리",
      "customerDOB",
      "customerBirthDate",
      "birthday",
    ]),
  );
  const dueDate = firstValue(
    client.dueDate,
    yymmddToIsoDate(documentFieldValue(contractDocument, [
      "출산 예정일",
      "출산예정일",
      "dueDate",
      "expectedBirthDate",
    ])),
  );
  const phone = firstValue(
    client.phone,
    documentFieldValue(contractDocument, [
      "이용자 연락처",
      "연락처",
      "휴대폰",
      "전화번호",
      "customerContact",
      "customerPhone",
    ]),
  );
  const address = firstValue(
    client.address,
    documentFieldValue(contractDocument, ["이용자 주소", "주소", "customerAddress", "address"]),
  );
  const primaryEmployeeName = firstValue(client.primaryEmployee?.name, contractPrimaryEmployeeName(contractDocument));
  const primaryEmployeePhone = documentFieldValue(contractDocument, [
    "제공인력 1 연락처",
    "제공인력1연락처",
    "제공인력 연락처",
    "관리사 연락처",
    "산후관리사 연락처",
    "caretaker1Contact",
    "caretakerContact",
    "employeePhone",
    "providerPhone",
  ]);
  const secondaryEmployeeName = firstValue(
    client.secondaryEmployee?.name,
    documentFieldValue(contractDocument, [
      "제공인력 2 성명",
      "제공인력2성명",
      "보조 제공인력 성명",
      "보조관리사 성명",
      "caretaker2Name",
      "secondaryEmployeeName",
    ]),
  );
  const secondaryEmployeePhone = documentFieldValue(contractDocument, [
    "제공인력 2 연락처",
    "제공인력2연락처",
    "보조 제공인력 연락처",
    "보조관리사 연락처",
    "caretaker2Contact",
    "secondaryEmployeePhone",
  ]);
  const serviceType = firstValue(
    client.type,
    documentFieldValue(contractDocument, [
      "바우처 유형",
      "바우처유형",
      "유형",
      "서비스 유형",
      "서비스유형",
      "type",
      "serviceType",
    ]),
  );
  const serviceDuration = firstValue(client.duration, contractDurationValue(contractDocument));
  const servicePeriodRange = documentServicePeriodRange(contractDocument);
  const serviceStartDate = firstValue(
    client.startDate,
    servicePeriodRange?.start,
    contractDateValue(
      contractDocument,
      ["서비스 시작일", "서비스시작일", "계약 시작일", "계약시작일", "startDate", "contractStartDate"],
      {
        year: ["계약 시작 년도", "계약시작년도", "계약 시작 연도", "계약시작연도", "시작 연도", "시작년도", "startYear"],
        month: ["계약 시작 월", "계약시작월", "시작 월", "시작월", "startMonth"],
        day: ["계약 시작 일", "계약시작일", "시작 일", "시작일", "startDay"],
      },
    ),
  );
  const serviceEndDate = firstValue(
    client.endDate,
    servicePeriodRange?.end,
    contractDateValue(
      contractDocument,
      ["서비스 종료일", "서비스종료일", "계약 종료일", "계약종료일", "endDate", "contractEndDate"],
      {
        year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "종료 연도", "종료년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "종료 월", "종료월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "종료 일", "종료일", "endDay"],
      },
    ),
  );
  const contractSignDate = contractDateValue(
    contractDocument,
    [
      "계약 서명 날짜",
      "계약서명날짜",
      "계약 서명일",
      "계약서명일",
      "계약 날짜",
      "계약날짜",
      "계약 일자",
      "계약일자",
      "계약일",
      "게약 날짜",
      "게약날짜",
      "게약 일자",
      "게약일자",
      "게약일",
      "계약서 날짜",
      "계약서날짜",
      "계약서 일자",
      "계약서일자",
      "계약서 일",
      "계약서일",
      "contractSignDate",
      "signatureDate",
    ],
    {
      year: [
        "계약 서명 년도",
        "계약서명년도",
        "계약 서명 연도",
        "계약서명연도",
        "계약 서명 년",
        "계약서명년",
        "계약 년도",
        "계약년도",
        "계약 연도",
        "계약연도",
        "계약 년",
        "계약년",
        "게약 년도",
        "게약년도",
        "게약 연도",
        "게약연도",
        "게약 년",
        "게약년",
        "계약서 년도",
        "계약서년도",
        "계약서 연도",
        "계약서연도",
        "계약서 년",
        "계약서년",
        "서명 년도",
        "서명년도",
        "서명 연도",
        "서명연도",
        "서명 년",
        "서명년",
        "contractSignYear",
        "signatureYear",
      ],
      month: [
        "계약 서명 월",
        "계약서명월",
        "계약 월",
        "계약월",
        "게약 월",
        "게약월",
        "계약서 월",
        "계약서월",
        "서명 월",
        "서명월",
        "contractSignMonth",
        "signatureMonth",
      ],
      day: [
        "계약 서명 일",
        "계약서명일",
        "계약 일",
        "계약일",
        "게약 일",
        "게약일",
        "계약서 일",
        "계약서일",
        "서명 일",
        "서명일",
        "contractSignDay",
        "signatureDay",
      ],
    },
  );
  const paymentReceiptDate = contractDateValue(
    contractDocument,
    [
      "본인부담금 수령 날짜",
      "본인부담금수령날짜",
      "본인부담금 수령일",
      "본인부담금수령일",
      "본인부담금 수령 일자",
      "본인부담금수령일자",
      "본인 부담금 수령 날짜",
      "본인 부담금 수령일",
      "본인 부담금 수령 일자",
      "본인부담금 결제일",
      "본인부담금 납부일",
      "본인부담금 결제 날짜",
      "본인부담금결제날짜",
      "본인부담금 납부 날짜",
      "본인부담금납부날짜",
      "영수증 날짜",
      "영수증날짜",
      "영수증 일자",
      "영수증일자",
      "영수증 일",
      "영수증일",
      "영수증 발행일",
      "영수증발행일",
      "paymentDate",
      "receiptDate",
    ],
    {
      year: [
        "본인부담금 수령 년도",
        "본인부담금수령년도",
        "본인부담금 수령 연도",
        "본인부담금수령연도",
        "본인부담금 수령 년",
        "본인부담금수령년",
        "본인 부담금 수령 년도",
        "본인 부담금 수령 연도",
        "본인 부담금 수령 년",
        "본인부담금 결제 년도",
        "본인부담금결제년도",
        "본인부담금 납부 년도",
        "본인부담금납부년도",
        "영수증 년도",
        "영수증년도",
        "영수증 연도",
        "영수증연도",
        "영수증 년",
        "영수증년",
        "수령 년도",
        "수령년도",
        "납부 년도",
        "납부년도",
        "결제 년도",
        "결제년도",
        "paymentYear",
        "receiptYear",
        "selfPayReceiptYear",
        "copayReceiptYear",
      ],
      month: [
        "본인부담금 수령 월",
        "본인부담금수령월",
        "본인 부담금 수령 월",
        "본인부담금 결제 월",
        "본인부담금결제월",
        "본인부담금 납부 월",
        "본인부담금납부월",
        "영수증 월",
        "영수증월",
        "수령 월",
        "수령월",
        "납부 월",
        "납부월",
        "결제 월",
        "결제월",
        "paymentMonth",
        "receiptMonth",
        "selfPayReceiptMonth",
        "copayReceiptMonth",
      ],
      day: [
        "본인부담금 수령 일",
        "본인부담금수령일",
        "본인 부담금 수령 일",
        "본인부담금 결제 일",
        "본인부담금결제일",
        "본인부담금 납부 일",
        "본인부담금납부일",
        "영수증 일",
        "영수증일",
        "수령 일",
        "수령일",
        "납부 일",
        "납부일",
        "결제 일",
        "결제일",
        "paymentDay",
        "receiptDay",
        "selfPayReceiptDay",
        "copayReceiptDay",
      ],
    },
  );
  const isContractCompleted = client.documentStatus === "completed";
  const contractDocCompletedDate = firstValue(
    isoDateFromTimestamp(contractDocument?.updated_date),
    contractSignDate,
    serviceStartDate,
  );
  const contractDocSentDate = firstValue(
    isoDateFromTimestamp(contractDocument?.created_date),
    serviceStartDate,
  );
  const contractDocMetaDateLabel = isContractCompleted ? "완료 날짜" : "발송 날짜";
  const contractDocMetaDate = isContractCompleted ? contractDocCompletedDate : contractDocSentDate;
  const fullPrice = firstValue(
    client.fullPrice,
    numericText(documentFieldValue(contractDocument, [
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
    ])),
  );
  const grant = firstValue(
    client.grant,
    numericText(documentFieldValue(contractDocument, ["정부지원금", "지원금", "grant"])),
  );
  const actualPrice = firstValue(
    client.actualPrice,
    numericText(documentFieldValue(contractDocument, ["본인부담금", "실결제금액", "actualPrice"])),
  );
  const servicePeriodLabel =
    serviceStartDate || serviceEndDate
      ? formatDateRange(serviceStartDate, serviceEndDate)
      : serviceDuration
        ? `${serviceDuration}일`
        : "-";

  return (
    <MobileDetailPage name="clients">
      <MobileDetailHeader
        name="clients"
        avatar={<User size={22} strokeWidth={2} />}
        avatarTone={group.badgeTone}
        title={client.name}
        badges={[
          { label: group.badge, tone: group.badgeMini },
          ...(featureLabel ? [{ label: featureLabel, tone: featureLabelTone }] : []),
          ...(showMissingContractBadge ? [{ label: "계약서 없음", tone: "burgundy" as const }] : []),
        ]}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-v3-text-muted transition-colors hover:bg-v3-dim-white"
                aria-label="고객 옵션"
                data-component="mobile-clients-detail-menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile-clients-detail-menu"
            >
              <DropdownMenuItem
                onClick={() => onEdit(client)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-edit"
              >
                <SquarePen className="size-[15px]" strokeWidth={2} />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(client.id)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <MobileDetailActions
        name="clients"
        actions={[
          {
            label: "메시지",
            variant: "secondary",
            onClick: onMessage,
            dataComponent: "mobile-clients-message",
          },
          {
            label: isIssuingContract ? "발급 중..." : "계약서 발급",
            variant: "primary",
            onClick: () => onIssueContract(client),
            disabled: isIssuingContract,
            busy: isIssuingContract,
            dataComponent: "mobile-clients-contract-create",
          },
        ]}
      />

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "contracts", label: "계약서 정보" },
          { id: "alimtalk", label: "알림 발송" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <MobileDetailTabPanel name="clients" tabId="basic" activeTab={activeTab}>
        <InfoCard title="고객 정보">
          <InfoRow label="이름" value={client.name} />
          <InfoRow label="생년월일" value={formatDate(birthDate)} />
          <InfoRow label="출산 예정일" value={formatDate(dueDate)} />
          <InfoRow label="연락처" value={phone ?? "-"} />
          <InfoRow label="주소" value={address ?? "-"} />
        </InfoCard>
        <InfoCard title="제공인력" delay={60}>
          <InfoRow label="제공인력 1" value={primaryEmployeeName ?? "-"} />
          {primaryEmployeePhone && <InfoRow label="제공인력 1 연락처" value={primaryEmployeePhone} />}
          <InfoRow label="제공인력 2" value={secondaryEmployeeName ?? "-"} />
          {secondaryEmployeePhone && <InfoRow label="제공인력 2 연락처" value={secondaryEmployeePhone} />}
        </InfoCard>
        <InfoCard title="서비스 정보" delay={120}>
          <InfoRow label="바우처 유형" value={serviceType ?? "-"} />
          <InfoRow label="서비스 기간" value={servicePeriodLabel} />
          <InfoRow label="시작일" value={formatDate(serviceStartDate)} />
          <InfoRow label="종료일" value={formatDate(serviceEndDate)} />
          <InfoRow label="계약 서명일" value={formatDate(contractSignDate)} />
          <InfoRow label="본인부담금 수령일" value={formatDate(paymentReceiptDate)} />
          <InfoRow label="총 서비스 금액" value={formatPrice(fullPrice)} />
          <InfoRow label="정부지원금" value={formatPrice(grant)} />
          <InfoRow label="본인부담금" value={formatPrice(actualPrice)} />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel name="clients" tabId="contracts" activeTab={activeTab}>
        {hasContractDocument ? (
          <>
            <InfoCard title="계약서">
              <DetailDocRow
                icon={<FileCheck2 size={16} strokeWidth={2.5} />}
                title="서비스 계약서"
                meta={
                  <>
                    <span className="doc-meta-line">{contractDocMetaDateLabel} {formatDate(contractDocMetaDate)}</span>
                    <span className="doc-meta-line doc-meta-id">문서 ID {client.eDocId}</span>
                  </>
                }
                badge={documentStatusLabel(client.documentStatus)}
                tone={docTone}
              />
            </InfoCard>
            <InfoCard title="최근 진행 상황" delay={60}>
              <InfoRow label="현재 단계" value={documentStatusLabel(client.documentStatus)} tone={docTone as never} />
              <InfoRow label="서명 대기자" value={client.hasSigned ? "-" : `고객 (${client.name})`} />
              <InfoRow label="발송일" value={formatDate(serviceStartDate)} />
              {isContractCompleted && <InfoRow label="완료일" value={formatDate(contractDocCompletedDate)} />}
            </InfoCard>
          </>
        ) : (
          <InfoCard title="계약서">
            <div className="detail-empty-state" data-component="mobile-clients-contracts-empty">
              계약서 정보가 없습니다.
            </div>
          </InfoCard>
        )}
      </MobileDetailTabPanel>

      <MobileDetailTabPanel name="clients" tabId="alimtalk" activeTab={activeTab}>
        {selectedLog ? (
          <ClientMessageHistoryDetail
            view={{
              title: notificationTitle(selectedLog),
              channelLabel: notificationChannelLabel(selectedLog),
              statusLabel: notificationStatusLabel(selectedLog.status),
              statusTone: notificationStatusTone(selectedLog.status),
              sentAtLabel: formatNotificationTime(selectedLog.createdAt),
              recipientName: selectedLog.recipientName?.trim() || client.name,
              recipientPhone: selectedLog.receiver?.trim() || "-",
              messageBody: selectedLog.messageBody?.trim()
                ? selectedLog.messageBody
                : "내용이 없습니다.",
              failureReason: selectedLog.errorMessage?.trim()
                ? selectedLog.errorMessage
                : null,
            }}
            onBack={() => setSelectedEntry(null)}
          />
        ) : (
          <InfoCard title="발송 내역">
            {isNotificationLogsLoading ? (
              <div className="detail-empty-state" data-component="mobile-clients-alimtalk-loading">
                발송 내역을 불러오는 중입니다.
              </div>
            ) : displayNotificationLogs.length > 0 ? (
              displayNotificationLogs.map((log) => {
                const tone = notificationStatusTone(log.status);
                const channel = notificationChannelLabel(log);
                return (
                  <DetailDocRow
                    key={`${channel}-${log.id}`}
                    icon={
                      tone === "burgundy" ? (
                        <CircleAlert size={16} strokeWidth={2.5} />
                      ) : (
                        <MessageCircle size={16} strokeWidth={2.5} />
                      )
                    }
                    title={`${channel} · ${notificationTitle(log)}`}
                    meta={formatNotificationTime(log.createdAt)}
                    badge={notificationStatusLabel(log.status)}
                    tone={tone}
                    onClick={() => setSelectedEntry({ key: detailKey, log })}
                  />
                );
              })
            ) : (
              <div className="detail-empty-state" data-component="mobile-clients-alimtalk-empty">
                발송 내역이 없습니다.
              </div>
            )}
          </InfoCard>
        )}
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}
