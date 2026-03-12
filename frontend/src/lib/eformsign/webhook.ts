import { normalizeStatusCode } from "@/lib/eformsign/status-codes";

type UnknownRecord = Record<string, unknown>;

export interface EformsignWebhookDocumentUpdate {
  documentId: string;
  statusType: string | null;
  statusDetail: string | null;
  stepType: string | null;
  stepIndex: string | null;
  stepName: string | null;
  expiredDate: number | null;
  receivedAt: number;
  raw: unknown;
}

const DOCUMENT_ID_KEYS = ["document_id", "documentId", "doc_id", "docId"] as const;
const STATUS_TYPE_KEYS = [
  "status_type",
  "statusType",
  "document_status_type",
  "documentStatusType",
  "status_code",
  "statusCode",
  "document_status",
  "documentStatus",
  "status",
] as const;
const STATUS_DETAIL_KEYS = [
  "status_doc_detail",
  "statusDocDetail",
  "document_status_detail",
  "documentStatusDetail",
  "status_detail",
  "statusDetail",
  "status_name",
  "statusName",
] as const;
const STEP_TYPE_KEYS = ["step_type", "stepType"] as const;
const STEP_INDEX_KEYS = ["step_index", "stepIndex", "step_idx", "stepIdx"] as const;
const STEP_NAME_KEYS = ["step_name", "stepName"] as const;
const EXPIRED_DATE_KEYS = ["expired_date", "expiredDate"] as const;
const DOCUMENT_MARKER_KEYS = [
  "document_name",
  "documentName",
  "document_number",
  "documentNumber",
  "current_status",
  "currentStatus",
  ...DOCUMENT_ID_KEYS,
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function hasDocumentMarkers(record: UnknownRecord): boolean {
  return DOCUMENT_MARKER_KEYS.some((key) => key in record);
}

function collectRecords(value: unknown, seen = new WeakSet<object>(), records: UnknownRecord[] = []): UnknownRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecords(item, seen, records);
    }
    return records;
  }

  if (!isRecord(value)) {
    return records;
  }

  if (seen.has(value)) {
    return records;
  }

  seen.add(value);
  records.push(value);

  for (const child of Object.values(value)) {
    collectRecords(child, seen, records);
  }

  return records;
}

function readFirstMatchingString(records: readonly UnknownRecord[], keys: readonly string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = asTrimmedString(record[key]);
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function readFirstMatchingNumber(records: readonly UnknownRecord[], keys: readonly string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = asNumber(record[key]);
      if (value != null) {
        return value;
      }
    }
  }

  return null;
}

function findDocumentId(records: readonly UnknownRecord[]): string | null {
  const explicitId = readFirstMatchingString(records, DOCUMENT_ID_KEYS);

  if (explicitId) {
    return explicitId;
  }

  for (const record of records) {
    if (!hasDocumentMarkers(record)) {
      continue;
    }

    const genericId = asTrimmedString(record.id);
    if (genericId) {
      return genericId;
    }
  }

  return null;
}

export function extractEformsignWebhookDocumentUpdate(payload: unknown): EformsignWebhookDocumentUpdate | null {
  const records = collectRecords(payload);
  const documentId = findDocumentId(records);

  if (!documentId) {
    return null;
  }

  const statusType = readFirstMatchingString(records, STATUS_TYPE_KEYS);
  const normalizedStatusType = statusType ? normalizeStatusCode(statusType) : null;

  return {
    documentId,
    statusType: normalizedStatusType,
    statusDetail: readFirstMatchingString(records, STATUS_DETAIL_KEYS),
    stepType: readFirstMatchingString(records, STEP_TYPE_KEYS),
    stepIndex: readFirstMatchingString(records, STEP_INDEX_KEYS),
    stepName: readFirstMatchingString(records, STEP_NAME_KEYS),
    expiredDate: readFirstMatchingNumber(records, EXPIRED_DATE_KEYS),
    receivedAt: Date.now(),
    raw: payload,
  };
}
