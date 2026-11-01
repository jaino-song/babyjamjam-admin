import { BadRequestException } from "@nestjs/common";

import {
    assertNoActiveEmployeeScheduleOverlap,
} from "application/policies/employee-schedule-invariants.policy";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { UpdateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/update-employee-schedule.usecase";

import { createBranch, createClient, createEmployee, createEmployeeSchedule } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import {
    assertThrowawayTarget,
    closeIntegrityPrisma,
    createIntegrityPrisma,
    describeReal,
    type IntegrityPrisma,
} from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

/**
 * employee_schedule write integrity (SI-EMP-05..07).
 *
 * SI-EMP-05: the schema itself enforces nothing on `employee_schedule` — no
 * CHECK on the date range, `branch_id` is nullable. The spec documents that
 * acceptance directly against the real database and proves the policy is the
 * only thing standing between a writer and such a row. Verdict hinges on
 * whether any application writer can produce these rows: every writer
 * (client.service.ts create sites at ~1219/~2477/~3008, the eformsign mirror
 * link, and CreateEmployeeScheduleUsecase) funnels through
 * `assertNoActiveEmployeeScheduleOverlap` (which asserts the date range) and
 * stamps `branchId` explicitly.
 *
 * SI-EMP-06/07: the assignment-change usecase must run eligibility/overlap
 * checks on its production path. `UpdateEmployeeScheduleUsecase` skips them
 * only when both the caller's transaction AND the injected PrismaService are
 * absent (the legacy unit-caller seam); the application module always supplies
 * PrismaService, so `execute` opens its own `$transaction` and the checks run.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describeReal("employee_schedule write integrity (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let updateScheduleUsecase: UpdateEmployeeScheduleUsecase;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        updateScheduleUsecase = new UpdateEmployeeScheduleUsecase(
            new SbEmployeeScheduleRepository(handle.service),
            handle.service,
        );
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant("SI-EMP-05", "the schedule write policy rejects start_date > end_date before any insert", async () => {
        const branchRow = await createBranch(handle.raw, tracker);
        const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
        const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });

        await handle.service.$transaction(async (transaction) => {
            await expect(
                assertNoActiveEmployeeScheduleOverlap(transaction, {
                    branchId: branchRow.id,
                    clientId: clientRow.id,
                    primaryEmployeeId: employeeRow.id,
                    secondaryEmployeeId: null,
                    startDate: d("2026-11-10"),
                    endDate: d("2026-11-01"),
                    replaced: false,
                }),
            ).rejects.toThrow(BadRequestException);
        });

        const rows = await handle.raw.employee_schedule.findMany({
            where: { clientId: clientRow.id },
            select: { id: true },
        });
        expect(rows).toHaveLength(0);
    });

    invariant(
        "SI-EMP-05",
        "db evidence: the schema accepts start>end and NULL branch_id, and such rows are invisible to the overlap check",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
            const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });

            // No DB CHECK on the date range, branch_id nullable: a raw writer
            // can produce a row every application reader (branch-scoped lists,
            // overlap checks) filters out. This row documents the gap the
            // application policy currently prevents writers from reaching.
            const invalid = await handle.raw.employee_schedule.create({
                data: {
                    clientId: clientRow.id,
                    branchId: null,
                    primaryEmployeeId: employeeRow.id,
                    secondaryEmployeeId: null,
                    workAddress: "서울시 강남구 테헤란로 123",
                    startDate: d("2026-11-10"),
                    endDate: d("2026-11-01"),
                },
            });
            tracker.track("employee_schedule", invalid.id);
            expect(invalid.startDate.getTime()).toBeGreaterThan(invalid.endDate.getTime());
            expect(invalid.branchId).toBeNull();

            // The overlap policy is scoped by branchId, so the NULL-branch row
            // overlapping the checked range is invisible to it.
            await handle.service.$transaction(async (transaction) => {
                await expect(
                    assertNoActiveEmployeeScheduleOverlap(transaction, {
                        branchId: branchRow.id,
                        clientId: clientRow.id,
                        primaryEmployeeId: employeeRow.id,
                        secondaryEmployeeId: null,
                        startDate: d("2026-11-05"),
                        endDate: d("2026-11-08"),
                        replaced: false,
                    }),
                ).resolves.toBeUndefined();
            });
        },
    );

    invariant(
        "SI-EMP-06",
        "the production update path (no explicit transaction, PrismaService injected) runs eligibility checks",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
            const primaryRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
            const closedRow = await createEmployee(handle.raw, tracker, {
                branchId: branchRow.id,
                openToNextWork: false,
            });
            const scheduleRow = await createEmployeeSchedule(handle.raw, tracker, {
                clientId: clientRow.id,
                primaryEmployeeId: primaryRow.id,
            }, { branchId: branchRow.id });

            // execute() without a transaction opens its own $transaction in the
            // production wiring; the new secondary is closed to next work and
            // not retained, so eligibility must refuse the update.
            await expect(
                updateScheduleUsecase.execute(branchRow.id, scheduleRow.id, { secondaryEmployeeId: closedRow.id }),
            ).rejects.toThrow(BadRequestException);

            const persisted = await handle.raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } });
            expect(persisted?.secondaryEmployeeId).toBeNull();
        },
    );

    invariant(
        "SI-EMP-07",
        "an employee from another branch is rejected by the assignment-change update path",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const otherBranchRow = await createBranch(handle.raw, tracker);
            const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
            const primaryRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
            const foreignRow = await createEmployee(handle.raw, tracker, { branchId: otherBranchRow.id });
            const scheduleRow = await createEmployeeSchedule(handle.raw, tracker, {
                clientId: clientRow.id,
                primaryEmployeeId: primaryRow.id,
            }, { branchId: branchRow.id });

            await expect(
                updateScheduleUsecase.execute(branchRow.id, scheduleRow.id, { primaryEmployeeId: foreignRow.id }),
            ).rejects.toThrow(BadRequestException);

            const persisted = await handle.raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } });
            expect(persisted?.primaryEmployeeId).toBe(primaryRow.id);
        },
    );

    invariant(
        "SI-EMP-07",
        "a disabled employee cannot be newly assigned by the assignment-change update path",
        async () => {
            const branchRow = await createBranch(handle.raw, tracker);
            const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
            const openRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
            const disabledRow = await createEmployee(handle.raw, tracker, {
                branchId: branchRow.id,
                openToNextWork: false,
            });
            const scheduleRow = await createEmployeeSchedule(handle.raw, tracker, {
                clientId: clientRow.id,
                primaryEmployeeId: openRow.id,
            }, { branchId: branchRow.id });

            await expect(
                updateScheduleUsecase.execute(branchRow.id, scheduleRow.id, { primaryEmployeeId: disabledRow.id }),
            ).rejects.toThrow(BadRequestException);

            const persisted = await handle.raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } });
            expect(persisted?.primaryEmployeeId).toBe(openRow.id);
        },
    );
});
