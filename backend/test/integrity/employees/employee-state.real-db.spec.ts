import { NotFoundException } from "@nestjs/common";

import { ChangeEmployeeOpenStatusUsecase } from "application/usecases/employee/change-employee-open-status.usecase";
import { DeleteEmployeeUsecase } from "application/usecases/employee/delete-employee.usecase";
import { FindEmployeeByIdUsecase } from "application/usecases/employee/find-employee-by-id.usecase";
import { UpdateEmployeeUsecase } from "application/usecases/employee/update-employee.usecase";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";
import { isoDateInKorea } from "domain/utils/business-days";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";

import { createBranch, createClient, createEmployee } from "../helpers/factories";
import { invariant, knownDefect } from "../helpers/known-defect";
import {
    assertThrowawayTarget,
    closeIntegrityPrisma,
    createIntegrityPrisma,
    describeReal,
    type IntegrityPrisma,
} from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

/**
 * Employee-state integrity against real PostgreSQL (SI-EMP-01..03):
 *
 * - SI-EMP-01: the delete guard (`hasActiveAssignments`) must judge by the KST
 *   business date, exactly like `findWorkHistoryByEmployee` does with
 *   `isoDateInKorea()`. It computes process-local midnight instead, whose UTC
 *   date in an Asia/Seoul process is one day behind the business calendar.
 * - SI-EMP-02: a soft-deleted employee is NotFound (404-class domain error) and
 *   invisible to GET by id. `findById` does not filter `deletedAt`, so the
 *   PATCH / open-status usecases pass their guard and then explode inside
 *   `repository.update` with a bare `Error("Employee not found for branch")`.
 * - SI-EMP-03: a target-version update that includes `smsAutomationEnabled`
 *   must persist it (the ordinary update path does); the approved path's
 *   repository contract drops the flag silently.
 *
 * Timezone mechanism (SI-EMP-01), established by this spec:
 *
 * - `employee_schedule.endDate` is a PostgreSQL DATE (Prisma reads/writes it as
 *   a UTC-midnight instant). The guard compares it against `new Date().setHours(0,0,0,0)`
 *   — midnight at the PROCESS timezone. Postgres truncates that timestamptz
 *   back to a DATE (UTC session), so the effective boundary date is the UTC
 *   calendar date of local midnight, NOT the KST business date: in an
 *   Asia/Seoul process local midnight is `…T15:00Z` of the PREVIOUS UTC date,
 *   so the guard is off by one (a schedule that ended KST-yesterday still
 *   counts as active, blocking delete) at EVERY hour; the same truncation makes
 *   a UTC process correct whenever the local UTC date equals the KST date.
 * - One knownDefect reproduces that previous-UTC-date boundary for a UTC+5
 *   process with a scoped `Date.prototype.setHours` patch. It derives the
 *   pinned midnight from the KST business date rather than the ambient process
 *   timezone, exercises the real repository/delete guard, and restores the
 *   method in `finally`. No ambient-timezone precondition is required.
 */

