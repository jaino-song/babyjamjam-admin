import {
    DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
    isMessageTriggerTargetClientStatus,
    type MessageTriggerTargetClientStatus,
} from "domain/constants/message-trigger-catalog";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";

/**
 * 규칙 메시지-04. The greppable tokens carried by the cancel / supersede reason
 * when an automatic message is skipped by its routine's policy. They are
 * non-failure skips: no send attempt, no provider call, no retry.
 */
export const TARGET_CLIENT_STATUS_MISMATCH_TOKEN = "target_client_status_mismatch";
export const RULE_RETRY_DISABLED_TOKEN = "rule_retry_disabled";

export const TARGET_CLIENT_STATUS_MISMATCH_REASON =
    `${TARGET_CLIENT_STATUS_MISMATCH_TOKEN}: 규칙의 대상 고객 상태와 고객의 현재 상태가 달라 발송하지 않았습니다`;
export const RULE_RETRY_DISABLED_REASON =
    `${RULE_RETRY_DISABLED_TOKEN}: 규칙의 실패 시 재전송이 꺼져 있어 자동 재전송하지 않았습니다`;

/** The columns of a client that decide its effective service status. */
export interface ClientStatusFacts {
    serviceStatus: string | null;
    startDate: Date | null;
    endDate: Date | null;
    bookingConfirmedAt: Date | null;
}

/** The two routine settings read at dispatch time. */
export interface RuleSendPolicy {
    targetClientStatus: MessageTriggerTargetClientStatus;
    retryOnFailure: boolean;
}

/** A missing rule row (or a pre-migration row) behaves as 전체 / 재전송 켬. */
export const DEFAULT_RULE_SEND_POLICY: RuleSendPolicy = {
    targetClientStatus: DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
    retryOnFailure: DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
};

export function ruleSendPolicyFrom(
    rule: { targetClientStatus?: unknown; retryOnFailure?: unknown } | null | undefined,
): RuleSendPolicy {
    if (!rule) return DEFAULT_RULE_SEND_POLICY;
    return {
        targetClientStatus: isMessageTriggerTargetClientStatus(rule.targetClientStatus)
            ? rule.targetClientStatus
            : DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
        retryOnFailure: typeof rule.retryOnFailure === "boolean"
            ? rule.retryOnFailure
            : DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    };
}

/**
 * Whether a message of a routine with this target may be sent to this client
 * right now. `all` always allows (exactly today's behaviour). Any other target
 * requires the client's EFFECTIVE status — never the stored column, which lags —
 * to equal it; a client that can no longer be read cannot be verified and is
 * skipped.
 */
export function targetClientStatusAllowsSend(
    target: MessageTriggerTargetClientStatus,
    client: ClientStatusFacts | null | undefined,
): boolean {
    if (target === "all") return true;
    if (!client) return false;
    return getEffectiveClientServiceStatus(
        client.serviceStatus,
        client.startDate,
        client.endDate,
        client.bookingConfirmedAt,
    ) === target;
}
