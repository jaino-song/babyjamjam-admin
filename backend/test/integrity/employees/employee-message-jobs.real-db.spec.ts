import type { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { EmployeeService } from "application/services/employee.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
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
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

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
 * addressed to a deleted or sms-disabled employee survives the change. The
 * resync itself has the same hole (SI-EMP-09): the recipe builder reads only
 * the employee row's phone, so re-running it after deletion re-creates the job.
 */

/** Stub for the agent-consent seal: binds nothing, cancels nothing (legacy behavior). */
const legacyDeliveryGate = { bindMaterialization: async (): Promise<void> => undefined };

/** Audit writer stub; the materialization path only reads activation state. */
const auditWriterStub: AdminAuditEventWriter = {
    append: async (): Promise<unknown> => undefined,
} as unknown as AdminAuditEventWriter;

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

    knownDefect(
        "SI-EMP-04",
        "deleting an employee cancels or resyncs pending assignment SMS jobs addressed to that employee",
        async () => {
            const fixture = await createAssignmentFixture({
                // An already-ended (but not replaced/terminated) assignment: the
                // delete guard allows deletion, the pending job stays behind.
                scheduleStartIso: "2026-09-01",
                scheduleEndIso: "2026-09-30",
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
            const pendingJobRemains = pending !== null && pending.status === "pending";
            expect(pendingJobRemains).toBe(false);
        },
        /Received: true/,
    );

    knownDefect(
        "SI-EMP-04",
        "disabling an employee's SMS automation resyncs pending assignment SMS jobs addressed to that employee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: "2026-11-01",
                scheduleEndIso: "2026-11-30",
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const materialized = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(materialized?.status).toBe("pending");

            // EmployeeService.update resyncs assignment jobs only when a name or
            // phone was supplied; the flag change alone must still leave no
            // pending job addressed to an sms-disabled employee.
            await employeeService.update(fixture.branchId, fixture.employeeId, { smsAutomationEnabled: false });

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            const pendingJobRemains = pending !== null && pending.status === "pending";
            expect(pendingJobRemains).toBe(false);
        },
        /Received: true/,
    );

    knownDefect(
        "SI-EMP-04",
        "closing an employee to next work resyncs pending assignment SMS jobs addressed to that employee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: "2026-11-01",
                scheduleEndIso: "2026-11-30",
            });
            const synced = await triggerService.syncEmployeeAssignmentRulesForSchedule(
                fixture.branchId,
                fixture.scheduleId,
                true,
            );
            expect(synced).toBe(true);
            const materialized = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            expect(materialized?.status).toBe("pending");

            await employeeService.changeOpenStatus(fixture.branchId, fixture.employeeId, false);

            const pending = await pendingAssignmentJob(fixture.scheduleId, fixture.ruleId);
            const pendingJobRemains = pending !== null && pending.status === "pending";
            expect(pendingJobRemains).toBe(false);
        },
        /Received: true/,
    );

    knownDefect(
        "SI-EMP-09",
        "assignment resync does not re-arm a pending SMS job for a soft-deleted employee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: "2026-11-01",
                scheduleEndIso: "2026-11-30",
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
            const pendingJobRemains = pending !== null && pending.status === "pending";
            expect(pendingJobRemains).toBe(false);
        },
        /Received: true/,
    );

    invariant(
        "SI-EMP-04",
        "materialization sanity: an approved branch with an EMPLOYEE_ASSIGNED rule arms a pending job for the assignee",
        async () => {
            const fixture = await createAssignmentFixture({
                scheduleStartIso: "2026-11-01",
                scheduleEndIso: "2026-11-30",
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
