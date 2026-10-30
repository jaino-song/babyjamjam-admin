import type { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { EmployeeService } from "application/services/employee.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { ChangeEmployeeOpenStatusUsecase } from "application/usecases/employee/change-employee-open-status.usecase";
import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
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
import { MessageTriggerTemplateKey, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerEventType } from "domain/constants/message-trigger-catalog";
import { isoDateInKorea } from "domain/utils/business-days";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import type { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";

import {
    createBranch,
    createClient,
    createEmployee,
    createEmployeeSchedule,
    createMessageTriggerRule,
} from "../helpers/factories";
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

    knownDefect(
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
        /the pending assignment SMS job addressed to the deleted employee was not canceled or resynced by the delete path/,
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

    knownDefect(
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
        /the assignment resync re-armed a pending SMS job addressed to the soft-deleted employee/,
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
