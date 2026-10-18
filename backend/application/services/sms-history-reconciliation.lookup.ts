import {
    ALIGO_HISTORY_MAX_AGE_MS,
    ALIGO_HISTORY_MIN_AGE_MS,
    MessageLogEntity,
    withoutAligoHistoryBookkeeping,
} from "domain/entities/message-log.entity";
import { IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";

// /list/, /sms_list/ 응답의 start_date/limit_day 날짜 의미, receiver 형식, LMS msg 잘림,
// 이력 지연을 live API로 확인한 뒤에만 true로 바꾼다.
export const ALIGO_HISTORY_ABSENT_AUTO_RESEND = false;
export const ALIGO_HISTORY_PAGE_CAP = 10;
export const ALIGO_HISTORY_SMS_CALL_CAP = 30;
export const ALIGO_HISTORY_PAGE_SIZE = 500;
export const ALIGO_HISTORY_LOOKUP_TIMEOUT_MS = 10_000;
export const ALIGO_HISTORY_CONFIRM_AGE_MS = 15 * 60 * 1000;
export const ALIGO_HISTORY_FAILURE_LIMIT = 3;
export const ALIGO_HISTORY_WINDOW_BEFORE_MS = 60_000;
export const ALIGO_HISTORY_WINDOW_AFTER_MS = 5 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;

export type AligoHistoryResult =
    | { kind: "DELIVERED" | "NO_SUBSCRIBER"; mid: string }
    | { kind: "ABSENT" | "INCONCLUSIVE" };
type HistoryPort = Pick<IAligoSmsApiPort, "listHistory" | "listSmsHistory">;
type HistoryRow = Record<string, unknown>;

export function isAligoHistoryEligible(log: MessageLogEntity, now: Date): boolean {
    const age = log.providerCallStartedAt ? now.getTime() - log.providerCallStartedAt.getTime() : NaN;
    const last = log.variables["historyLookupAt"];
    const lastTime = last ? Date.parse(last) : null;
    return (log.providerAcceptanceState === "uncertain" || log.providerAcceptanceState === "started")
        && log.provider === "aligo_sms" && log.variables["msgType"] !== "MMS"
        && !log.isPartialProviderOutcome() && /^[\d\s()+-]+$/.test(log.receiver)
        && /^\d{10,11}$/.test(log.receiver.replace(/\D/g, ""))
        && !log.variables["scheduledDate"] && log.variables["testMode"] !== "true"
        && log.variables["historyLookup"] !== "exhausted"
        && Number.isFinite(age) && age >= ALIGO_HISTORY_MIN_AGE_MS && age <= ALIGO_HISTORY_MAX_AGE_MS
        && (lastTime === null || (Number.isFinite(lastTime) && now.getTime() - lastTime >= ALIGO_HISTORY_MIN_AGE_MS));
}

function record(value: unknown): HistoryRow {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid history row");
    return value as HistoryRow;
}

async function boundedCall(call: () => Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([call(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("History timeout")), ALIGO_HISTORY_LOOKUP_TIMEOUT_MS);
        })]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function pages(call: (page: number) => Promise<unknown>): Promise<HistoryRow[]> {
    const rows: HistoryRow[] = [];
    for (let page = 1; page <= ALIGO_HISTORY_PAGE_CAP; page += 1) {
        const body = record(await boundedCall(() => call(page)));
        const code = body["result_code"];
        if ((typeof code !== "number" && typeof code !== "string") || String(code).trim() === ""
            || !Number.isFinite(Number(code)) || Number(code) <= 0 || typeof body["message"] !== "string"
            || !Array.isArray(body["list"]) || !["Y", "N"].includes(String(body["next_yn"]))) {
            throw new Error("Invalid history page");
        }
        rows.push(...body["list"].map(record));
        if (body["next_yn"] !== "Y") return rows;
    }
    throw new Error("History page cap reached");
}

function historyTime(value: unknown): number {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        throw new Error("Invalid history date");
    }
    const time = Date.parse(`${value.replace(" ", "T")}+09:00`);
    if (!Number.isFinite(time) || new Date(time + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ") !== value) {
        throw new Error("Invalid history date");
    }
    return time;
}

