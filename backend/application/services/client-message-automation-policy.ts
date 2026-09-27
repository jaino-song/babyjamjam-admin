import { Prisma } from "@prisma/client";

import { manualMessageTriggerJobPredicate } from "application/utils/message-trigger-job-ownership-sql";
import { CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import {
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";

export { CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON };

export type ClientMessageAutomationJobScope = {
    branchId: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
};

/** Read the durable client policy through the caller's transaction. */
export async function isClientMessageAutomationDisabled(
    transaction: Prisma.TransactionClient,
    clientId: number,
): Promise<boolean> {
    if (typeof transaction.client?.findUnique !== "function") return false;
    const client = await transaction.client.findUnique({
        where: { id: clientId },
        select: { messageAutomationDisabled: true },
    });
    return client?.messageAutomationDisabled === true;
}

/** Lock the client row before any client-owned automatic job row. */
export async function lockClientMessageAutomationPolicy(
    transaction: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
): Promise<boolean> {
    if (!transaction.client) return false;
    if (typeof transaction.$queryRaw !== "function") {
        if (typeof transaction.client?.findFirst !== "function") return false;
        const client = await transaction.client.findFirst({
            where: { id: clientId, branchId },
            select: { messageAutomationDisabled: true },
        });
        return client?.messageAutomationDisabled === true;
    }

    const rows = await transaction.$queryRaw<Array<{
        id: number;
        message_automation_disabled: boolean;
    }>>(Prisma.sql`
        SELECT "id", "message_automation_disabled"
        FROM "client"
        WHERE "id" = ${clientId}
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
    `);
    return rows[0]?.message_automation_disabled === true;
}

/**
 * Lock the client owning a job and reread its durable policy. The caller must
 * already hold the branch automation lock; this preserves branch -> client ->
 * source/job lock order at the dispatch and retry fences.
 */
export async function lockClientMessageAutomationForJob(
    transaction: Prisma.TransactionClient,
    job: ClientMessageAutomationJobScope,
): Promise<boolean> {
    if (!job.branchId || (job.clientId === null && job.employeeScheduleId === null)) return false;
    if (!transaction.client) return false;
    if (typeof transaction.$queryRaw !== "function") {
        if (job.clientId === null || typeof transaction.client?.findUnique !== "function") return false;
        return isClientMessageAutomationDisabled(transaction, job.clientId);
    }

    const rows = await transaction.$queryRaw<Array<{
        message_automation_disabled: boolean;
    }>>(Prisma.sql`
        SELECT client."message_automation_disabled"
        FROM "client" AS client
        WHERE client."id" = COALESCE(
            ${job.clientId === null ? Prisma.sql`NULL` : Prisma.sql`${job.clientId}`},
            (
                SELECT schedule."client_id"
                FROM "employee_schedule" AS schedule
                WHERE schedule."id" = ${job.employeeScheduleId ?? -1}
            )
        )
          AND client."branch_id" = ${job.branchId}::uuid
        FOR UPDATE OF client
    `);
    return rows[0]?.message_automation_disabled === true;
}

/** Lock the active schedules after the owning client has been locked. */
export async function lockClientMessageAutomationSchedules(
    transaction: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
): Promise<number[]> {
    if (typeof transaction.$queryRaw !== "function") {
        if (typeof transaction.employee_schedule?.findMany !== "function") return [];
        const schedules = await transaction.employee_schedule.findMany({
            where: { branchId, clientId, replaced: false, terminatedAt: null },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        return [...new Set(schedules.map((schedule) => schedule.id))]
            .sort((left, right) => left - right);
    }

    const rows = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "employee_schedule"
        WHERE "branch_id" = ${branchId}::uuid
          AND "client_id" = ${clientId}
          AND "replaced" = false
          AND "terminated_at" IS NULL
        ORDER BY "id" ASC
        FOR UPDATE
    `);
    return rows.map((row) => row.id);
}

/**
 * Cancel automatic jobs owned by a client or one of its schedules. Failed
 * rows are included only when they are the internal client/schedule recovery
 * markers. Manual agent, manual service-record, and manual service-end jobs
 * remain excluded by the shared ownership classifier.
 */
export async function cancelAutomaticMessageJobsForClient(
    transaction: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
    reason = CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON,
): Promise<number> {
    if (typeof transaction.$queryRaw !== "function") {
        if (typeof transaction.message_trigger_job?.updateMany !== "function") return 0;
        const result = await transaction.message_trigger_job.updateMany({
            where: { branchId, clientId, status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
                claimToken: null,
            },
        });
        const intentResult = await transaction.message_trigger_job.updateMany({
            where: {
                branchId,
                clientId,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
            },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
                claimToken: null,
                nextAttemptAt: null,
            },
        });
        return result.count + intentResult.count;
    }

    const manualJob = manualMessageTriggerJobPredicate({
        templateKey: Prisma.sql`job."template_key"`,
        ruleId: Prisma.sql`job."rule_id"`,
        dedupeKey: Prisma.sql`job."dedupe_key"`,
    });
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT job."id"
        FROM "message_trigger_job" AS job
        LEFT JOIN "employee_schedule" AS schedule
          ON schedule."id" = job."employee_schedule_id"
         AND schedule."branch_id" = ${branchId}::uuid
        WHERE job."branch_id" = ${branchId}::uuid
          AND (
            job."status" IN ('pending', 'processing')
            OR (
              job."status" = 'failed'
              AND job."rule_id" = ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
              AND job."cancel_reason" = ${MESSAGE_AUTOMATION_INTENT_RETRY_REASON}
            )
          )
          AND (job."client_id" = ${clientId} OR schedule."client_id" = ${clientId})
          AND job."canceled_by_user" = false
          AND NOT (${manualJob})
        ORDER BY job."id" ASC
        FOR UPDATE OF job
    `);
    if (rows.length === 0) return 0;

    const canceled = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "message_trigger_job"
        SET "status" = 'canceled',
            "canceled_at" = date_trunc('milliseconds', clock_timestamp()),
            "cancel_reason" = ${reason},
            "canceled_by_user" = false,
            "claim_token" = NULL,
            "next_attempt_at" = NULL,
            "updated_at" = date_trunc('milliseconds', clock_timestamp())
        WHERE "id" IN (${Prisma.join(rows.map((row) => row.id))})
          AND (
            "status" IN ('pending', 'processing')
            OR (
              "status" = 'failed'
              AND "rule_id" = ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
              AND "cancel_reason" = ${MESSAGE_AUTOMATION_INTENT_RETRY_REASON}
            )
          )
          AND "canceled_by_user" = false
        RETURNING "id"
    `);
    return canceled.length;
}
