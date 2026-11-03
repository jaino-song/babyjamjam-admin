import type { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { Request, Response } from "express";
import { mapHttpProblem, sendProblemResponse } from "infrastructure/filters/problem-response";
import { CreateEmployeeDto } from "interface/dto/employee.dto";
import { EmployeeService } from "application/services/employee.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { ChangeEmployeeOpenStatusUsecase } from "application/usecases/employee/change-employee-open-status.usecase";
import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
import { EmployeeWriteAgentCapabilitiesProvider } from "application/usecases/employee/employee-write-agent-capabilities.provider";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { DeleteEmployeeUsecase } from "application/usecases/employee/delete-employee.usecase";
import { FindEmployeeByIdUsecase } from "application/usecases/employee/find-employee-by-id.usecase";
import {
    ListActiveClientsByEmployeeUsecase,
} from "application/usecases/employee/list-active-clients-by-employee.usecase";
import {
    ListEmployeesByGradeUsecase,
} from "application/usecases/employee/list-employees-by-grade.usecase";
import {
    ListEmployeesByOpenStatusUsecase,
} from "application/usecases/employee/list-employees-by-open-status.usecase";
import {
    ListEmployeesByRegisteredDateRangeUsecase,
} from "application/usecases/employee/list-employees-by-registered-date-range.usecase";
import {
    ListEmployeesByRegisteredDateUsecase,
} from "application/usecases/employee/list-employees-by-registered-date.usecase";
import {
    ListEmployeesByWorkAreaUsecase,
} from "application/usecases/employee/list-employees-by-work-area.usecase";
import {
    ListEmployeesOpenToNextWorkUsecase,
} from "application/usecases/employee/list-employees-open-to-next-work.usecase";
import { ListEmployeesUsecase } from "application/usecases/employee/list-employees.usecase";
import {
    ListWorkHistoryByEmployeeUsecase,
} from "application/usecases/employee/list-work-history-by-employee.usecase";
import { UpdateEmployeeUsecase } from "application/usecases/employee/update-employee.usecase";
import { DEFAULT_EMPLOYEE_GRADE } from "domain/constants/employee-grade.constants";
import { MessageTriggerTemplateKey, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerEventType } from "domain/constants/message-trigger-catalog";
import { isoDateInKorea } from "domain/utils/business-days";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import type { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { EmployeeController } from "interface/controllers/employee.controller";

import {
    createBranch,
    createClient,
    createEmployee,
    createEmployeeSchedule,
    createMessageTriggerRule,
} from "../helpers/factories";
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
 * Employee-state ↔ pending automated-SMS-job integrity (SI-EMP-04, SI-EMP-09).
 *
 * The pending `message_trigger_job` rows are materialized through the REAL
 * `MessageTriggerService.syncEmployeeAssignmentRulesForSchedule` over the real
 * database — real branch sender-approval gate (the tracked branch row is
 * approved), real activation service (no system_setting row → dispatch
 * enabled), real branch advisory lock, real rule/job repositories. The only
 * stubs are the agent-consent seal (`AgentAutomationDeliveryGateService`) —
 * whose "legacy" behavior in production is exactly a no-op bind — and the
 * delivery/template collaborators that the materialization path never calls.
 *
 * The defect under test lives on the employee side: `EmployeeService` resyncs
 * assignment jobs only when a name or phone changed (employee.service.ts
 * `profileSupplied`), and `delete` never resyncs. So a pending assignment SMS
 * addressed to a deleted employee survives the change (SI-EMP-04, delete
 * half). The resync itself has the same hole (SI-EMP-09): the recipe builder
 * reads only the employee row's phone, so re-running it after deletion
 * re-creates the job.
 *
 * The SMS-disabled and openToNextWork halves of the original hypothesis were
 * re-verdicted: the pending job for the CURRENT assignment is kept when the
 * flag flips (`openToNextWork` is new-assignment eligibility only; the send-
 * time gate deliberately ignores it, and re-enabling `smsAutomationEnabled`
 * resumes the pending row). Delivery is owned by the single send-time gate —
 * `SmsAutomationSafeguardService.check` cancels a pending job addressed to a
 * deleted or sms-disabled employee during `dispatchPendingJobNow` BEFORE any
 * provider call, which the dispatch invariant below proves with a recording
 * vendor-stub delivery service.
 */

/** Stub for the agent-consent seal: binds nothing, cancels nothing (legacy behavior). */
const legacyDeliveryGate = { bindMaterialization: async (): Promise<void> => undefined };

/** Audit writer stub; the materialization path only reads activation state. */
const auditWriterStub: AdminAuditEventWriter = {
    append: async (): Promise<unknown> => undefined,
} as unknown as AdminAuditEventWriter;

/** `YYYY-MM-DD` shifted by whole days, keeping UTC-midnight anchoring (DATE columns). */
function shiftIsoDate(iso: string, days: number): string {
    const date = new Date(`${iso}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** Clock-relative schedule fixtures anchored on the KST business calendar, not hard-coded dates. */
function kstShiftedIsoDate(days: number): string {
    return shiftIsoDate(isoDateInKorea(), days);
}

/** A vendor-stub delivery service that RECORDS provider sends instead of sending. */
function buildVendorDeliveryStub(sentJobs: string[]): MessageTriggerDeliveryService {
    return {
        sendJob: async (job: { id: string }): Promise<boolean> => {
            sentJobs.push(job.id);
            return true;
        },
    } as unknown as MessageTriggerDeliveryService;
}

/**
 * A second trigger service for the DISPATCH probe: same real collaborators as
 * `buildTriggerService` plus a real `SmsAutomationSafeguardService` (the send-
 * time gate under test), a real message-log repository, and a recording
 * vendor-stub delivery service so a provider send is observable, never real.
 */
function buildDispatchingTriggerService(handle: IntegrityPrisma): {
    service: MessageTriggerService;
    sentJobs: string[];
} {
    const branchLock = new MessageAutomationBranchLockService(handle.service);
    const activation = new MessageAutomationActivationService(handle.service, branchLock, auditWriterStub);
    const sentJobs: string[] = [];
    const service = new MessageTriggerService(
        handle.service,
        buildVendorDeliveryStub(sentJobs),
        new MessageSenderApprovalService(handle.service),
        new SbMessageTriggerRuleRepository(handle.service),
        new SbMessageTriggerJobRepository(handle.service),
        new SbMessageLogRepository(handle.service),
        undefined as unknown as never,
        undefined as unknown as never,
        undefined,
        undefined,
        activation,
        branchLock,
        undefined,
        legacyDeliveryGate as unknown as never,
        undefined,
        new SmsAutomationSafeguardService(handle.service, activation),
    );
    return { service, sentJobs };
}

function buildEmployeeService(handle: IntegrityPrisma, triggerService: MessageTriggerService): EmployeeService {
    const repository = new SbEmployeeRepository(handle.service);
    return new EmployeeService(
        new CreateEmployeeUsecase(repository),
        new FindEmployeeByIdUsecase(repository),
        new ListActiveClientsByEmployeeUsecase(repository),
        new ListWorkHistoryByEmployeeUsecase(repository),
        new UpdateEmployeeUsecase(repository),
        new DeleteEmployeeUsecase(repository),
        new ListEmployeesUsecase(repository),
        new ListEmployeesByWorkAreaUsecase(repository),
        new ListEmployeesByGradeUsecase(repository),
        new ListEmployeesByOpenStatusUsecase(repository),
        new ListEmployeesByRegisteredDateUsecase(repository),
        new ListEmployeesByRegisteredDateRangeUsecase(repository),
        new ChangeEmployeeOpenStatusUsecase(repository),
        new ListEmployeesOpenToNextWorkUsecase(repository),
        repository,
        triggerService,
        undefined,
    );
}

function buildTriggerService(handle: IntegrityPrisma): MessageTriggerService {
    const branchLock = new MessageAutomationBranchLockService(handle.service);
    const activation = new MessageAutomationActivationService(handle.service, branchLock, auditWriterStub);
    return new MessageTriggerService(
        handle.service,
        // deliveryService, messageLogRepository, systemTemplateService and the
        // template automation lock are dispatch/template concerns the job
        // materialization path never touches.
        undefined as unknown as never,
        new MessageSenderApprovalService(handle.service),
        new SbMessageTriggerRuleRepository(handle.service),
        new SbMessageTriggerJobRepository(handle.service),
        undefined as unknown as never,
        undefined as unknown as never,
        undefined as unknown as never,
        undefined,
        undefined,
        activation,
        branchLock,
        undefined,
        legacyDeliveryGate as unknown as never,
        undefined,
        undefined,
    );
}

describeReal("employee state vs pending assignment SMS jobs (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let triggerService: MessageTriggerService;
    let employeeService: EmployeeService;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        triggerService = buildTriggerService(handle);
        employeeService = buildEmployeeService(handle, triggerService);
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    /** A branch approved for sending plus one active assignment of employee→client with its EMPLOYEE_ASSIGNED rule. */
    async function createAssignmentFixture(options: {
        scheduleStartIso: string;
        scheduleEndIso: string;
    }): Promise<{ branchId: string; employeeId: number; scheduleId: number; ruleId: string }> {
        const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
        const branchRow = await createBranch(handle.raw, tracker, { smsSenderApprovalStatus: "approved" });
        const clientRow = await createClient(handle.raw, tracker, { branchId: branchRow.id });
        const employeeRow = await createEmployee(handle.raw, tracker, { branchId: branchRow.id });
        const ruleRow = await createMessageTriggerRule(handle.raw, tracker, {
            branchId: branchRow.id,
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            isActive: true,
        });
        const scheduleRow = await createEmployeeSchedule(handle.raw, tracker, {
            clientId: clientRow.id,
            primaryEmployeeId: employeeRow.id,
        }, {
            branchId: branchRow.id,
            startDate: d(options.scheduleStartIso),
            endDate: d(options.scheduleEndIso),
        });
        return { branchId: branchRow.id, employeeId: employeeRow.id, scheduleId: scheduleRow.id, ruleId: ruleRow.id };
    }

    async function pendingAssignmentJob(scheduleId: number, ruleId: string): Promise<{ id: string; status: string } | null> {
        return handle.raw.message_trigger_job.findFirst({
            where: { employeeScheduleId: scheduleId, ruleId },
            orderBy: { id: "desc" },
            select: { id: true, status: true },
        });
    }

    /**
     * Throws with a defect-specific message while a pending job survives.
     * The `expectedFailure` matchers below key on exactly these messages; an
     * infra/fixture failure produces a different one and turns the knownDefect
     * RED instead of a green false-CONFIRMED.
     */
    function throwIfPending(pending: { id: string; status: string } | null, defectMessage: string): void {
        if (pending !== null && pending.status === "pending") throw new Error(defectMessage);
    }

    invariant(
        "SI-EMP-04",
        "deleting an employee cancels or resyncs pending assignment SMS jobs addressed to that employee",
        async () => {
            // An already-ended (but not replaced/terminated) assignment: the
            // delete guard allows deletion, the pending job stays behind.
            // Clock-relative so the suite does not age past hard-coded dates.
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(-40),
                scheduleEndIso: kstShiftedIsoDate(-10),
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const materialized = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(materialized?.status).toBe("pending");

            await employeeService.delete(fixture.branchId, fixture.employeeId);

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            throwIfPending(
                pending,
                "SI-EMP-04 defect: the pending assignment SMS job addressed to the deleted employee was not canceled or resynced by the delete path",
            );
        },
    );

    invariant(
        "SI-EMP-04",
        "dispatching a deleted employee's pending assignment SMS is blocked by the send-time gate",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(-40),
                scheduleEndIso: kstShiftedIsoDate(-10),
            });
            expect(await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId, fixture.scheduleId, true,
            )).toBe(true);
            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(pending?.status).toBe("pending");
            if (!pending) throw new Error("assignment fixture did not materialize a job");

            // Simulate a stale pending job independently of the service's delete-time resync.
            await new SbEmployeeRepository(handle.service).delete(fixture.branchId, fixture.employeeId);
            expect(await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId)).toEqual(pending);
            const { service: dispatchTrigger, sentJobs } = buildDispatchingTriggerService(handle);
            const dispatched = await dispatchTrigger.dispatchPendingJobNow(pending.id, {
                expectedBranchId: fixture.branchId,
            });

            expect(sentJobs).toEqual([]);
            expect(dispatched.status).toBe("canceled");
            expect(dispatched.cancelReason).toBe("sms_automation_safeguard:recipient");
        },
    );

    invariant(
        "SI-EMP-04",
        "disabling an employee's SMS automation keeps the pending assignment SMS job for the current assignment it is waiting on",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(30),
                scheduleEndIso: kstShiftedIsoDate(60),
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const materialized = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(materialized?.status).toBe("pending");

            // `profileSupplied` is false for a flag-only change, so the
            // materialization is not resynced; the SAME pending row survives
            // and the send-time gate (see the dispatch invariant below) owns
            // delivery. Re-enabling the flag then resumes the same row.
            await employeeService.update(fixture.branchId, fixture.employeeId, { smsAutomationEnabled: false });

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(pending?.id).toBe(materialized?.id);
            expect(pending?.status).toBe("pending");
        },
    );

    invariant(
        "SI-EMP-04",
        "dispatching the pending assignment SMS job of an SMS-disabled employee never reaches the provider (the safeguard is the single send-time gate)",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(30),
                scheduleEndIso: kstShiftedIsoDate(60),
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            let pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(pending?.status).toBe("pending");

            // The flag flip leaves the stale row pending (kept-invariant
            // above); at dispatch time the guard must still refuse it.
            await employeeService.update(fixture.branchId, fixture.employeeId, { smsAutomationEnabled: false });
            pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(pending?.status).toBe("pending");

            // Drive the REAL dispatch path (production entrypoint used by the
            // agent provider and admin resend) with the vendor-stub delivery
            // service recording every provider send.
            const { service: dispatchTrigger, sentJobs } = buildDispatchingTriggerService(handle);
            const dispatched = await dispatchTrigger.dispatchPendingJobNow(pending!.id, {
                expectedBranchId: fixture.branchId,
            });

            expect(sentJobs).toEqual([]);
            expect(dispatched.status).toBe("canceled");
            expect(dispatched.cancelReason).toBe("sms_automation_safeguard:recipient");
        },
    );

    invariant(
        "SI-EMP-04",
        "closing an employee to next work keeps the pending assignment SMS job for the current assignment it is waiting on",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(30),
                scheduleEndIso: kstShiftedIsoDate(60),
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const materialized = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(materialized?.status).toBe("pending");

            // `openToNextWork` is new-assignment eligibility only
            // (employee-assignment-eligibility.policy.ts keeps existing
            // assignees) and the send-time gate deliberately ignores it, so
            // closing an employee must not cancel the pending job of the
            // assignment it is currently waiting on. The SAME pending row
            // must survive (not be canceled and re-created).
            await employeeService.changeOpenStatus(fixture.branchId, fixture.employeeId, false);

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(pending?.id).toBe(materialized?.id);
            expect(pending?.status).toBe("pending");
        },
    );

    invariant(
        "SI-EMP-09",
        "assignment resync does not re-arm a pending SMS job for a soft-deleted employee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(30),
                scheduleEndIso: kstShiftedIsoDate(60),
            });
            // Soft-delete first, then run the real resync the profile-change
            // path would run: the recipe builder must not address a job to a
            // deleted employee.
            await new SbEmployeeRepository(handle.service).delete(fixture.branchId, fixture.employeeId);

            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            throwIfPending(
                pending,
                "SI-EMP-09 defect: the assignment resync re-armed a pending SMS job addressed to the soft-deleted employee",
            );
        },
    );

    invariant(
        "SI-EMP-10",
        "re-adding a deleted employee's phone restores the same employee id and returns restored=true",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const params = {
                name: "전화번호 재등록 검사", workArea: [], phone: "01012345678",
                grade: DEFAULT_EMPLOYEE_GRADE, openToNextWork: true,
            };
            const controller = new EmployeeController(employeeService);
            const original = await controller.create({ branchId: branch.id }, params);
            tracker.track("employee", original.id);
            expect(original).toMatchObject({ restored: false });
            const client = await createClient(handle.raw, tracker, { branchId: branch.id });
            const history = await createEmployeeSchedule(handle.raw, tracker, {
                clientId: client.id, primaryEmployeeId: original.id,
            }, {
                branchId: branch.id,
                startDate: new Date(`${kstShiftedIsoDate(-40)}T00:00:00.000Z`),
                endDate: new Date(`${kstShiftedIsoDate(-10)}T00:00:00.000Z`),
            });
            await employeeService.delete(branch.id, original.id);
            expect(await employeeService.checkPhoneExists(branch.id, params.phone)).toBe(false);

            const restored = await controller.create({ branchId: branch.id }, {
                ...params, name: params.name, workArea: ["서울"], grade: "프리미엄", openToNextWork: false,
                birthday: "1990-01-02", registeredDate: "2024-01-15", smsAutomationEnabled: false,
            });
            expect(restored).toMatchObject({
                id: original.id, restored: true, name: params.name, workArea: ["서울"], grade: "프리미엄",
                openToNextWork: false, birthday: "1990-01-02", registeredDate: new Date("2024-01-15T00:00:00.000Z"), smsAutomationEnabled: false,
            });
            expect(await handle.raw.employee.findUnique({ where: { id: original.id } })).toMatchObject({ deletedAt: null });
            expect(await handle.raw.employee_schedule.findUnique({ where: { id: history.id } })).toEqual(history);
            expect(await employeeService.checkPhoneExists(branch.id, params.phone)).toBe(true);
        },
    );

    invariant("SI-EMP-10", "restoring keeps omitted history fields instead of applying create defaults", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const registeredDate = "2015-02-03";
        const original = await employeeService.create(branch.id, {
            name: "과거 등록 관리사", phone: "01012345678", workArea: ["부산"],
            grade: "프리미엄", openToNextWork: true, birthday: "1980-01-02",
            registeredDate, smsAutomationEnabled: false,
        });
        tracker.track("employee", original.id);
        await employeeService.delete(branch.id, original.id);

        const restored = await new EmployeeController(employeeService).create({ branchId: branch.id }, {
            name: "과거 등록 관리사", phone: "010-1234-5678",
        });
        expect(restored).toMatchObject({
            id: original.id, restored: true, name: "과거 등록 관리사", phone: "010-1234-5678",
            workArea: ["부산"], grade: "프리미엄", openToNextWork: true, birthday: "1980-01-02",
            registeredDate: new Date(`${registeredDate}T00:00:00.000Z`), smsAutomationEnabled: false,
        });
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
            deletedAt: null, companyRegisteredDate: new Date(`${registeredDate}T00:00:00.000Z`),
            smsAutomationEnabled: false, birthday: "1980-01-02",
        });
    });

    for (const [firstOption, secondOption] of [
        [undefined, undefined], ["register_new", "restore"], ["restore", "register_new"],
    ] as const) {
        const mixedOptions = firstOption !== undefined;
        invariant("SI-EMP-10", mixedOptions
            ? `${firstOption} first racing ${secondOption} second has exactly one winner under the row lock`
            : "two creates racing for a deleted phone restore exactly once under the row lock", async () => {
            const branch = await createBranch(handle.raw, tracker);
            const params = { name: "경합 복원", workArea: ["서울"], phone: "01012345678", grade: DEFAULT_EMPLOYEE_GRADE, openToNextWork: true };
            const original = await employeeService.create(branch.id, params);
            tracker.track("employee", original.id);
            await employeeService.delete(branch.id, original.id);

            let unlock: () => void = () => undefined;
            let signalLocked: () => void = () => undefined;
            const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
            const holder = handle.raw.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM employee WHERE id = ${original.id} FOR UPDATE`;
                signalLocked();
                await new Promise<void>((resolve) => { unlock = resolve; });
            }, { timeout: 15_000 });
            await locked;
            async function waitForContenders(count: number): Promise<void> {
                const deadline = Date.now() + 4_000;
                for (;;) {
                    const waiting = await handle.raw.$queryRaw<Array<{ pid: number }>>`
                        SELECT pid FROM pg_stat_activity
                        WHERE datname = current_database() AND pid <> pg_backend_pid()
                          AND wait_event_type = 'Lock' AND query LIKE '%phone_normalized%'
                          AND query LIKE '%FOR UPDATE%'
                    `;
                    if (waiting.length === count) break;
                    if (Date.now() > deadline) throw new Error(`${count} restore contenders must be observed waiting on the database row lock`);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            }
            // Observe the first waiter before launching the second so both lock orders are covered.
            const contenders = [Promise.allSettled([
                employeeService.create(branch.id, { ...params, onDeletedPhoneMatch: firstOption }),
            ])];
            try {
                await waitForContenders(1);
                contenders.push(Promise.allSettled([
                    employeeService.create(branch.id, { ...params, onDeletedPhoneMatch: secondOption }),
                ]));
                await waitForContenders(2);
            } finally {
                unlock();
                await holder;
                for (const outcome of (await Promise.all(contenders)).flat()) if (outcome.status === "fulfilled") tracker.track("employee", outcome.value.id);
            }
            const outcomes = (await Promise.all(contenders)).flat();
            const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
            const losers = outcomes.filter((outcome) => outcome.status === "rejected");
            expect(winners).toHaveLength(1);
            expect(losers).toHaveLength(1);
            const winner = winners[0]?.value;
            expect(winner).toBeDefined();
            if (!mixedOptions || winner?.restored) expect(winner).toMatchObject({ id: original.id, restored: true });
            else expect(winner?.id).not.toBe(original.id);
            expect(losers[0]?.reason).toMatchObject({ status: 409, response: { code: "EMPLOYEE_PHONE_ALREADY_REGISTERED" } });
            const persisted = await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } });
            if (winner?.restored) expect(persisted).toMatchObject({ name: winner.name, deletedAt: null });
            else expect(persisted).toMatchObject({ phoneNormalized: null, deletedAt: expect.any(Date) });
        });
    }

    invariant("SI-EMP-10", "normalized same names (NFC, whitespace, case) restore the same id", async () => {
        for (const [stored, submitted] of [[" Alice  Kim ", "alice\tKIM"], ["가 관리사", "  가\n관리사 "]] as const) {
            const branch = await createBranch(handle.raw, tracker);
            const original = await employeeService.create(branch.id, { name: stored, phone: "01012345678" });
            tracker.track("employee", original.id);
            await employeeService.delete(branch.id, original.id);
            expect(await employeeService.create(branch.id, { name: submitted, phone: "010-1234-5678" }))
                .toMatchObject({ id: original.id, restored: true, name: submitted });
        }
    });

    invariant("SI-EMP-10", "controller conflict body is catalog-backed; explicit restore applies the different name", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const controller = new EmployeeController(employeeService);
        const original = await controller.create({ branchId: branch.id }, { name: "이전 사람", phone: "01012345678" });
        tracker.track("employee", original.id);
        await employeeService.delete(branch.id, original.id);
        const before = await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } });
        const payload = { name: "다른 사람", phone: "010-1234-5678" };
        let refusal: unknown;
        try { await controller.create({ branchId: branch.id }, payload); } catch (error) { refusal = error; }
        expect(refusal).toMatchObject({ status: 409, response: {
            code: "EMPLOYEE_PHONE_HELD_BY_DELETED", deletedEmployee: { id: original.id, name: "이전 사람" },
        } });
        // Exercise the production HTTP mapping and serializer without starting a server.
        const response = { locals: {}, setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const problem = mapHttpProblem(refusal, { method: "POST" } as Request, response as unknown as Response);
        expect(problem).not.toBeNull();
        sendProblemResponse(response as unknown as Response, problem!);
        expect(response.status).toHaveBeenCalledWith(409);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: "EMPLOYEE_PHONE_HELD_BY_DELETED", status: 409,
            detail: "이전에 삭제된 제공인력이 이 전화번호를 사용했어요. 복원하거나 새 관리사로 등록할 수 있어요.",
            deletedEmployee: { id: original.id, name: "이전 사람" },
        }));
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
        expect(await handle.raw.employee.count({ where: { branchId: branch.id } })).toBe(1);
        const restored = await controller.create({ branchId: branch.id }, { ...payload, onDeletedPhoneMatch: "restore" });
        expect(restored).toMatchObject({ id: original.id, name: payload.name, restored: true });
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ name: payload.name, deletedAt: null });
    });

    invariant("SI-EMP-10", "controller register_new releases only the identity key and preserves the old person's history", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const controller = new EmployeeController(employeeService);
        const params = { name: "이전 사람", phone: "01012345678" };
        const original = await controller.create({ branchId: branch.id }, params);
        tracker.track("employee", original.id);
        const client = await createClient(handle.raw, tracker, { branchId: branch.id });
        const history = await createEmployeeSchedule(handle.raw, tracker, { clientId: client.id, primaryEmployeeId: original.id }, {
            branchId: branch.id, startDate: new Date("2020-01-01"), endDate: new Date("2020-01-02"),
        });
        await employeeService.delete(branch.id, original.id);
        const before = await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } });
        const created = await controller.create({ branchId: branch.id }, { ...params, name: "새 사람", onDeletedPhoneMatch: "register_new" });
        tracker.track("employee", created.id);
        expect(created).toMatchObject({ name: "새 사람", restored: false });
        expect(created.id).not.toBe(original.id);
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toEqual({ ...before, phoneNormalized: null });
        expect(await handle.raw.employee_schedule.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
        for (const option of [undefined, "restore", "register_new"] as const) {
            await expect(controller.create({ branchId: branch.id }, { ...params, onDeletedPhoneMatch: option }))
                .rejects.toMatchObject({ status: 409, response: { code: "EMPLOYEE_PHONE_ALREADY_REGISTERED" } });
        }
    });

    invariant("SI-EMP-10", "options with no deleted match create normally; resolution DTO rejects other values", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const controller = new EmployeeController(employeeService);
        for (const [index, option] of (["restore", "register_new"] as const).entries()) {
            const dto = plainToInstance(CreateEmployeeDto, { name: "새 사람", phone: `0101234567${index}`, onDeletedPhoneMatch: option });
            expect(await validate(dto)).toEqual([]);
            const created = await controller.create({ branchId: branch.id }, dto);
            tracker.track("employee", created.id);
            expect(created.restored).toBe(false);
        }
        for (const invalid of [null, "other", 1, true]) {
            const errors = await validate(plainToInstance(CreateEmployeeDto, { name: "사람", phone: "01012345678", onDeletedPhoneMatch: invalid }));
            expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: "onDeletedPhoneMatch" })]));
        }
    });

    invariant("SI-EMP-10", "register_new rolls back the released identity if creating the new person fails", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const original = await employeeService.create(branch.id, { name: "이전 사람", phone: "01012345678" });
        tracker.track("employee", original.id);
        await employeeService.delete(branch.id, original.id);
        const before = await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } });
        const repository = new SbEmployeeRepository(handle.service);
        const create = jest.spyOn(repository, "create").mockRejectedValueOnce(new Error("injected create failure"));
        try {
            await expect(repository.createOrRestore(branch.id, original, { name: "새 사람", phone: original.phone }, undefined, "register_new"))
                .rejects.toThrow("injected create failure");
        } finally { create.mockRestore(); }
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
    });

    invariant("SI-EMP-10", "agent different-name create is a certain failure and cannot opt into restore", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const original = await employeeService.create(branch.id, { name: "이전 사람", phone: "01012345678" });
        tracker.track("employee", original.id);
        await employeeService.delete(branch.id, original.id);
        const before = await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } });
        const repository = new SbEmployeeRepository(handle.service);
        const provider = new EmployeeWriteAgentCapabilitiesProvider(
            new CreateEmployeeUsecase(repository), new UpdateEmployeeUsecase(repository),
            new ChangeEmployeeOpenStatusUsecase(repository), new FindEmployeeByIdUsecase(repository),
            repository, handle.service,
        );
        const create = provider.getCapabilities().find((capability) => capability.meta.name === "employees.create")!;
        const execution = create.execute({ principal: { userId: "user", branchId: branch.id, globalRole: "admin", branchRole: "admin" },
            sessionId: "session", traceId: "trace", locale: "ko", actionId: "action" }, {
            name: "새 사람", phone: original.phone, workArea: ["서울"], grade: "스탠다드", onDeletedPhoneMatch: "restore",
        });
        await expect(execution).rejects.toBeInstanceOf(AgentActionCertainFailureError);
        await expect(execution).rejects.toThrow("A deleted employee holds this phone number. The operator must choose whether to restore them or register a new employee in the app.");
        expect(await handle.raw.employee.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
    });

    invariant("SI-EMP-10", "a live duplicate returns 409 EMPLOYEE_PHONE_ALREADY_REGISTERED", async () => {
            const branch = await createBranch(handle.raw, tracker);
            const params = { name: "중복 검사", workArea: [], phone: "01012345678", grade: DEFAULT_EMPLOYEE_GRADE, openToNextWork: true };
            const original = await employeeService.create(branch.id, params);
            tracker.track("employee", original.id);
            let rejected: unknown;
            try {
                const recreated = await employeeService.create(branch.id, params);
                tracker.track("employee", recreated.id);
            } catch (error) {
                rejected = error;
            }
            expect(rejected).toMatchObject({
                status: 409,
                response: {
                    code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
                    errors: expect.arrayContaining([
                        expect.objectContaining({ pointer: "/phone", detail: "같은 전화번호의 관리사가 이미 등록되어 있습니다." }),
                    ]),
                },
            });
        },
    );

    invariant(
        "SI-EMP-04",
        "materialization sanity: an approved branch with an EMPLOYEE_ASSIGNED rule arms a pending job for the assignee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: kstShiftedIsoDate(30),
                scheduleEndIso: kstShiftedIsoDate(60),
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const job = await handle.raw.message_trigger_job.findFirst({
                where: { employeeScheduleId: fixture.scheduleId, ruleId: fixture.ruleId },
            });
            expect(job?.status).toBe("pending");
            expect((job?.payload as { employeeId?: number }).employeeId).toBe(fixture.employeeId);
            expect(job?.recipientType).toBe(MessageTriggerRecipientType.PRIMARY_EMPLOYEE);
        },
    );
});
