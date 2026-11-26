import type { FetalConfirmation, Prisma } from "@prisma/client";
import { resolveServiceRecordCaseTarget } from "./service-record-case-target";

interface LegacyLinkSchedule {
    id: number;
    branchId: string | null;
    clientId: number;
    primaryEmployeeId: number;
    client: { fetalConfirmation: FetalConfirmation | null };
}

/** The single-link job format can only name the schedule's primary caregiver. */
export async function allowsLegacyServiceRecordLink(
    tx: Prisma.TransactionClient,
    schedule: LegacyLinkSchedule,
): Promise<boolean> {
    if (!schedule.branchId) return false;
    const scope = { branchId: schedule.branchId, clientId: schedule.clientId };
    const fetalConfirmation = schedule.client?.fetalConfirmation;
    if (fetalConfirmation === null || fetalConfirmation === "UNCONFIRMED") {
        const legacyCases = await tx.service_record_case.findMany({ where: scope, select: { id: true }, take: 2 });
        return legacyCases.length < 2;
    }
    if (fetalConfirmation !== "CONFIRMED") return false;

    const target = await resolveServiceRecordCaseTarget(tx, scope);
    if (target.kind !== "resolved" || target.babyCount !== 1) return false;

    const [baby] = target.babyId ? [{ id: target.babyId }] : await tx.client_baby.findMany({
        where: { ...scope, active: true },
        select: { id: true },
        take: 2,
    });
    if (!baby) return false;
    return await tx.service_record_baby_assignment.count({
        where: {
            ...scope,
            babyId: baby.id,
            scheduleId: schedule.id,
            employeeId: schedule.primaryEmployeeId,
            activeOwner: true,
        },
    }) === 1;
}
