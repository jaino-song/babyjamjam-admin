import { Prisma } from "@prisma/client";
import { MESSAGE_AUTOMATION_PARENT_DISABLED_REASON } from "application/services/message-automation-activation.service";
import { QUIET_HOURS_CANCEL_REASON } from "application/services/message-quiet-hours.service";
import { smsAutomationSafeguardReason } from "application/services/sms-automation-safeguard.service";
import { TARGET_CLIENT_STATUS_MISMATCH_REASON } from "application/policies/message-trigger-target-client-status.policy";
import { manualMessageTriggerJobPredicate } from "application/utils/message-trigger-job-ownership-sql";
import { ordinaryAutomationJobSql } from "application/utils/message-automation-record-sql";
import { CLIENT_DATE_AUTOMATION_CHANGED_REASON } from "domain/constants/message-automation-intent";
import {
    AUTOMATION_CONSENT_CANCEL_REASON, expiredPendingJobCancelReason,
    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON, MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON,
} from "domain/constants/message-automation-policy";
import { RECEIPT_RECOVERY_PREFIX, RECEIPT_RECOVERY_REASONS } from "domain/constants/receipt-job-recovery";
import { OCCURRENCE_ALREADY_ACCEPTED } from "domain/entities/message-occurrence";

const ordinaryRematerializationReasons = [
    "Client data changed", CLIENT_DATE_AUTOMATION_CHANGED_REASON, "Rule updated", "규칙 재생성", "Rule deactivated",
    MESSAGE_AUTOMATION_PARENT_DISABLED_REASON, TARGET_CLIENT_STATUS_MISMATCH_REASON, AUTOMATION_CONSENT_CANCEL_REASON,
    QUIET_HOURS_CANCEL_REASON, ...(["branch", "rule", "recipient"] as const).map(smsAutomationSafeguardReason),
    ...Array.from({ length: 720 }, (_, i) => expiredPendingJobCancelReason(i + 1)),
    "expired_after_quiet", MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON, "duplicate_at_release", OCCURRENCE_ALREADY_ACCEPTED,
];

export function receiptRecoveryChildSql(table = ""): Prisma.Sql {
    const column = (name: string) => Prisma.raw((table ? table + "." : "") + name);
    return Prisma.sql`((
        ${column("original_job_id")} IS NOT NULL AND ${column("recovery_epoch")} IS NOT NULL
        AND ${column("recovery_reason")} IN (${Prisma.join(RECEIPT_RECOVERY_REASONS)})
        AND ${column("dedupe_key")} = ${RECEIPT_RECOVERY_PREFIX} || ${column("original_job_id")}
        AND ${column("recipient_type")} = 'CLIENT' AND ${column("template_key")} = 'SERVICE_END_NOTICE'
    ) IS TRUE)`;
}

export function protectedReceiptOriginalSql(table: string): Prisma.Sql {
    const column = (name: string) => Prisma.raw(table + "." + name);
    const ownership = { ruleId: column("rule_id"), dedupeKey: column("dedupe_key"), templateKey: column("template_key"),
        payload: column("payload") };
    return Prisma.sql`((
        ${column("status")} = 'canceled'
        AND ${column("branch_id")} IS NOT NULL AND ${column("client_id")} IS NOT NULL
        AND ${column("recipient_type")} = 'CLIENT' AND ${column("template_key")} = 'SERVICE_END_NOTICE'
        AND ${column("original_job_id")} IS NULL
        AND ${ordinaryAutomationJobSql(ownership)} AND NOT ${manualMessageTriggerJobPredicate(ownership)}
        AND ${column("rule_id")} <> 'system:service_end_notice'
        AND (
            ${column("canceled_by_user")} OR ${column("cancel_reason")} = ${MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON}
            OR ${column("first_blocked_at")} IS NOT NULL
            OR (${column("recovery_reason")} IS NULL AND (
                ${column("cancel_reason")} IS NULL OR ${column("cancel_reason")} NOT IN (${Prisma.join(ordinaryRematerializationReasons)})
            ))
        )
    ) IS TRUE)`;
}
