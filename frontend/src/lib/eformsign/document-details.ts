import type { EformsignDocument } from "@/lib/eformsign/types";
import { normalizeStatusCode } from "@/lib/eformsign/status-codes";

type UnknownRecord = Record<string, unknown>;

export interface EformsignTimelineEvent {
  timestamp: number;
}

const ADDRESS_FIELD_IDENTIFIERS = new Set([
  "address",
  "clientaddress",
  "customeraddress",
  "recipientaddress",
  "useraddress",
  "이용자주소",
  "고객주소",
  "산모주소",
]);
const CUSTOMER_CONTACT_PHONE_ALIASES = [
  "고객 연락처",
  "고객연락처",
  "고객 전화번호",
  "고객전화번호",
  "고객 휴대폰",
  "고객휴대폰",
  "customerContact",
  "customerPhone",
  "clientContact",
  "clientPhone",
  "recipientPhone",
  "inputOutsiderNumber",
  "outsiderNumber",
  "이용자 연락처",
  "이용자연락처",
  "이용자 전화번호",
  "이용자전화번호",
  "이용자 휴대폰",
  "이용자휴대폰",
  "산모 연락처",
  "산모연락처",
  "산모님 연락처",
  "산모님연락처",
  "산모 전화번호",
  "산모전화번호",
  "산모 휴대폰",
  "산모휴대폰",
];
const GENERIC_CONTACT_PHONE_ALIASES = [
  "연락처",
  "전화번호",
  "휴대폰",
  "휴대전화",
  "이동전화",
];
const CUSTOMER_CONTACT_EMAIL_ALIASES = [
  "고객 이메일",
  "고객이메일",
  "customerEmail",
  "clientEmail",
  "recipientEmail",
  "inputOutsiderEmail",
  "outsiderEmail",
  "이용자 이메일",
  "이용자이메일",
  "산모 이메일",
  "산모이메일",
  "산모님 이메일",
  "산모님이메일",
];
const GENERIC_CONTACT_EMAIL_ALIASES = [
  "이메일",
  "email",
  "e-mail",
  "mail",
  "전자우편",
];

