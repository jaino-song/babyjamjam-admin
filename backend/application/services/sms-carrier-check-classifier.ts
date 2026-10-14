import type { AligoSmsDeliveryDetailRow } from "domain/ports/aligo-sms-api.port";

export type CarrierRecipientVerdict = "success" | "failure" | "pending" | "missing";

export interface CarrierRecipientResult {
    receiver: string;
    smsState: string | null;
    sendDate: string | null;
    verdict: CarrierRecipientVerdict;
}

export interface CarrierCheckClassification {
    outcome: "delivered" | "failed" | "unconfirmed";
    /** One per expected receiver, in input order. */
    recipients: CarrierRecipientResult[];
    failures: Array<{ receiver: string; smsState: string }>;
    /** Distinct states not in any known list (for logging). */
    unrecognizedStates: string[];
}

const SUCCESS_STATES: ReadonlySet<string> = new Set(["발송완료", "성공", "전송완료", "수신완료"]);
const PENDING_TOKENS = ["대기", "전송중", "처리중", "발송중", "진행", "결과없음", "확인중"] as const;
const KNOWN_FAILURE_TOKENS = [
    "가입자없음", "결번", "수신거부", "전원꺼짐", "단말기", "스팸",
    "번호이동", "착신", "음영", "기타", "실패", "오류", "차단",
] as const;

const digitsOnly = (value: string): string => value.replace(/\D/g, "");
const isPending = (state: string): boolean => PENDING_TOKENS.some((token) => state.includes(token));
const isKnownFailure = (state: string): boolean => KNOWN_FAILURE_TOKENS.some((token) => state.includes(token));

function verdictFor(state: string): CarrierRecipientVerdict {
    if (SUCCESS_STATES.has(state)) return "success";
    if (state === "" || isPending(state)) return "pending";
    return "failure";
}

export function classifyCarrierCheck(
    expectedReceivers: string[],
    rows: AligoSmsDeliveryDetailRow[],
): CarrierCheckClassification {
    const rowsByReceiver = new Map<string, AligoSmsDeliveryDetailRow[]>();
    for (const row of rows) {
        const key = digitsOnly(row.receiver);
        const bucket = rowsByReceiver.get(key);
        if (bucket) bucket.push(row);
        else rowsByReceiver.set(key, [row]);
    }

    const recipients: CarrierRecipientResult[] = [];
    const failures: Array<{ receiver: string; smsState: string }> = [];
    const unrecognized = new Set<string>();

    for (const expected of expectedReceivers) {
        const receiver = digitsOnly(expected);
        const row = rowsByReceiver.get(receiver)?.shift();
        if (!row) {
            recipients.push({ receiver, smsState: null, sendDate: null, verdict: "missing" });
            continue;
        }
        const smsState = row.smsState.trim();
        const verdict = verdictFor(smsState);
        recipients.push({ receiver, smsState, sendDate: row.sendDate, verdict });
        if (verdict === "failure") failures.push({ receiver, smsState });
        if (smsState !== "" && !SUCCESS_STATES.has(smsState) && !isPending(smsState) && !isKnownFailure(smsState)) {
            unrecognized.add(smsState);
        }
    }

    const outcome: CarrierCheckClassification["outcome"] = failures.length > 0
        ? "failed"
        : recipients.length > 0 && recipients.every((recipient) => recipient.verdict === "success")
            ? "delivered"
            : "unconfirmed";

    return { outcome, recipients, failures, unrecognizedStates: [...unrecognized] };
}

export function formatCarrierFailureMessage(failures: Array<{ receiver: string; smsState: string }>): string {
    const detail = failures
        .map(({ receiver, smsState }) => `${digitsOnly(receiver).slice(-4)} ${smsState}`)
        .join(", ");
    return `통신사 전달 실패: ${detail}`;
}
