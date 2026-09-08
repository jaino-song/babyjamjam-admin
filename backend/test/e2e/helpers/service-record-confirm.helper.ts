import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const SERVICE_RECORD_CONFIRM_DATABASE =
    "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4";

/** Require both explicit URLs before constructing any database client. */
export function assertApprovedServiceRecordConfirmDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): void {
    if (databaseUrl !== SERVICE_RECORD_CONFIRM_DATABASE || directUrl !== SERVICE_RECORD_CONFIRM_DATABASE) {
        throw new Error("Refusing service-record confirm E2E outside the exact disposable task-4 database");
    }
}

export function createApprovedServiceRecordConfirmClient(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): PrismaClient {
    assertApprovedServiceRecordConfirmDatabaseTarget(databaseUrl, directUrl);
    return new PrismaClient({ datasources: { db: { url: SERVICE_RECORD_CONFIRM_DATABASE } } });
}

// Independent acceptance oracle; do not calculate expected dates with production utilities.
export const ORIGINAL_THIRTEEN_DATES = [
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
    "2026-09-21", "2026-09-22", "2026-09-23",
];

export const SHIFTED_THIRTEEN_DATES = [
    "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
    "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22",
    "2026-09-23", "2026-09-28", "2026-09-29",
];

export function serviceRecordConfirmBarrier() {
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { release = resolve; });
    return { entered, release };
}

/**
 * Synthetic fixtures stay in the disposable database: confirmed revisions are
 * append-only, so cleanup must not disable their guards or delete their history.
 */
export async function createServiceRecordConfirmFixture(prisma: PrismaClient) {
    assertApprovedServiceRecordConfirmDatabaseTarget();
    const fixtureId = randomUUID();
    const branch = await prisma.branch.create({
        data: { name: `Confirm fixture ${fixtureId}`, slug: `confirm-${fixtureId}` },
    });
    const employee = await prisma.employee.create({
        data: {
            branchId: branch.id,
            name: "Task 4 Test Employee",
            phone: `010${randomInt(10000000, 99999999)}`,
            workArea: ["task4"],
            grade: "산모신생아 건강관리사",
        },
    });
    const client = await prisma.client.create({
        data: {
            branchId: branch.id,
            name: "Task 4 Test Client",
            voucherClient: true,
            duration: 15,
            fullPrice: "1500000",
            grant: "900000",
            actualPrice: "600000",
            startDate: new Date("2026-09-07T00:00:00.000Z"),
            endDate: new Date("2026-09-23T00:00:00.000Z"),
        },
    });
    const schedule = await prisma.employee_schedule.create({
        data: {
            branchId: branch.id,
            clientId: client.id,
            primaryEmployeeId: employee.id,
            workAddress: "Disposable task-4 fixture",
            startDate: client.startDate!,
            endDate: client.endDate!,
        },
    });
    const record = await prisma.service_record_case.create({
        data: {
            branchId: branch.id,
            clientId: client.id,
            startDate: client.startDate,
            endDate: client.endDate,
            requiredSessionCount: 13,
            status: "IN_PROGRESS",
            momName: client.name,
        },
    });
    const assignment = await prisma.service_record_assignment.create({
        data: {
            branchId: branch.id,
            serviceRecordCaseId: record.id,
            scheduleId: schedule.id,
            employeeId: employee.id,
            employeeNameSnapshot: employee.name,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
        },
    });
    const days = [];
    for (const [index, date] of ORIGINAL_THIRTEEN_DATES.slice(0, 3).entries()) {
        days.push(await prisma.service_record_day.create({
            data: {
                branchId: branch.id,
                serviceRecordCaseId: record.id,
                scheduleId: schedule.id,
                employeeId: employee.id,
                employeeNameSnapshot: employee.name,
                caseSessionIndex: index + 1,
                sessionIndex: index + 1,
                serviceDate: new Date(`${date}T00:00:00.000Z`),
                locked: true,
                submittedAt: new Date(`${date}T08:00:00.000Z`),
                clientSignedAt: new Date(`${date}T07:59:00.000Z`),
                clientSignature: `fixture-signature-${fixtureId}-${index}`,
                notes: `original-${index + 1}`,
            },
        }));
    }
    return { branch, employee, client, schedule, record, assignment, days, actorUserId: randomUUID() };
}
