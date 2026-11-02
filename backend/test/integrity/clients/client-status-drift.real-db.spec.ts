import { computeServiceStatus } from "domain/value-objects/service-status.vo";
import { SERVICE_STATUS, type ServiceStatusType } from "domain/value-objects/service-status.vo";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient, createEmployee, createEmployeeSchedule } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import {
    addDays,
    dbDate,
    isoDateInKorea,
    makeClientService,
    makeDueDateScheduler,
    makeScheduleChangeService,
} from "./test-helpers";

jest.setTimeout(120_000);

/**
 * SI-CLIENT-01 — stored `client.service_status` drifts from the service dates.
 *
 * Invariant: after ANY write that moves `start_date` / `end_date`, the stored
 * `service_status` equals `computeServiceStatus(start, end, bookingConfirmedAt)`
 * unless the status is manual (`terminated` / `replacement_requested`). Three
 * real writers are audited: the ordinary admin update
 * (`ClientService.update`), the hourly due-date scheduler
 * (`ClientDueDateSchedulerService`), and the admin session move
 * (`ScheduleChangeService.applyAdminChange`). The lazy background pass on the
 * next list read remains the safety net for time-based drift without a write.
 */
describeReal("SI-CLIENT-01 stored service_status drifts from dates after real writes", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let kstToday: string;

    const assertStoredMatchesComputed = (
        clientId: number,
        label: string,
    ): Promise<void> =>
        (async () => {
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: clientId },
                select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true },
            });
            const computed = computeServiceStatus(
                row.serviceStatus,
                row.startDate,
                row.endDate,
                row.bookingConfirmedAt,
            );
            if (row.serviceStatus !== computed) {
                throw new Error(
                    `SI-CLIENT-01 (${label}): stored serviceStatus "${row.serviceStatus}" drifted from computed "${computed}" after a date write`,
                );
            }
        })();

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        kstToday = isoDateInKorea(new Date());
        const branch = await createBranch(handle.raw, tracker);
        branchId = branch.id;
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    /** A confirmed in-period client whose stored status matches its dates ("active"). */
    const createConfirmedActiveClient = async (extra: { startDate: string; endDate: string }) => {
        const client = await createClient(handle.raw, tracker, {
            branchId,
            startDate: dbDate(extra.startDate),
            endDate: dbDate(extra.endDate),
            bookingConfirmedAt: new Date(),
            serviceStatus: SERVICE_STATUS.ACTIVE,
        });
        return client;
    };

    invariant(
        "SI-CLIENT-01",
        "an ordinary date edit via ClientService.update leaves the stored serviceStatus stale",
        async () => {
            const client = await createConfirmedActiveClient({
                startDate: addDays(kstToday, -20),
                endDate: addDays(kstToday, 10),
            });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            // The everyday save: dates change, no serviceStatus supplied.
            await service.update(branchId, client.id, {
                endDate: addDays(kstToday, -1),
            });
            await assertStoredMatchesComputed(client.id, "ClientService.update endDate edit");
        },
    );

    invariant(
        "SI-CLIENT-01",
        "the due-date scheduler's startDate copy leaves the stored serviceStatus stale",
        async () => {
            // Confirmed "waiting" client: no start date yet, dueDate due today,
            // end date three days out — after the copy the client is active.
            const client = await createClient(handle.raw, tracker, {
                branchId,
                dueDate: dbDate(kstToday),
                endDate: dbDate(addDays(kstToday, 3)),
                bookingConfirmedAt: new Date(),
                serviceStatus: SERVICE_STATUS.WAITING,
            });
            const scheduler = makeDueDateScheduler(handle.service);
            const copied = await scheduler.copyUpcomingDueDatesToStartDates();
            if (copied < 1) {
                throw new Error("SI-CLIENT-01 scheduler copy copied no rows — fixture window mismatch");
            }
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { startDate: true },
            });
            if (!row.startDate) {
                throw new Error("SI-CLIENT-01 scheduler copy did not write startDate — write path did not run");
            }
            await assertStoredMatchesComputed(client.id, "due-date scheduler startDate copy");
        },
    );

    invariant(
        "SI-CLIENT-01",
        "the transactional due-date scheduler stores the recomputed status with the date",
        async () => {
            const client = await createClient(handle.raw, tracker, {
                branchId,
                dueDate: dbDate(kstToday),
                endDate: dbDate(addDays(kstToday, 3)),
                bookingConfirmedAt: new Date(),
                serviceStatus: SERVICE_STATUS.WAITING,
            });
            const scheduler = makeDueDateScheduler(handle.service, "transactional");

            await scheduler.copyUpcomingDueDatesToStartDates();

            const row = await handle.raw.client.findUniqueOrThrow({ where: { id: client.id } });
            expect(row.startDate).toEqual(dbDate(kstToday));
            expect(row.serviceStatus).toBe(SERVICE_STATUS.ACTIVE);
            await assertStoredMatchesComputed(client.id, "transactional due-date scheduler");
        },
    );

    invariant(
        "SI-CLIENT-01",
        "an admin session move via ScheduleChangeService.applyAdminChange leaves the stored serviceStatus stale",
        async () => {
            const startDate = addDays(kstToday, -20);
            const client = await createConfirmedActiveClient({
                startDate,
                endDate: addDays(kstToday, 10),
            });
            await handle.raw.client.update({
                where: { id: client.id },
                data: { duration: 12 },
            });
            const employee = await createEmployee(handle.raw, tracker, { branchId });
            const schedule = await createEmployeeSchedule(handle.raw, tracker, {
                clientId: client.id,
                primaryEmployeeId: employee.id,
            }, {
                branchId,
                startDate: dbDate(startDate),
                endDate: dbDate(addDays(kstToday, 10)),
            });
            await handle.raw.service_record_case.create({
                data: { branchId, clientId: client.id, requiredSessionCount: 12 },
            });

            const changeService = makeScheduleChangeService(handle.service);
            // Move session 1 (the service start) 40 days out: the client's
            // start date moves with it, so the computed status becomes waiting.
            const result = await changeService.applyAdminChange(
                schedule.id,
                addDays(kstToday, 40),
                { branchId },
                { allowNonBusinessDay: true },
            );
            if (!result || !result.startDate) {
                throw new Error("SI-CLIENT-01 applyAdminChange did not move the client start date — write path did not run");
            }
            await assertStoredMatchesComputed(client.id, "ScheduleChangeService.applyAdminChange");
        },
    );

    invariant(
        "SI-CLIENT-01",
        "the lazy list-read repair exists: updateServiceStatusIfCurrent moves a stale automatic status",
        async () => {
            const client = await createConfirmedActiveClient({
                startDate: addDays(kstToday, -20),
                endDate: addDays(kstToday, -1),
            });
            // The row is stale ("active", dates say completed) exactly as the
            // drift leaves it; the background repair is a CAS on the expected
            // stored status.
            const repository = (makeClientService({ prisma: handle.service, raw: handle.raw }) as unknown as {
                clientRepository: { updateServiceStatusIfCurrent(
                    branchid: string,
                    id: number,
                    expected: string | null,
                    next: ServiceStatusType,
                ): Promise<"updated" | "stale">;
                };
            }).clientRepository;
            const result = await repository.updateServiceStatusIfCurrent(
                branchId,
                client.id,
                SERVICE_STATUS.ACTIVE,
                SERVICE_STATUS.COMPLETED,
            );
            if (result !== "updated") {
                throw new Error(`SI-CLIENT-01 lazy repair did not apply: updateServiceStatusIfCurrent returned "${result}"`);
            }
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { serviceStatus: true },
            });
            if (row.serviceStatus !== SERVICE_STATUS.COMPLETED) {
                throw new Error(`SI-CLIENT-01 lazy repair stored "${row.serviceStatus}"`);
            }
        },
    );

    for (const mode of ["transactional", "fallback"] as const) {
        invariant("SI-CLIENT-01", `${mode} scheduler preserves a manual status committed after the candidate read`, async () => {
            const client = await createClient(handle.raw, tracker, {
                branchId,
                dueDate: dbDate(kstToday),
                endDate: dbDate(addDays(kstToday, 3)),
                bookingConfirmedAt: new Date(),
                serviceStatus: SERVICE_STATUS.WAITING,
            });
            // Commit the competing manual transition after the real candidate
            // SELECT, before the scheduler's conditional UPDATE is dispatched.
            const candidateRead = jest.spyOn(handle.service.client, "findMany").mockImplementationOnce((args) => {
                const readThenCommit = (async () => {
                    const candidates = await handle.raw.client.findMany(args);
                    await handle.raw.client.update({
                        where: { id: client.id },
                        data: { serviceStatus: SERVICE_STATUS.TERMINATED },
                    });
                    return candidates;
                })();
                // The scheduler awaits this query directly, never passing the
                // double to Prisma's array-transaction API (which needs its brand).
                return readThenCommit as ReturnType<typeof handle.service.client.findMany>;
            });
            try {
                await makeDueDateScheduler(handle.service, mode).copyUpcomingDueDatesToStartDates();
            } finally {
                candidateRead.mockRestore();
            }

            const row = await handle.raw.client.findUniqueOrThrow({ where: { id: client.id } });
            expect(row.serviceStatus).toBe(SERVICE_STATUS.TERMINATED);
            expect(row.startDate).toBeNull();
        });
    }
});
