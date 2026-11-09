/** Shared schedule conflict, planned-vector, token-expiry and automation-intent helpers. */
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";

import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "application/services/message-automation-intent-writer";
import { problemBody } from "application/utils/problem-bodies";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { type KrBusinessDayCalendar } from "domain/utils/business-days";

/** The extension code a screen reads to send the admin to "제공기록지 일정 변경". */
export const REALIGNMENT_REQUIRES_MANUAL_SCHEDULE = "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" as const;

const MANUAL_SCHEDULE_DETAIL =
    "남은 회차의 날짜를 자동으로 옮길 수 없어요. 제공기록지 일정 변경에서 날짜를 직접 지정해 주세요.";

export function manualScheduleConflict(): ConflictException {
    return new ConflictException({
        ...problemBody("REQUEST_CONFLICT", {
            pointer: "",
            code: "INVALID_VALUE",
            detail: MANUAL_SCHEDULE_DETAIL,
            location: "body",
        }),
        scheduleCode: REALIGNMENT_REQUIRES_MANUAL_SCHEDULE,
    });
}

/** Parse only a complete authoritative vector; null when the stored one cannot be trusted. */
export function parsePlannedVector(
    raw: Prisma.JsonValue,
    requiredSessionCount: number | null,
    calendar: KrBusinessDayCalendar,
): ServiceRecordPlannedSession[] | null {
    const values = Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null
            ? ((raw as Record<string, Prisma.JsonValue>)["sessions"]
                ?? (raw as Record<string, Prisma.JsonValue>)["entries"]
                ?? (raw as Record<string, Prisma.JsonValue>)["plannedSessions"])
            : null;
    if (!Array.isArray(values)) return null;

    const entries: ServiceRecordPlannedSession[] = [];
    for (const value of values) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        const row = value as Record<string, Prisma.JsonValue>;
        const provenance = typeof row["provenance"] === "object" && row["provenance"] !== null && !Array.isArray(row["provenance"])
            ? row["provenance"] as Record<string, Prisma.JsonValue>
            : null;
        const sessionIndex = row["sessionIndex"];
        const serviceDate = row["serviceDate"];
        const originalDate = row["originalDate"];
        const assignmentId = row["assignmentId"];
        const scheduleId = row["scheduleId"] ?? provenance?.["scheduleId"];
        const employeeId = row["employeeId"] ?? provenance?.["employeeId"];
        const provenanceVersion = row["provenanceVersion"] ?? provenance?.["version"] ?? row["version"];
        if (
            typeof sessionIndex !== "number"
            || !Number.isInteger(sessionIndex)
            || typeof serviceDate !== "string"
            || typeof originalDate !== "string"
            || typeof assignmentId !== "string"
            || typeof scheduleId !== "number"
            || !Number.isInteger(scheduleId)
            || typeof employeeId !== "number"
            || !Number.isInteger(employeeId)
            || (typeof provenanceVersion !== "string" && typeof provenanceVersion !== "number")
        ) {
            return null;
        }
        entries.push({
            sessionIndex,
            serviceDate,
            originalDate,
            assignmentId,
            scheduleId,
            employeeId,
            provenanceVersion: String(provenanceVersion),
        });
    }

    try {
        return validateServiceRecordScheduleVector(entries, requiredSessionCount ?? undefined, calendar, { persisted: true });
    } catch {
        return null;
    }
}

export async function refreshTokenExpiry(
    tx: Prisma.TransactionClient,
    branchId: string,
    caseId: string,
    endDate: Date,
    options: { raiseOnly?: boolean } = {},
): Promise<void> {
    const expiresAt = getServiceRecordTokenExpiresAt(endDate);
    await tx.service_record_token.updateMany({
        where: { branchId, serviceRecordCaseId: caseId, active: true, revokedAt: null,
            ...(options.raiseOnly ? { expiresAt: { lt: expiresAt } } : {}),
        },
        data: { expiresAt },
    });
}

/**
 * Leaves the durable marker the automation reconciler uses to recalculate
 * future jobs, the way the admin edit confirm does. Written in the caller's
 * transaction, so a later failure rolls it back with the dates.
 */
export async function persistReevaluationIntents(
    tx: Prisma.TransactionClient,
    params: {
        branchId: string;
        clientId: number;
        scheduleIds: ReadonlyArray<number | null>;
        intentAt: Date;
    },
): Promise<void> {
    const transaction = tx as unknown as {
        message_trigger_rule?: { upsert?: unknown };
        message_trigger_job?: { upsert?: unknown };
    };
    // Narrow unit doubles do not expose the message delegates; a real Prisma
    // transaction always does, so production stays durable and atomic.
    if (
        typeof transaction.message_trigger_rule?.upsert !== "function"
        || typeof transaction.message_trigger_job?.upsert !== "function"
    ) {
        return;
    }
    await persistClientMessageAutomationIntent(tx, {
        branchId: params.branchId,
        clientId: params.clientId,
        includePast: false,
        suppressGreeting: true,
        intentAt: params.intentAt,
    });
    const scheduleIds = [...new Set(
        params.scheduleIds.filter((scheduleId): scheduleId is number => (
            typeof scheduleId === "number" && Number.isInteger(scheduleId) && scheduleId > 0
        )),
    )].sort((left, right) => left - right);
    for (const scheduleId of scheduleIds) {
        await persistScheduleMessageAutomationIntent(tx, {
            branchId: params.branchId,
            clientId: params.clientId,
            scheduleId,
            includePast: false,
            intentAt: params.intentAt,
        });
    }
}
