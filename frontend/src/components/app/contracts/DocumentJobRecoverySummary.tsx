"use client";

import type {
  CreateEformsignDocumentJobRequest,
  EformsignDocumentJobResponse,
  FinalizeEformsignDocumentJobRequest,
} from "@/services/api";

const SOURCE_COMPONENT = "DocumentJobRecoverySummary";

/** What a resend may send, rebuilt field by field from the saved payload. */
export type DocumentJobResendInput =
  | { kind: "create"; request: Omit<CreateEformsignDocumentJobRequest, "requestKey"> }
  | { kind: "finalize"; request: Omit<FinalizeEformsignDocumentJobRequest, "requestKey"> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absent or null is "not set"; anything else must be a non-empty string. */
function readOptionalString(source: Record<string, unknown>, key: string): { ok: true; value?: string } | { ok: false } {
  const value = source[key];
  if (value === undefined || value === null) return { ok: true };
  if (typeof value === "string" && value.length > 0) return { ok: true, value };
  return { ok: false };
}

/**
 * Narrows the server-kept job payload to the input a resend can safely rebuild.
 * Fails closed: anything unexpected, including a `prefillAmounts` key that staff
 * finalization never carries, returns null and the dialog offers no resend.
 */
export function parseDocumentJobResendInput(
  jobType: EformsignDocumentJobResponse["jobType"],
  payload: Record<string, unknown> | null,
): DocumentJobResendInput | null {
  if (!isPlainObject(payload) || "prefillAmounts" in payload) return null;

  if (jobType === "create_document") {
    const { clientId, contractData } = payload;
    if (typeof clientId !== "number" || !Number.isInteger(clientId) || clientId < 1) return null;
    if (!isPlainObject(contractData)) return null;
    const supersede = readOptionalString(payload, "supersedeDocumentId");
    if (!supersede.ok) return null;
    return {
      kind: "create",
      request: {
        clientId,
        contractData: contractData as unknown as CreateEformsignDocumentJobRequest["contractData"],
        ...(supersede.value ? { supersedeDocumentId: supersede.value } : {}),
      },
    };
  }

  if (jobType === "finalize_document") {
    const documentId = payload.documentId;
    if (typeof documentId !== "string" || documentId.length === 0) return null;
    const endDate = readOptionalString(payload, "prefillEndDate");
    if (!endDate.ok) return null;
    return {
      kind: "finalize",
      request: { documentId, ...(endDate.value ? { prefillEndDate: endDate.value } : {}) },
    };
  }

  return null;
}

function readText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readAmount(source: Record<string, unknown>, key: string): string | null {
  const text = readText(source, key);
  if (!text) return null;
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? `${numeric.toLocaleString("ko-KR")}원` : text;
}

interface SummaryRow {
  key: string;
  label: string;
  value: string;
}

function buildRows(
  job: Pick<EformsignDocumentJobResponse, "clientName">,
  input: DocumentJobResendInput,
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const push = (key: string, label: string, value: string | null | undefined) => {
    if (value) rows.push({ key, label, value });
  };

  if (input.kind === "finalize") {
    push("client", "고객", job.clientName?.trim());
    push("document", "문서", input.request.documentId);
    push("endDate", "서비스 종료일", input.request.prefillEndDate ?? "지정하지 않음");
    return rows;
  }

  const data = input.request.contractData as unknown as Record<string, unknown>;
  const startDate = readText(data, "startDate");
  const endDate = readText(data, "endDate");
  // The dates are the source of truth; contractDuration is only a fallback when neither exists.
  const duration = startDate || endDate
    ? [startDate ?? "", endDate ?? ""].join(" ~ ").trim()
    : readText(data, "contractDuration");
  const voucher = [readText(data, "type"), readText(data, "days")].filter(Boolean).join(" · ");

  push("client", "고객", job.clientName?.trim() || readText(data, "customerName"));
  push("contact", "이용자 연락처", readText(data, "customerContact"));
  push("duration", "계약 기간", duration);
  push("caretaker", "제공인력", readText(data, "caretaker1Name"));
  push("voucher", "바우처", voucher);
  push("area", "지역", readText(data, "area"));
  push("fullPrice", "총 금액", readAmount(data, "fullPrice"));
  push("grant", "지원금", readAmount(data, "grant"));
  push("actualPrice", "본인부담금", readAmount(data, "actualPrice"));
  push("supersede", "재발행", input.request.supersedeDocumentId ? "기존 계약서를 대체해요" : null);
  return rows;
}

export interface DocumentJobRecoverySummaryProps {
  job: Pick<EformsignDocumentJobResponse, "clientName">;
  input: DocumentJobResendInput;
  "data-component"?: string;
}

/** Read-only view of the input a failed job saved, so staff can see what a resend would send. */
export function DocumentJobRecoverySummary({
  job,
  input,
  "data-component": dataComponent,
}: DocumentJobRecoverySummaryProps) {
  const rows = buildRows(job, input);

  return (
    <dl
      data-component={dataComponent}
      data-slot="document-job-recovery-summary"
      data-source-component={SOURCE_COMPONENT}
      aria-label="저장된 내용"
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-v3-dim-white px-4 py-3 text-[calc(13px*var(--glint-ui-scale,1))]"
    >
      {rows.map((row) => (
        <div key={row.key} data-slot="document-job-recovery-summary-row" className="contents">
          <dt className="text-v3-text-muted">{row.label}</dt>
          <dd className="min-w-0 break-words font-medium text-v3-dark">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