function kstDate(time: number): string {
    return new Date(time + KST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

function text(value: string): string {
    return value.replace(/\r\n/g, "\n").trim();
}

function receiverOutcome(rows: HistoryRow[], receiver: string): AligoHistoryResult["kind"] | null {
    let result: "DELIVERED" | "NO_SUBSCRIBER" | null = null;
    for (const row of rows) {
        if (typeof row["receiver"] !== "string") throw new Error("Invalid receiver");
        const digits = row["receiver"].replace(/\D/g, "");
        if (!/^\d{10,11}$/.test(digits)) throw new Error("Masked receiver");
        const state = row["sms_state"];
        if (state !== "발송완료" && state !== "전송중" && state !== "가입자없음") throw new Error("Unknown SMS state");
        if (digits !== receiver) continue;
        const next = state === "가입자없음" ? "NO_SUBSCRIBER" : "DELIVERED";
        if (result && result !== next) throw new Error("Conflicting history");
        result = next;
    }
    return result;
}

/** Fail closed: a receipt alone can never prove absence, and any bad page voids the lookup. */
export async function lookupAligoHistory(
    log: MessageLogEntity,
    api: HistoryPort,
    storedMids: (mids: string[]) => Promise<Set<string>>,
): Promise<AligoHistoryResult> {
    try {
        const receiver = log.receiver.replace(/\D/g, "");
        let smsCalls = 0;
        const smsRows = (mid: string) => pages(page => {
            smsCalls += 1;
            if (smsCalls > ALIGO_HISTORY_SMS_CALL_CAP) throw new Error("SMS history call cap reached");
            if (!api.listSmsHistory) throw new Error("SMS history unavailable");
            return api.listSmsHistory({ mid, page, page_size: ALIGO_HISTORY_PAGE_SIZE });
        });
        if (log.aligoMid) {
            const result = receiverOutcome(await smsRows(log.aligoMid), receiver);
            return result === "DELIVERED" || result === "NO_SUBSCRIBER"
                ? { kind: result, mid: log.aligoMid } : { kind: "INCONCLUSIVE" };
        }
        if (!log.providerCallStartedAt) return { kind: "INCONCLUSIVE" };
        const start = log.providerCallStartedAt.getTime() - ALIGO_HISTORY_WINDOW_BEFORE_MS;
        const end = log.providerCallStartedAt.getTime() + ALIGO_HISTORY_WINDOW_AFTER_MS;
        const dates = [...new Set([kstDate(start), kstDate(end)])];
        const entries: Array<{ mid: string; msg: string; time: number }> = [];
        for (const date of dates) {
            const rows = await pages(page => {
                if (!api.listHistory) throw new Error("Send history unavailable");
                return api.listHistory({ page, page_size: ALIGO_HISTORY_PAGE_SIZE, start_date: date, limit_day: 1 });
            });
            for (const row of rows) {
                const mid = row["mid"];
                if ((typeof mid !== "string" && typeof mid !== "number") || !String(mid).trim()
                    || typeof row["msg"] !== "string") throw new Error("Invalid send history");
                entries.push({ mid: String(mid), msg: row["msg"], time: historyTime(row["reg_date"]) });
            }
        }
        const window = [...new Map(entries.filter(entry => entry.time >= start && entry.time <= end)
            .map(entry => [entry.mid, entry])).values()];
        const used = await storedMids(window.map(entry => entry.mid));
        let matched: AligoHistoryResult | null = null;
        for (const entry of window) {
            if (used.has(entry.mid)) continue;
            const rows = await smsRows(entry.mid);
            if (rows.length === 0) throw new Error("Empty receiver history");
            const result = receiverOutcome(rows, receiver);
            if (result === null) continue;
            if (text(entry.msg) !== text(log.messageBody)
                && (!log.recipientName || text(entry.msg) !== text(log.messageBody.replace(/%고객명%/g, log.recipientName)))) {
                throw new Error("Receiver with different text");
            }
            if (result !== "DELIVERED" && result !== "NO_SUBSCRIBER") throw new Error("Unknown result");
            if (matched && (matched.kind !== result || ("mid" in matched && matched.mid !== entry.mid))) {
                throw new Error("Ambiguous receipts");
            }
            matched = { kind: result, mid: entry.mid };
        }
        if (matched) return matched;
        return { kind: entries.some(entry => entry.time < start) && entries.some(entry => entry.time > end)
            ? "ABSENT" : "INCONCLUSIVE" };
    } catch {
        return { kind: "INCONCLUSIVE" };
    }
}

export interface AligoHistoryDecision {
    variables: Record<string, string>;
    outcome: "delivered" | "not-delivered" | null;
    retry: "schedule" | "none";
    reason: string;
    mid?: string;
}

export function decideAligoHistoryOutcome(
    log: MessageLogEntity,
    result: AligoHistoryResult,
    now: Date,
    policyEnabled: boolean,
    autoResend: boolean = ALIGO_HISTORY_ABSENT_AUTO_RESEND,
): AligoHistoryDecision {
    const variables: Record<string, string> = { ...log.variables, historyLookup: "checking", historyLookupAt: now.toISOString() };
    const pending: AligoHistoryDecision = { variables, outcome: null, retry: "none", reason: "" };
    const previousAbsent = Date.parse(log.variables["historyLookupAbsentAt"] ?? "");
    if (result.kind !== "ABSENT") delete variables["historyLookupAbsentAt"];
    if (result.kind === "INCONCLUSIVE") {
        const previous = Number(log.variables["historyLookupFailures"] ?? 0);
        const failures = (Number.isFinite(previous) && previous >= 0 ? previous : 0) + 1;
        variables["historyLookupFailures"] = String(failures);
        if (failures >= ALIGO_HISTORY_FAILURE_LIMIT) variables["historyLookup"] = "exhausted";
        return pending;
    }
    if (result.kind === "ABSENT") {
        if (!Number.isFinite(previousAbsent)) {
            variables["historyLookupAbsentAt"] = now.toISOString();
            return pending;
        }
        if (!log.providerCallStartedAt || now.getTime() - previousAbsent < ALIGO_HISTORY_MIN_AGE_MS
            || now.getTime() - log.providerCallStartedAt.getTime() < ALIGO_HISTORY_CONFIRM_AGE_MS) return pending;
    }
    return {
        variables: withoutAligoHistoryBookkeeping(variables),
        outcome: result.kind === "DELIVERED" ? "delivered" : "not-delivered",
        retry: result.kind === "ABSENT" && autoResend && log.triggerJobId !== null
            && log.branchId !== null && log.canRetry() && policyEnabled ? "schedule" : "none",
        reason: result.kind === "DELIVERED" ? "Aligo 이력 발송 확인"
            : result.kind === "NO_SUBSCRIBER" ? "발송 실패: 잘못된 번호" : "발송 실패: 응답 없음",
        ...("mid" in result ? { mid: result.mid } : {}),
    };
}