/** `YYYY-MM-DD` shifted by whole days, keeping UTC midnight anchoring. */
function shiftIsoDate(iso: string, days: number): string {
    const date = new Date(`${iso}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

describeReal("employee state integrity (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let repository: SbEmployeeRepository;
    let findEmployeeByIdUsecase: FindEmployeeByIdUsecase;
    let updateEmployeeUsecase: UpdateEmployeeUsecase;
    let changeEmployeeOpenStatusUsecase: ChangeEmployeeOpenStatusUsecase;
    let deleteEmployeeUsecase: DeleteEmployeeUsecase;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        repository = new SbEmployeeRepository(handle.service);
        findEmployeeByIdUsecase = new FindEmployeeByIdUsecase(repository);
        updateEmployeeUsecase = new UpdateEmployeeUsecase(repository);
        changeEmployeeOpenStatusUsecase = new ChangeEmployeeOpenStatusUsecase(repository);
        deleteEmployeeUsecase = new DeleteEmployeeUsecase(repository);
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    knownDefect(
        "SI-EMP-01",
        "delete guard judges by the KST business date (assignment ended before KST today is inactive in a UTC+5 process)",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
            const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });

            // The correct comparison (`findWorkHistoryByEmployee`) anchors on the
            // KST calendar date: `isoDateInKorea()` is the business date TODAY,
            // regardless of the process timezone. A schedule that ended
            // yesterday (KST terms) must therefore be inactive.
            //
            // The defect anchors on process-local midnight: the boundary it
            // passes to Prisma (`setHours(0,0,0,0)`) truncates to the UTC
            // calendar DATE of local midnight, and a UTC+5 (or Asia/Seoul)
            // process yields the DATE of KST-yesterday — one whole business
            // day behind the KST boundary `findWorkHistoryByEmployee` uses
            // (`isoDateInKorea()`). Jest workers only see the timezone the
            // process STARTED with (a runtime `process.env.TZ` switch never
            // re-resolves `new Date()` local methods there), so instead of
            // shell-pinning TZ the test simulates a UTC+5 process for exactly
            // one operation: a scoped `Date.prototype.setHours` patch that
            // turns local-midnight into the UTC+5 midnight instant, restoring
            // the original method afterwards. Simulating the alternative
            // timezone on the clock is the same observable the production
            // process would expose; the query and repository under test stay
            // fully real.
            const kstToday = isoDateInKorea();
            const kstYesterday = shiftIsoDate(kstToday, -1);
            const simulatedUtcPlusFiveMidnight = new Date(`${kstToday}T00:00:00.000+05:00`).getTime();
            const originalSetHours = Date.prototype.setHours;
            Date.prototype.setHours = function simulatedTzSetHours(): number {
                this.setTime(simulatedUtcPlusFiveMidnight);
                return simulatedUtcPlusFiveMidnight;
            };
            try {
                // Simulation sanity: local midnight is now the UTC+5 midnight.
                expect(new Date().setHours(0, 0, 0, 0)).toBe(simulatedUtcPlusFiveMidnight);
                const scheduleRow = await handle.raw.employee_schedule.create({
                    data: {
                        clientId: clientRow.id,
                        branchId: branchRow.id,
                        primaryEmployeeId: employeeRow.id,
                        secondaryEmployeeId: null,
                        workAddress: "서울시 강남구 테헤란로 123",
                        startDate: new Date(`${shiftIsoDate(kstYesterday, -7)}T00:00:00.000Z`),
                        endDate: new Date(`${kstYesterday}T00:00:00.000Z`),
                    },
                });
                tracker.track("employee_schedule", scheduleRow.id);

                const isActive = await repository.hasActiveAssignments(branchRow.id, employeeRow.id);
                expect(isActive).toBe(false);

                // The delete-guard decision consumes the same predicate: an
                // employee whose assignment ended before the KST business date
                // must be deletable.
                await deleteEmployeeUsecase.execute(branchRow.id, employeeRow.id);
            } finally {
                Date.prototype.setHours = originalSetHours;
            }
        },
        /Received: true/,
    );

    describe("SI-EMP-02 soft-deleted employee visibility", () => {
        let branchId: string;
        let deletedEmployeeId: number;

        beforeAll(async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
            branchId = branchRow.id;
            deletedEmployeeId = employeeRow.id;
            await repository.delete(branchId, deletedEmployeeId);
        });

        knownDefect(
            "SI-EMP-02",
            "GET by id does not return a soft-deleted employee",
            async () => {
                const employee = await findEmployeeByIdUsecase.execute(branchId, deletedEmployeeId);
                const returnedDeletedRow = employee !== null && employee.deletedAt !== undefined;
                expect(returnedDeletedRow).toBe(false);
            },
            /Received: true/,
        );

        knownDefect(
            "SI-EMP-02",
            "PATCH employee on a soft-deleted employee is a 404-class domain error, not a bare 500",
            async () => {
                await expect(
                    updateEmployeeUsecase.execute(branchId, deletedEmployeeId, { name: "삭제된 관리사" }),
                ).rejects.toThrow(NotFoundException);
            },
            /Employee not found for branch/,
        );

        knownDefect(
            "SI-EMP-02",
            "open-status change on a soft-deleted employee is a 404-class domain error, not a bare 500",
            async () => {
                await expect(
                    changeEmployeeOpenStatusUsecase.execute(branchId, deletedEmployeeId, false),
                ).rejects.toThrow(NotFoundException);
            },
            /Employee not found for branch/,
        );
    });

    invariant("SI-EMP-03", "ordinary update persists smsAutomationEnabled and restores it on the approval path", async () => {
        const branchRow = await createBranch(handle.raw, tracker);
        const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });

        // The ordinary (non-approved) update path honors the flag.
        const updated = await updateEmployeeUsecase.execute(branchRow.id, employeeRow.id, {
            smsAutomationEnabled: false,
        });
        expect(updated.smsAutomationEnabled).toBe(false);

        // An approved update that keeps the flag omitted must retain it.
        const current = await repository.findById(branchRow.id, employeeRow.id);
        const targetVersion = employeeAgentTargetVersion(current);
        const approved = await updateEmployeeUsecase.executeApprovedTarget(
            branchRow.id,
            employeeRow.id,
            { name: "대상버전 유지" },
            targetVersion,
        );
        expect(approved.smsAutomationEnabled).toBe(false);
    });

    knownDefect(
        "SI-EMP-03",
        "approved target-version update persists smsAutomationEnabled instead of silently dropping it",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });

            const current = await repository.findById(branchRow.id, employeeRow.id);
            expect(current).not.toBeNull();
            const targetVersion = employeeAgentTargetVersion(current);

            const approved = await updateEmployeeUsecase.executeApprovedTarget(
                branchRow.id,
                employeeRow.id,
                { name: "대상버전 이름", smsAutomationEnabled: false },
                targetVersion,
            );
            // The name change goes through, so the failure below is the flag
            // drop, not a broken approval path.
            expect(approved.name).toBe("대상버전 이름");
            expect(approved.smsAutomationEnabled).toBe(false);

            const persisted = await handle.raw.employee.findUnique({ where: { id: employeeRow.id } });
            expect(persisted?.smsAutomationEnabled).toBe(false);
        },
        /Received: true/,
    );
});
