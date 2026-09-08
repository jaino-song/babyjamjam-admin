import { PrismaClient } from "@prisma/client";

import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
} from "./service-record-confirm.helper";

/**
 * The finalization proof uses a disposable synthetic provider fixture.  The
 * rows below represent stored evidence that a provider already submitted and
 * signed each session; this helper never invokes a signer, vendor, or worker.
 */
export async function createCompleteServiceRecordFinalizationFixture(
    prisma: PrismaClient,
): Promise<Awaited<ReturnType<typeof createServiceRecordConfirmFixture>> & {
    completeDays: Array<{ id: string; caseSessionIndex: number | null }>;
}> {
    assertApprovedServiceRecordConfirmDatabaseTarget();
    const fixture = await createServiceRecordConfirmFixture(prisma);

    const completeDays = await completeServiceRecordFinalizationCase(prisma, fixture);
    return { ...fixture, completeDays };
}

/**
 * Complete an existing partial fixture after an administrator revision was
 * persisted.  The delayed writes model later provider submissions and header
 * evidence in the disposable database; they do not perform any signer action.
 */
export async function completeServiceRecordFinalizationCase(
    prisma: PrismaClient,
    fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>,
): Promise<Array<{ id: string; caseSessionIndex: number | null }>> {
    assertApprovedServiceRecordConfirmDatabaseTarget();

    await prisma.service_record_case.update({
        where: { id: fixture.record.id },
        data: {
            momName: "Task 4 Test Client",
            momBirth: "900101",
            babyName: "Task 4 Baby",
            babyBirth: "260101",
            deliveryType: "single",
            babyWeight: "3.2kg",
            requiredSessionCount: ORIGINAL_THIRTEEN_DATES.length,
            status: "IN_PROGRESS",
        },
    });

    await prisma.service_record_day.updateMany({
        where: { serviceRecordCaseId: fixture.record.id },
        data: {
            locked: true,
            momApproval: "approved",
        },
    });

    for (const [index, date] of ORIGINAL_THIRTEEN_DATES.slice(fixture.days.length).entries()) {
        const sessionIndex = fixture.days.length + index + 1;
        await prisma.service_record_day.create({
            data: {
                branchId: fixture.branch.id,
                serviceRecordCaseId: fixture.record.id,
                scheduleId: fixture.schedule.id,
                employeeId: fixture.employee.id,
                employeeNameSnapshot: fixture.employee.name,
                caseSessionIndex: sessionIndex,
                sessionIndex,
                serviceDate: new Date(`${date}T00:00:00.000Z`),
                answers: {},
                locked: true,
                momApproval: "approved",
                submittedAt: new Date(`${date}T08:00:00.000Z`),
                clientSignedAt: new Date(`${date}T07:59:00.000Z`),
                clientSignature: `fixture-finalization-signature-${sessionIndex}`,
                notes: `complete-${sessionIndex}`,
            },
        });
    }

    const completeDays = await prisma.service_record_day.findMany({
        where: { serviceRecordCaseId: fixture.record.id },
        select: { id: true, caseSessionIndex: true },
        orderBy: { caseSessionIndex: "asc" },
    });
    return completeDays;
}
