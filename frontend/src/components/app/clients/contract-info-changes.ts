import type { ClientFormData, DocumentStatus } from "@/features/clients/types";
import { formatKoreanPhoneNumber } from "@/lib/phone";

import { serializeClientUpdateFields } from "./client-update-payload";

/**
 * The client fields a contract carries. Once the contract is completed it can no longer be
 * changed, so editing one of these leaves the client and the contract disagreeing; the backend
 * records that as a "정보 불일치" note (ClientNoteService), using this same field list.
 */
export const CONTRACT_INFO_FIELDS = [
    "name",
    "phone",
    "address",
    "birthday",
    "startDate",
    "endDate",
    "duration",
    "fullPrice",
    "grant",
    "actualPrice",
] as const;

export type ContractInfoField = (typeof CONTRACT_INFO_FIELDS)[number];

export const CONTRACT_INFO_FIELD_LABEL_KEYS: Record<ContractInfoField, string> = {
    name: "clients.form.name",
    phone: "clients.form.phone",
    address: "clients.form.address",
    birthday: "clients.form.birthday",
    startDate: "clients.form.start-date",
    endDate: "clients.form.end-date",
    duration: "clients.form.duration",
    fullPrice: "clients.form.full-price",
    grant: "clients.form.grant",
    actualPrice: "clients.form.actual-price",
};

const DATE_FIELDS = new Set<ContractInfoField>(["birthday", "startDate", "endDate"]);
const PRICE_FIELDS = new Set<ContractInfoField>(["fullPrice", "grant", "actualPrice"]);

export interface ContractInfoChangeRow {
    field: ContractInfoField;
    labelKey: string;
    /** The value before this save, formatted for display ("-" when empty). */
    previous: string;
    /** The value this save writes, formatted for display ("-" when empty). */
    next: string;
}

/** Same normalization as the backend's normalizeContractInfoValue, so both agree on "changed". */
export function normalizeContractInfoValue(field: ContractInfoField, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (DATE_FIELDS.has(field)) return text.slice(0, 10);
    if (PRICE_FIELDS.has(field)) {
        const digits = text.replace(/[^0-9]/g, "");
        return digits ? String(Number(digits)) : null;
    }
    return text;
}

function formatContractInfoValue(field: ContractInfoField, value: string | null): string {
    if (value === null) return "-";
    if (DATE_FIELDS.has(field)) return value.replaceAll("-", ".");
    if (PRICE_FIELDS.has(field)) return `${Number(value).toLocaleString("ko-KR")}원`;
    if (field === "duration") return `${value}일`;
    if (field === "phone") return formatKoreanPhoneNumber(value);
    return value;
}

/** The contract fields a save over `baseline` would change, in form order. */
export function getContractInfoChanges(baseline: ClientFormData, current: ClientFormData): ContractInfoChangeRow[] {
    const before = serializeClientUpdateFields(baseline);
    const after = serializeClientUpdateFields(current);

    return CONTRACT_INFO_FIELDS.flatMap((field) => {
        const previous = normalizeContractInfoValue(field, before[field]);
        const next = normalizeContractInfoValue(field, after[field]);
        if (previous === next) return [];
        return [{
            field,
            labelKey: CONTRACT_INFO_FIELD_LABEL_KEYS[field],
            previous: formatContractInfoValue(field, previous),
            next: formatContractInfoValue(field, next),
        }];
    });
}

/**
 * The client fields a service-record document carries. Once the document is completed it keeps
 * the old values, so editing one of these is confirmed separately from the contract.
 */
export const SERVICE_RECORD_DOCUMENT_FIELDS: readonly ContractInfoField[] = ["name", "startDate", "endDate"];

/** The service-record document fields a save over `baseline` would change, in form order. */
export function getServiceRecordDocumentChanges(baseline: ClientFormData, current: ClientFormData): ContractInfoChangeRow[] {
    return getContractInfoChanges(baseline, current)
        .filter((change) => SERVICE_RECORD_DOCUMENT_FIELDS.includes(change.field));
}

/** Whether the client's current contract is completed, so its fields can no longer change. */
export function isContractLocked(documentStatus: DocumentStatus | undefined): boolean {
    return documentStatus === "completed";
}

/** Binds a confirmation to the exact changed values; any further edit must be confirmed again. */
export function getContractInfoChangeKey(changes: ContractInfoChangeRow[]): string {
    return JSON.stringify(changes.map((change) => [change.field, change.next]));
}