const REREQUEST_CODES = new Set(["063"]);
const OPEN_CODES = new Set(["034", "064", "074", "076"]);
const SIGN_CODES = new Set(["032", "062"]);
const REREQUEST_KEYWORDS = ["rerequest", "re_request", "재요청"];
const OPEN_KEYWORDS = ["doc_open", "open_participant", "open_outsider", "open_reviewer", "open_reader", "열람"];
const SIGN_KEYWORDS = ["accept_participant", "accept_outsider", "참여자 승인", "외부자 승인"];
const FIELD_IDENTIFIER_KEYS = ["id", "field_id", "name", "field_name", "key", "label", "title"] as const;
const FIELD_VALUE_KEYS = ["value", "field_value", "input_value", "display_value", "content", "text"] as const;
const EVENT_TYPE_KEYS = [
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
const EVENT_TIMESTAMP_KEYS = [
  "updated_date",
  "created_date",
  "history_date",
  "request_date",
  "requested_date",
  "action_date",
  "date",
  "time",
  "occurred_at",
  "executed_at",
  "modified_at",
] as const;
const IGNORED_INLINE_FIELD_KEYS = new Set([
  ...FIELD_IDENTIFIER_KEYS,
  ...FIELD_VALUE_KEYS,
  ...EVENT_TYPE_KEYS,
  ...EVENT_TIMESTAMP_KEYS,
  "type",
  "enabled",
  "required",
  "use",
  "format",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[\s_\-:/]/g, "");
}

function isEmailAddress(value: string | null | undefined): boolean {
  return Boolean(value && value.includes("@"));
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

function timestampFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 6 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRecords(item, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [
    value,
    ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
  ];
}

function getFirstString(record: UnknownRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringFromUnknown(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function getFirstTimestamp(record: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = timestampFromUnknown(record[key]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function isAddressField(record: UnknownRecord): boolean {
  const identifier = getFirstString(record, FIELD_IDENTIFIER_KEYS);
  if (identifier && ADDRESS_FIELD_IDENTIFIERS.has(normalizeIdentifier(identifier))) {
    return true;
  }

  return Object.keys(record).some((key) => ADDRESS_FIELD_IDENTIFIERS.has(normalizeIdentifier(key)));
}

function getAddressValue(record: UnknownRecord): string | null {
  const explicitValue = getFirstString(record, FIELD_VALUE_KEYS);
  if (explicitValue) {
    return explicitValue;
  }

  for (const [key, value] of Object.entries(record)) {
    if (!ADDRESS_FIELD_IDENTIFIERS.has(normalizeIdentifier(key))) {
      continue;
    }

    const nextValue = stringFromUnknown(value);
    if (nextValue) {
      return nextValue;
    }
  }

  return null;
}

function getFieldValue(record: UnknownRecord): string | null {
  return getFirstString(record, FIELD_VALUE_KEYS);
}

function getFieldCandidates(
  document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined
): UnknownRecord[] {
  if (!document) {
    return [];
  }

  return [...collectRecords(document.fields), ...collectRecords(document.detail_template_info)];
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const nextValue = stringFromUnknown(value);
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }

    seen.add(nextValue);
    result.push(nextValue);
  }

  return result;
}

export function extractDocumentFieldValues(
  document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined,
  aliases: string[]
): string[] {
  if (!document || aliases.length === 0) {
    return [];
  }

  const normalizedAliases = new Set(aliases.map((alias) => normalizeIdentifier(alias)));
  const matches: string[] = [];

  for (const record of getFieldCandidates(document)) {
    const identifier = getFirstString(record, FIELD_IDENTIFIER_KEYS);
    if (identifier && normalizedAliases.has(normalizeIdentifier(identifier))) {
      const value = getFieldValue(record);
      if (value) {
        matches.push(value);
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (IGNORED_INLINE_FIELD_KEYS.has(key)) {
        continue;
      }

      if (!normalizedAliases.has(normalizeIdentifier(key))) {
        continue;
      }

      const inlineValue = stringFromUnknown(value);
      if (inlineValue) {
        matches.push(inlineValue);
      }
    }
  }

  return uniqueNonEmpty(matches);
}

export function extractDocumentFieldValue(
  document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined,
  aliases: string[]
): string | null {
  return extractDocumentFieldValues(document, aliases)[0] ?? null;
}

function extractRecipientContacts(recipients: unknown[] | null | undefined): {
  phone?: string;
  email?: string;
} {
  if (!recipients || recipients.length === 0) {
    return {};
  }

  let phone: string | undefined;
  let email: string | undefined;

  for (const record of collectRecords(recipients)) {
    if (!phone) {
      phone =
        getFirstString(record, ["sms", "phone", "phone_number", "mobile", "mobile_number", "tel"]) ??
        undefined;
    }

    const recipientIdentifier =
      getFirstString(record, ["id", "email", "mail", "recipient_id"]) ?? undefined;
    if (!email && isEmailAddress(recipientIdentifier)) {
      email = recipientIdentifier;
    }
    if (!phone && recipientIdentifier && !isEmailAddress(recipientIdentifier)) {
      phone = recipientIdentifier;
    }

    if (phone && email) {
      break;
    }
  }

  return { phone, email };
}

export function extractDocumentContactInfo(
  document: Pick<
    EformsignDocument,
    "current_status" | "last_editor" | "recipients" | "fields" | "detail_template_info"
  > | null | undefined
): {
  phone?: string;
  email?: string;
} {
  if (!document) {
    return {};
  }

  const currentRecipient = document.current_status?.step_recipients?.[0];
  const currentRecipientPhone = stringFromUnknown(currentRecipient?.sms) ?? undefined;
  const currentRecipientId = stringFromUnknown(currentRecipient?.id) ?? undefined;
  const currentRecipientEmail = isEmailAddress(currentRecipientId) ? currentRecipientId : undefined;
  const currentRecipientFallbackPhone =
    currentRecipientId && !isEmailAddress(currentRecipientId) ? currentRecipientId : undefined;

  const fieldPhone =
    extractDocumentFieldValue(document, CUSTOMER_CONTACT_PHONE_ALIASES) ??
    extractDocumentFieldValue(document, GENERIC_CONTACT_PHONE_ALIASES) ??
    undefined;
  const fieldEmail =
    extractDocumentFieldValue(document, CUSTOMER_CONTACT_EMAIL_ALIASES) ??
    extractDocumentFieldValue(document, GENERIC_CONTACT_EMAIL_ALIASES) ??
    undefined;
  const recipientContacts = extractRecipientContacts(document.recipients);

  const lastEditorId = stringFromUnknown(document.last_editor?.id) ?? undefined;
  const lastEditorEmail =
    document.last_editor?.recipient_type === "02" && isEmailAddress(lastEditorId)
      ? lastEditorId
      : undefined;
  const lastEditorPhone =
    document.last_editor?.recipient_type === "02" && lastEditorId && !isEmailAddress(lastEditorId)
      ? lastEditorId
      : undefined;

  return {
    // The current workflow recipient changes by step, so explicit customer fields must win.
    phone:
      fieldPhone ??
      recipientContacts.phone ??
      currentRecipientPhone ??
      currentRecipientFallbackPhone ??
      lastEditorPhone,
    email: fieldEmail ?? recipientContacts.email ?? currentRecipientEmail ?? lastEditorEmail,
  };
}

function hasMatchingEvent(record: UnknownRecord, codes: Set<string>, keywords: string[]): boolean {
  const eventTokens = [
    ...EVENT_TYPE_KEYS.map((key) => stringFromUnknown(record[key])),
    ...Object.entries(record)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => `${key}:${value}`),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return eventTokens.some((token) => {
    const normalized = normalizeStatusCode(token);
    if (codes.has(normalized)) {
      return true;
    }

    return keywords.some((keyword) => token.includes(keyword));
  });
}

function isReRequestRecord(record: UnknownRecord): boolean {
  return hasMatchingEvent(record, REREQUEST_CODES, REREQUEST_KEYWORDS);
}

function isOpenRecord(record: UnknownRecord): boolean {
  return hasMatchingEvent(record, OPEN_CODES, OPEN_KEYWORDS);
}

function isSignRecord(record: UnknownRecord): boolean {
  return hasMatchingEvent(record, SIGN_CODES, SIGN_KEYWORDS);
}

export function extractDocumentAddress(document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined): string | null {
  if (!document) {
    return null;
  }

  const candidates = getFieldCandidates(document);

  for (const record of candidates) {
    if (!isAddressField(record)) {
      continue;
    }

    const value = getAddressValue(record);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractTimelineEvents(
  document: Pick<EformsignDocument, "histories" | "previous_status" | "current_status" | "updated_date"> | null | undefined,
  matcher: (record: UnknownRecord) => boolean,
  fallbackCodes: Set<string>
): EformsignTimelineEvent[] {
  if (!document) {
    return [];
  }

  const timestamps = new Set<number>();
  const sources = [document.histories, document.previous_status];

  for (const source of sources) {
    for (const record of collectRecords(source)) {
      if (!matcher(record)) {
        continue;
      }

      const timestamp =
        getFirstTimestamp(record, EVENT_TIMESTAMP_KEYS) ??
        timestampFromUnknown(record.timestamp) ??
        document.updated_date;

      if (timestamp != null) {
        timestamps.add(timestamp);
      }
    }
  }

  if (
    timestamps.size === 0 &&
    fallbackCodes.has(normalizeStatusCode(document.current_status?.status_type)) &&
    document.updated_date
  ) {
    timestamps.add(document.updated_date);
  }

  return [...timestamps]
    .sort((left, right) => left - right)
    .map((timestamp) => ({ timestamp }));
}

export function extractReRequestEvents(
  document: Pick<EformsignDocument, "histories" | "previous_status" | "current_status" | "updated_date"> | null | undefined
): EformsignTimelineEvent[] {
  return extractTimelineEvents(document, isReRequestRecord, REREQUEST_CODES);
}

export function extractOpenEvents(
  document: Pick<EformsignDocument, "histories" | "previous_status" | "current_status" | "updated_date"> | null | undefined
): EformsignTimelineEvent[] {
  return extractTimelineEvents(document, isOpenRecord, OPEN_CODES);
}

export function extractSignEvents(
  document: Pick<EformsignDocument, "histories" | "previous_status" | "current_status" | "updated_date"> | null | undefined
): EformsignTimelineEvent[] {
  return extractTimelineEvents(document, isSignRecord, SIGN_CODES);
}

/**
 * Returns the timestamp at which the customer's step finished — i.e. the
 * moment the workflow transitioned from the customer's signing step into the
 * staff approval step. For 2-step docs this is the record where
 * status_type === "060" AND step_index === "3" (staff approval requested).
 * Falls back to the earliest "doc_accept_outsider/participant" event for
 * legacy 1-step docs that have no separate staff step.
 */
export function extractCustomerSignedTimestamp(
  document: Pick<EformsignDocument, "histories" | "previous_status" | "current_status" | "updated_date"> | null | undefined
): number | null {
  if (!document) return null;

  const candidates: number[] = [];
  const sources = [document.histories, document.previous_status];
  const stepIndexKeys = ["step_index", "stepIndex", "step_idx", "step_seq"] as const;

  for (const source of sources) {
    for (const record of collectRecords(source)) {
      const statusType = getFirstString(record, EVENT_TYPE_KEYS);
      const stepIndex = getFirstString(record, stepIndexKeys);
      if (
        statusType != null &&
        normalizeStatusCode(statusType) === "060" &&
        stepIndex === "3"
      ) {
        const timestamp =
          getFirstTimestamp(record, EVENT_TIMESTAMP_KEYS) ??
          timestampFromUnknown(record.timestamp);
        if (timestamp != null) candidates.push(timestamp);
      }
    }
  }

  if (candidates.length > 0) return Math.min(...candidates);

  const signEvents = extractSignEvents(document);
  return signEvents.length > 0 ? signEvents[0].timestamp : null;
}
