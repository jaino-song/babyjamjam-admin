import { getSafeApiDisplayMessage, sanitizeApiDisplayMessage } from "../errors/safe-api-error-message";

export interface StandaloneReceiptRequest {
    clientId: number;
    copaymentReceivedDate: string;
    requestId: string;
}

export interface StandaloneReceiptAccepted {
    jobId: string;
    queued: true;
}

export const RECEIPT_BRANCH_HEADER = "X-Expected-Branch-Id";
export const RECEIPT_SEND_SUCCESS = "영수증 발송을 요청했습니다.";
export const RECEIPT_SEND_UNCONFIRMED = "발송 접수 여부를 확인하지 못했어요. 다시 시도해 주세요.";

const RECEIPT_SEND_REFUSED = "영수증 발송 요청을 접수하지 못했어요.";
const REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const inMemoryRequests = new Map<string, string>();

export function isCopaymentReceivedDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function readStandaloneReceiptAccepted(status: number, body: unknown): StandaloneReceiptAccepted | null {
    if (status !== 200 || !body || typeof body !== "object") return null;
    const { jobId, queued } = body as Partial<StandaloneReceiptAccepted>;
    return queued === true && typeof jobId === "string" && jobId.trim() ? { jobId, queued } : null;
}

export function readStandaloneReceiptRefusal(status: number, body: unknown): { code?: string; message: string } | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const { code, detail } = body as { code?: unknown; detail?: unknown };
    const isRefusal = status === 403 || status === 404
        || (status === 400 && (code === "INVALID_RECEIVED_DATE" || code === "MISSING_RECEIPT_FIELDS"))
        || (status === 409 && code === "REQUEST_ID_CONFLICT");
    if (!isRefusal) return null;

    const message = getSafeApiDisplayMessage({ status, data: body })
        ?? getSafeApiDisplayMessage({ status, data: { message: detail } });
    return {
        ...(typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? { code } : {}),
        message: (message && sanitizeApiDisplayMessage(message)) || RECEIPT_SEND_REFUSED,
    };
}

function createRequestId(): string {
    if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getPendingRequestId(key: string): string {
    try {
        const storedId = window.sessionStorage.getItem(key);
        if (storedId && UUID_PATTERN.test(storedId)) return storedId;

        const requestId = inMemoryRequests.get(key) ?? createRequestId();
        window.sessionStorage.setItem(key, requestId);
        inMemoryRequests.delete(key);
        return requestId;
    } catch {
        // An in-memory key still protects retries while this document is open.
        const requestId = inMemoryRequests.get(key) ?? createRequestId();
        inMemoryRequests.set(key, requestId);
        return requestId;
    }
}

function clearPendingRequestId(key: string, requestId: string): void {
    if (inMemoryRequests.get(key) === requestId) inMemoryRequests.delete(key);
    try {
        if (window.sessionStorage.getItem(key) === requestId) window.sessionStorage.removeItem(key);
    } catch {
        // In-memory retries also start fresh after a definitive result.
    }
}

type StandaloneReceiptOutcome = { accepted: true } | { accepted: false; message: string };

export async function requestStandaloneReceipt(
    branchId: string,
    clientId: number,
    copaymentReceivedDate: string,
): Promise<StandaloneReceiptOutcome> {
    const key = `standalone-receipt:${JSON.stringify([branchId, clientId, copaymentReceivedDate])}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const requestId = getPendingRequestId(key);
        const body: StandaloneReceiptRequest = { clientId, copaymentReceivedDate, requestId };
        const response = await fetch("/api/receipt-links/standalone", {
            method: "POST",
            headers: { "Content-Type": "application/json", [RECEIPT_BRANCH_HEADER]: branchId },
            body: JSON.stringify(body),
            redirect: "error",
            signal: controller.signal,
        });
        const data: unknown = await response.json();

        if (readStandaloneReceiptAccepted(response.status, data)) {
            clearPendingRequestId(key, requestId);
            return { accepted: true };
        }
        const refusal = readStandaloneReceiptRefusal(response.status, data);
        if (refusal) {
            clearPendingRequestId(key, requestId);
            return { accepted: false, message: refusal.message };
        }
    } catch {
        // The server may have committed before the connection failed.
    } finally {
        window.clearTimeout(timeout);
    }
    return { accepted: false, message: RECEIPT_SEND_UNCONFIRMED };
}
