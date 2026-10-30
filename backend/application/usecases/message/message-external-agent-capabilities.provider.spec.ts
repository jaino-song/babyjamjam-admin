import { createLegacyAutomationDeliveryGate } from "../../../test/fixtures/legacy-automation-delivery-gate";
import { NotFoundException } from "@nestjs/common";

import { AligoService } from "application/services/aligo.service";
import { SendAligoSmsUsecase } from "application/usecases/aligo/send-sms.usecase";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { ActionCoordinatorService, AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { redactModelValue } from "application/agent/agent-model-redaction";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

import { MessageExternalAgentCapabilitiesProvider } from "./message-external-agent-capabilities.provider";
import { createSchedulerLeaseMock } from "../../../test/utils/mocks/scheduler-lease.mock";

const principal = { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" };
const context = { principal, sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a" };

function terminalJob(overrides: Partial<MessageTriggerJobEntity> = {}): MessageTriggerJobEntity {
    const now = new Date("2026-08-03T00:00:00.000Z");
    return Object.assign(MessageTriggerJobEntity.reconstitute(
        "job-a",
        principal.branchId,
        "rule-a",
        "failed",
        now,
        null,
        null,
        "provider rejected",
        1,
        null,
        MessageTriggerRecipientType.CLIENT,
        "01012345678",
        MessageTriggerTemplateKey.INFO,
        "source-dedupe",
        {
            memberId: "client-1",
            recipientName: "수신자",
            recipientPhone: "01012345678",
            messageBody: "실패한 안내 본문",
            templateVariables: {
                retrySafety: "provider-rejected",
                msgType: "SMS",
                title: "실패한 안내 제목",
                triggerType: "agent_scheduled",
            },
        },
        now,
        now,
    ), overrides);
}

describe("MessageExternalAgentCapabilitiesProvider", () => {
    function setup(source = terminalJob()) {
        const now = new Date("2026-08-03T00:00:00.000Z");
        const rule = MessageTriggerRuleEntity.reconstitute(
            "rule-a", principal.branchId, "시작 알림", true,
            MessageTriggerEventType.SERVICE_START, MessageTriggerOffsetType.BEFORE_DAYS, 1,
            MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.SERVICE_INFO,
            now, now,
        );
        const repository = {
            findHistoryByBranch: jest.fn().mockResolvedValue([source]),
            findByIdInBranch: jest.fn().mockResolvedValue(source),
            upsertPending: jest.fn().mockImplementation(async (candidate: MessageTriggerJobEntity) => Object.assign(candidate, { id: "retry-job" })),
            claimProviderRejectedForRetry: jest.fn().mockImplementation(async (_branchId: string, _sourceJobId: string, _version: string, _snapshotHash: string, _source: MessageTriggerJobEntity, candidate: MessageTriggerJobEntity) => ({ kind: "claimed", job: Object.assign(candidate, { id: "retry-job" }) })),
        };
        const delivery = {
            dispatchPendingJobNow: jest.fn().mockResolvedValue({ status: "sent" }),
            listRules: jest.fn().mockResolvedValue([rule]),
            listRulesReadOnly: jest.fn().mockResolvedValue([rule]),
            getRule: jest.fn().mockResolvedValue(rule),
            createRule: jest.fn().mockResolvedValue(rule),
            updateRule: jest.fn().mockImplementation(async (_branchId, _id, updates) => Object.assign(rule, updates)),
            updateRuleApprovedTarget: jest.fn().mockResolvedValue(rule),
            deleteRule: jest.fn().mockResolvedValue(undefined),
            deleteRuleApprovedTarget: jest.fn().mockResolvedValue(undefined),
            isRuleMutationComplete: jest.fn().mockResolvedValue(true),
        };
        let effectReceipt: unknown = null;
        const prisma = {
            $transaction: jest.fn(),
            agent_action: {
                updateMany: jest.fn().mockImplementation(async ({ data }) => {
                    effectReceipt = data.effectReceipt;
                    return { count: 1 };
                }),
                findUnique: jest.fn().mockResolvedValue(null),
                findFirst: jest.fn().mockImplementation(async () => ({ effectReceipt })),
            },
            message_trigger_rule: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue(undefined) },
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(null) },
            client: {
                findFirst: jest.fn().mockImplementation(async ({ where }: { where: { phone?: string } }) => ({
                    id: 1,
                    name: "테스트 고객",
                    phone: where.phone ?? "01012345678",
                })),
            },
            employee: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma));
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 88, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const smsDelivery = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            { getByKey: jest.fn() } as never,
            { save: jest.fn() } as never,
        undefined, undefined, createLegacyAutomationDeliveryGate());
        const senderApproval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
        const provider = new MessageExternalAgentCapabilitiesProvider(
            prisma as never,
            delivery as never,
            repository as never,
            smsDelivery,
            senderApproval as unknown as MessageSenderApprovalService,
        );
        const capabilities = provider.getCapabilities();
        return { repository, delivery, prisma, smsDelivery, aligoService, senderApproval, capabilities };
    }

    it("lists only terminal jobs through the branch-scoped repository boundary", async () => {
        const { repository, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.deliveryHistory");

        const result = await capability!.execute(context, { limit: 12 }) as { jobs: Array<{ id: string; status: string }> };

        expect(repository.findHistoryByBranch).toHaveBeenCalledWith(principal.branchId, 13, undefined);
        expect(result.jobs).toEqual([expect.objectContaining({ id: "job-a", status: "failed" })]);
        expect(result.jobs[0]).toEqual({
            id: "job-a", status: "failed", scheduledFor: "2026-08-03T00:00:00.000Z",
            sentAt: null, templateKey: MessageTriggerTemplateKey.INFO, clientId: 1,
            attempts: 0, updatedAt: "2026-08-03T00:00:00.000Z",
        });
    });

    const smsCases = ["messages.sendSms", "messages.scheduleSms"];
    const smsInput = { receiver: "01012345678", message: "안내", scheduledDate: "2099-08-03", scheduledTime: "12:00" };
    function inputFor(name: string) {
        return name === "messages.scheduleSms" ? smsInput : { receiver: smsInput.receiver, message: smsInput.message };
    }

    it.each(smsCases)("%s proposes only the client ID and name, never a contact", async (name) => {
        const { capabilities, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === name)!;
        const inspection = await capability.inspect!(context, inputFor(name));
        expect(inspection.targetSnapshot).toEqual({ clientId: 1, name: "테스트 고객" });
        expect(inspection.targetVersion).toBeUndefined();
        expect(inspection.summary).toBe(name === "messages.sendSms"
            ? "테스트 고객 님에게 2자 메시지를 발송합니다."
            : "2099-08-03 12:00에 테스트 고객 님에게 발송합니다.");
        expect(inspection.summary).not.toMatch(/[•*]|\d{9,}|0\d{1,2}[- ]\d{3,4}[- ]\d{4}/);
        expect(JSON.stringify(inspection.targetSnapshot)).not.toMatch(/[•*]|@|010[-\d]+/);
        expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it.each(smsCases)("%s proposes an employee ID when no client matches", async (name) => {
        const { capabilities, prisma } = setup();
        prisma.client.findFirst.mockResolvedValue(null);
        prisma.employee.findFirst.mockResolvedValue({ id: 9, name: "테스트 직원", phone: smsInput.receiver } as never);
        const inspection = await capabilities.find((entry) => entry.meta.name === name)!.inspect!(context, inputFor(name));
        expect(inspection.targetSnapshot).toEqual({ employeeId: 9, name: "테스트 직원" });
        expect(inspection.targetVersion).toBeUndefined();
        expect(inspection.summary).toContain("테스트 직원 님에게");
        expect(inspection.summary).not.toMatch(/[•*]|\d{9,}|0\d{1,2}[- ]\d{3,4}[- ]\d{4}/);
        expect(JSON.stringify(inspection.targetSnapshot)).not.toMatch(/[•*]|@|010[-\d]+/);
    });

    it.each(smsCases)("%s rejects unknown recipients at proposal time", async (name) => {
        const { capabilities, prisma, repository, senderApproval } = setup();
        prisma.client.findFirst.mockResolvedValue(null);
        await expect(capabilities.find((entry) => entry.meta.name === name)!.inspect!(context, inputFor(name)))
            .rejects.toThrow("SMS recipient is not an active client or employee in this branch");
        expect(senderApproval.ensureApproved).toHaveBeenCalledWith(principal.branchId);
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it.each(smsCases)("%s looks up only live clients and refuses a phone owned only by a deleted client", async (name) => {
        const { capabilities, prisma, repository } = setup();
        const tombstoned = { id: 5, name: "삭제된 고객", phone: smsInput.receiver, deletedAt: new Date("2026-08-01T00:00:00.000Z") };
        // Behave like the database: a row only matches when the where clause excludes tombstones.
        prisma.client.findFirst.mockImplementation((async ({ where }: { where: { deletedAt?: null } }) =>
            where.deletedAt === null ? null : tombstoned) as never);
        await expect(capabilities.find((entry) => entry.meta.name === name)!.inspect!(context, inputFor(name)))
            .rejects.toThrow("SMS recipient is not an active client or employee in this branch");
        expect(prisma.client.findFirst).toHaveBeenCalledWith({
            where: { branchId: principal.branchId, phone: smsInput.receiver, deletedAt: null },
            select: { id: true, name: true, phone: true },
        });
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it.each(smsCases)("%s still resolves a live client through the tombstone-filtered lookup", async (name) => {
        const { capabilities, prisma } = setup();
        const inspection = await capabilities.find((entry) => entry.meta.name === name)!.inspect!(context, inputFor(name));
        expect(inspection.targetSnapshot).toEqual({ clientId: 1, name: "테스트 고객" });
        expect(prisma.client.findFirst).toHaveBeenCalledWith({
            where: { branchId: principal.branchId, phone: smsInput.receiver, deletedAt: null },
            select: { id: true, name: true, phone: true },
        });
    });

    it("does not bind a deleted client into a retry target (inspection falls back to no recipient ID)", async () => {
        const source = terminalJob({ recipientType: MessageTriggerRecipientType.CLIENT, clientId: 5 });
        const { capabilities, prisma } = setup(source);
        const tombstoned = { id: 5, name: "삭제된 고객", phone: smsInput.receiver };
        prisma.client.findFirst.mockImplementation((async ({ where }: { where: { deletedAt?: null } }) =>
            where.deletedAt === null ? null : tombstoned) as never);
        prisma.employee.findFirst.mockResolvedValue(null);
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await retry.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot).not.toHaveProperty("clientId");
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain("수신자 님에게");
        expect(inspection.summary).not.toContain("삭제된 고객");
        expect(prisma.client.findFirst).toHaveBeenCalledWith({
            where: { branchId: principal.branchId, phone: smsInput.receiver, deletedAt: null },
            select: { id: true, name: true, phone: true },
        });
    });

    it("refuses to execute a retry when the approved client was deleted after approval", async () => {
        const { capabilities, prisma, repository } = setup();
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await retry.inspect!(context, { jobId: "job-a" });
        expect(inspection.targetSnapshot?.["clientId"]).toBe(1);
        const tombstoned = { id: 1, name: "테스트 고객", phone: smsInput.receiver };
        prisma.client.findFirst.mockImplementation((async ({ where }: { where: { deletedAt?: null } }) =>
            where.deletedAt === null ? null : tombstoned) as never);
        await expect(retry.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: "job-a" })).rejects.toThrow("SMS recipient is not an active client or employee in this branch");
        expect(repository.claimProviderRejectedForRetry).not.toHaveBeenCalled();
    });

    it.each(smsCases)("%s sends when the approved recipient ID still matches", async (name) => {
        const { capabilities, repository } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === name)!;
        const inspection = await capability.inspect!(context, inputFor(name));
        await capability.execute({ ...context, approvedTargetSnapshot: inspection.targetSnapshot }, inputFor(name));
        expect(repository.upsertPending).toHaveBeenCalledTimes(1);
    });

    it.each(smsCases)("%s binds employee approvals and rejects changed employee IDs and kinds", async (name) => {
        for (const approvedTargetSnapshot of [{ employeeId: 9 }, { employeeId: 10 }, { clientId: 9 }]) {
            const { capabilities, prisma, repository } = setup();
            prisma.client.findFirst.mockResolvedValue(null);
            prisma.employee.findFirst.mockResolvedValue({ id: 9, name: "테스트 직원", phone: smsInput.receiver } as never);
            const execution = capabilities.find((entry) => entry.meta.name === name)!.execute(
                { ...context, approvedTargetSnapshot }, inputFor(name),
            );
            if (approvedTargetSnapshot.employeeId === 9) {
                await expect(execution).resolves.toHaveProperty("jobId", "retry-job");
                expect(repository.upsertPending).toHaveBeenCalledTimes(1);
            } else {
                await expect(execution).rejects.toEqual(new AgentActionCertainFailureError("SMS recipient changed after approval; review a new proposal"));
                expect(repository.upsertPending).not.toHaveBeenCalled();
                expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
            }
        }
    });

    it.each(smsCases)("%s uses a safe display name when the matched recipient has no name", async (name) => {
        const { capabilities, prisma } = setup();
        prisma.client.findFirst.mockResolvedValue({ id: 1, name: null, phone: smsInput.receiver } as never);
        const inspection = await capabilities.find((entry) => entry.meta.name === name)!.inspect!(context, inputFor(name));
        expect(inspection.targetSnapshot).toEqual({ clientId: 1, name: "수신자" });
        expect(inspection.summary).toContain("수신자 님에게");
    });

    it.each(smsCases)("%s rejects a changed recipient ID or entity kind before enqueue", async (name) => {
        for (const approvedTargetSnapshot of [{ clientId: 2 }, { employeeId: 1 }]) {
            const { capabilities, repository, prisma, delivery } = setup();
            await expect(capabilities.find((entry) => entry.meta.name === name)!.execute(
                { ...context, approvedTargetSnapshot }, inputFor(name),
            )).rejects.toEqual(new AgentActionCertainFailureError("SMS recipient changed after approval; review a new proposal"));
            expect(repository.upsertPending).not.toHaveBeenCalled();
            expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
            expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
        }
    });

    it.each(smsCases)("%s accepts old approval snapshots with no recipient ID", async (name) => {
        const { capabilities, repository } = setup();
        await capabilities.find((entry) => entry.meta.name === name)!.execute(
            { ...context, approvedTargetSnapshot: { name: "수신자" } }, inputFor(name),
        );
        expect(repository.upsertPending).toHaveBeenCalledTimes(1);
    });

    it.each([
        [MessageTriggerRecipientType.CLIENT, 7, { employeeId: 9 }],
        [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, 7, { employeeId: 9 }],
        [MessageTriggerRecipientType.SECONDARY_EMPLOYEE, 7, { employeeId: 9 }],
        [MessageTriggerRecipientType.CLIENT, null, { employeeId: 9 }],
    ])("retry and history distinguish the recipient from the job's client (%s, %s)", async (recipientType, clientId, expectedId) => {
        const source = terminalJob({ recipientType, clientId });
        const { capabilities, prisma, smsDelivery } = setup(source);
        prisma.client.findFirst.mockResolvedValue(null);
        prisma.employee.findFirst.mockResolvedValue({ id: 9, name: "테스트 직원", phone: smsInput.receiver } as never);
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await retry.inspect!(context, { jobId: source.id });
        const target = inspection.targetSnapshot!;
        expect(Object.fromEntries(Object.entries(target).filter(([key]) => key === "clientId" || key === "employeeId"))).toEqual(expectedId);
        expect(inspection.summary).toContain("테스트 직원 님에게");
        expect(prisma.client.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.employee.findFirst).toHaveBeenCalledTimes(1);
        expect(inspection.summary).not.toMatch(/[•*]|\d{9,}|0\d{1,2}[- ]\d{3,4}[- ]\d{4}/);
        expect(JSON.stringify(redactModelValue(target))).not.toMatch(/[•*]|@|010[-\d]+/);
        const canonical = await smsDelivery.resolveCanonicalDeliverySnapshot(source);
        expect(() => smsDelivery.approvedSnapshotForExecution(source, target, canonical)).not.toThrow();
        const history = capabilities.find((entry) => entry.meta.name === "messages.deliveryHistory")!;
        prisma.client.findFirst.mockClear();
        prisma.employee.findFirst.mockClear();
        const result = history.outputSchema.parse(await history.execute(context, {})) as { jobs: Array<Record<string, unknown>> };
        expect(result.jobs[0]?.["clientId"]).toBe(recipientType === MessageTriggerRecipientType.CLIENT ? clientId : null);
        expect(result.jobs[0]).not.toHaveProperty("receiver");
        expect(result.jobs[0]).not.toHaveProperty("recipient");
        expect(prisma.client.findFirst).not.toHaveBeenCalled();
        expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it("does not mislabel an unresolved employee retry with the job's client ID", async () => {
        const source = terminalJob({ recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, clientId: 7 });
        const { capabilities, prisma } = setup(source);
        prisma.client.findFirst.mockResolvedValue(null);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot).not.toHaveProperty("clientId");
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain("수신자 님에게");
    });

    it("uses the live client rather than the employee job's stored client ID", async () => {
        const source = terminalJob({ recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, clientId: 7 });
        const { capabilities } = setup(source);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot?.["clientId"]).toBe(1);
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain("테스트 고객 님에게");
    });

    it("uses the client now owning the retry phone for both ID and summary", async () => {
        const source = terminalJob({ clientId: 7 });
        source.payload.recipientName = "이전 고객";
        const { capabilities, prisma, smsDelivery } = setup(source);
        prisma.client.findFirst.mockResolvedValue({ id: 9, name: "새 고객", phone: smsInput.receiver } as never);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot?.["clientId"]).toBe(9);
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain("새 고객 님에게");
        expect(inspection.summary).not.toContain("이전 고객");
        expect(prisma.client.findFirst).toHaveBeenCalledTimes(1);
        const canonical = await smsDelivery.resolveCanonicalDeliverySnapshot(source);
        expect(() => smsDelivery.approvedSnapshotForExecution(source, inspection.targetSnapshot!, canonical)).not.toThrow();
    });

    it.each(["저장된 이름", ""])("omits retry IDs when unresolved and falls back from stored name %s", async (recipientName) => {
        const source = terminalJob({ clientId: 7 });
        source.payload.recipientName = recipientName;
        const { capabilities, prisma } = setup(source);
        prisma.client.findFirst.mockResolvedValue(null);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot).not.toHaveProperty("clientId");
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain(`${recipientName || "수신자"} 님에게`);
    });

    it("falls back to the stored name when the resolved retry recipient has no name", async () => {
        const source = terminalJob({ clientId: 7 });
        source.payload.recipientName = "저장된 이름";
        const { capabilities, prisma } = setup(source);
        prisma.client.findFirst.mockResolvedValue({ id: 9, name: null, phone: smsInput.receiver } as never);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot?.["clientId"]).toBe(9);
        expect(inspection.summary).toContain("저장된 이름 님에게");
    });

    it.each([
        ["changed client", { clientId: 7 }, { clientId: 9 }, false],
        ["changed kind", { clientId: 7 }, { employeeId: 7 }, false],
        ["same client", { clientId: 7 }, { clientId: 7 }, true],
        ["same employee", { employeeId: 9 }, { employeeId: 9 }, true],
        ["changed employee", { employeeId: 8 }, { employeeId: 9 }, false],
        ["employee to client", { employeeId: 9 }, { clientId: 9 }, false],
        ["legacy snapshot", {}, { clientId: 9 }, true],
        ["unresolved inspection", {}, { employeeId: 9 }, true],
    ] as const)("binds retry execution to the approved recipient: %s", async (_label, approvedId, resolvedId, proceeds) => {
        const source = terminalJob({ clientId: 7 });
        const { capabilities, prisma, repository, delivery, smsDelivery, aligoService } = setup(source);
        prisma.client.findFirst.mockResolvedValue(null);
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await retry.inspect!(context, { jobId: source.id });
        const approvedTargetSnapshot = { ...inspection.targetSnapshot, ...approvedId };
        const canonical = await smsDelivery.resolveCanonicalDeliverySnapshot(source);
        expect(() => smsDelivery.approvedSnapshotForExecution(source, approvedTargetSnapshot, canonical)).not.toThrow();
        if ("clientId" in resolvedId) {
            prisma.client.findFirst.mockResolvedValue({ id: resolvedId.clientId, name: "현재 고객", phone: smsInput.receiver } as never);
        } else {
            prisma.employee.findFirst.mockResolvedValue({ id: resolvedId.employeeId, name: "현재 직원", phone: smsInput.receiver } as never);
        }
        const execution = retry.execute({ ...context, approvedTargetSnapshot, approvedTargetVersion: inspection.targetVersion }, { jobId: source.id });
        if (proceeds) {
            await expect(execution).resolves.toEqual({ status: "sent", jobId: "retry-job" });
            expect(repository.claimProviderRejectedForRetry).toHaveBeenCalledTimes(1);
            expect(delivery.dispatchPendingJobNow).toHaveBeenCalledTimes(1);
        } else {
            await expect(execution).rejects.toEqual(new AgentActionCertainFailureError("SMS recipient changed after approval; review a new proposal"));
            expect(repository.claimProviderRejectedForRetry).not.toHaveBeenCalled();
            expect(repository.upsertPending).not.toHaveBeenCalled();
            expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
            expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        }
    });

    it("resolves an agent-sent retry with no stored client ID while history stays null", async () => {
        const source = terminalJob({ clientId: null });
        source.payload.recipientName = "테스트 고객";
        const { capabilities, prisma } = setup(source);
        const inspection = await capabilities.find((entry) => entry.meta.name === "messages.retrySms")!.inspect!(context, { jobId: source.id });
        expect(inspection.targetSnapshot?.["clientId"]).toBe(1);
        expect(inspection.targetSnapshot).not.toHaveProperty("employeeId");
        expect(inspection.summary).toContain("테스트 고객 님에게");
        prisma.client.findFirst.mockClear();
        const history = capabilities.find((entry) => entry.meta.name === "messages.deliveryHistory")!;
        const result = await history.execute(context, {}) as { jobs: Array<Record<string, unknown>> };
        expect(result.jobs[0]?.["clientId"]).toBeNull();
        expect(prisma.client.findFirst).not.toHaveBeenCalled();
    });

    it("enforces the scheduled SMS minimum lead time in the capability schema", () => {
        const { capabilities } = setup();
        const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
        const soon = new Date(Date.now() + 5 * 60 * 1000);
        const date = soon.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
        const time = soon.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

        expect(schedule.inputSchema.safeParse({ receiver: "01012345678", message: "안내", scheduledDate: date, scheduledTime: time }).success).toBe(false);
    });

    it("requires branch-manager authority for SMS side-effect capabilities", () => {
        const { capabilities } = setup();
        for (const name of ["messages.sendSms", "messages.scheduleSms", "messages.retrySms"]) {
            const capability = capabilities.find((entry) => entry.meta.name === name)!;
            expect(capability.meta.requiredRoles).toEqual(["owner", "admin", "manager"]);
        }
    });

    it("rejects impossible calendar dates and normalized out-of-range times", () => {
        const { capabilities } = setup();
        const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
        const base = { receiver: "01012345678", message: "안내" };

        expect(schedule.inputSchema.safeParse({ ...base, scheduledDate: "2030-02-30", scheduledTime: "12:00" }).success).toBe(false);
        expect(schedule.inputSchema.safeParse({ ...base, scheduledDate: "2030-03-01", scheduledTime: "24:00" }).success).toBe(false);
    });

    it.each(["01012345678", "010-1234-5678"])("accepts one valid %s receiver for preview, send, and schedule", (receiver) => {
        const { capabilities } = setup();
        const inputs = {
            "messages.previewSms": { receiver, message: "안내" },
            "messages.sendSms": { receiver, message: "안내" },
            "messages.scheduleSms": { receiver, message: "안내", scheduledDate: "2099-08-03", scheduledTime: "12:00" },
        } as const;

        for (const name of Object.keys(inputs) as Array<keyof typeof inputs>) {
            const capability = capabilities.find((entry) => entry.meta.name === name)!;
            expect(capability.inputSchema.safeParse(inputs[name]).success).toBe(true);
        }
    });

    it.each(["messages.previewSms", "messages.sendSms", "messages.scheduleSms"])("rejects comma-separated receivers for %s before any SMS write", async (name) => {
        const { capabilities, repository, prisma, delivery, aligoService } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === name)!;
        const input = name === "messages.scheduleSms"
            ? { receiver: "01012345678,01087654321", message: "안내", scheduledDate: "2099-08-03", scheduledTime: "12:00" }
            : { receiver: "01012345678,01087654321", message: "안내" };

        expect(capability.inputSchema.safeParse(input).success).toBe(false);
        await expect(capability.execute(context, input)).rejects.toThrow();

        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(repository.upsertPending).not.toHaveBeenCalled();
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("discloses and records the LMS type used by the INFO delivery template", async () => {
        const { capabilities } = setup();
        const preview = capabilities.find((entry) => entry.meta.name === "messages.previewSms")!;
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;
        const input = { receiver: "01012345678", message: "짧은 안내" };

        await expect(preview.execute(context, input)).resolves.toEqual({ status: "preview", msgType: "LMS" });
        await expect(send.inspect!(context, input)).resolves.toEqual(expect.objectContaining({ estimatedCost: "LMS 요금제 기준" }));
        await expect(send.execute(context, input)).resolves.toEqual(expect.objectContaining({ status: "sent", msgType: "LMS" }));
    });

    it("rejects an arbitrary agent SMS recipient before creating a rule or job", async () => {
        const { capabilities, repository, prisma, delivery } = setup();
        prisma.client.findFirst.mockResolvedValue(null);
        prisma.employee.findFirst.mockResolvedValue(null);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01099998888", message: "임의 번호" }))
            .rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(repository.upsertPending).not.toHaveBeenCalled();
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it.each([
        ["messages.sendSms", { receiver: "01012345678", message: "즉시 안내" }, "AI 문자 발송"],
        ["messages.sendSms", { receiver: "01012345678", message: "즉시 안내", title: "명시적 즉시 제목" }, "명시적 즉시 제목"],
        ["messages.scheduleSms", { receiver: "01012345678", message: "예약 안내", scheduledDate: "2099-08-03", scheduledTime: "12:00" }, "AI 예약 문자"],
        ["messages.scheduleSms", { receiver: "01012345678", message: "예약 안내", title: "명시적 예약 제목", scheduledDate: "2099-08-03", scheduledTime: "12:00" }, "명시적 예약 제목"],
    ])("uses one canonical title from proposal input through staged job and provider request (%s)", async (capabilityName, rawInput, expectedTitle) => {
        const { capabilities, prisma, repository, smsDelivery, aligoService } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === capabilityName)!;
        const actionRepository = {
            createInActiveSession: jest.fn().mockImplementation(async (proposal: { proposal: unknown }) => ({
                status: "created",
                action: { proposal: proposal.proposal },
            })),
        };
        const coordinator = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(capability) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            {} as never,
            { assertActive: jest.fn().mockResolvedValue(undefined) } as never,
            actionRepository as never,
            createSchedulerLeaseMock(),
        );

        await coordinator.propose({
            sessionId: context.sessionId,
            principal: context.principal as never,
            capability: capabilityName,
            input: rawInput,
            locale: context.locale,
            traceId: context.traceId,
        });
        const persisted = actionRepository.createInActiveSession.mock.calls[0]?.[0] as {
            proposal: { input: Record<string, unknown> };
        };
        expect(persisted.proposal.input["title"]).toBe(expectedTitle);

        const stagedResult = await capability.execute(context, persisted.proposal.input);
        expect(stagedResult).toEqual(expect.objectContaining({ status: capabilityName === "messages.sendSms" ? "sent" : "scheduled" }));
        const stagedJob = repository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(stagedJob.payload.templateVariables["title"]).toBe(persisted.proposal.input["title"]);

        await smsDelivery.sendJob(stagedJob);
        expect(aligoService.sendSms).toHaveBeenLastCalledWith(expect.objectContaining({
            title: persisted.proposal.input["title"],
        }));
    });

    it.each(["provider-rejected", "permanent-provider-rejected"])("returns a certain failed result for %s", async (retrySafety) => {
        const { delivery, capabilities } = setup();
        const failed = terminalJob({ id: "retry-job" });
        failed.payload.templateVariables["retrySafety"] = retrySafety;
        delivery.dispatchPendingJobNow.mockResolvedValue(failed);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "거절 테스트" }))
            .resolves.toEqual({ status: "failed", msgType: "LMS", jobId: "retry-job" });
    });

    it("preserves canceled SMS outcomes as canceled", async () => {
        const { delivery, capabilities } = setup();
        const canceled = terminalJob({ id: "retry-job", status: "canceled", cancelReason: "승인 필요" });
        delivery.dispatchPendingJobNow.mockResolvedValue(canceled);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "취소 테스트" }))
            .resolves.toEqual({ status: "canceled", msgType: "LMS", jobId: "retry-job" });
    });

    it("keeps thrown transport failures uncertain and does not infer a provider rejection", async () => {
        const { delivery, capabilities } = setup();
        delivery.dispatchPendingJobNow.mockRejectedValue(new Error("transport unavailable"));
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "전송 오류 테스트" }))
            .rejects.toMatchObject({ name: "AgentActionUncertainError" });
    });

    it("keeps failed jobs without the provider-rejected marker uncertain", async () => {
        const { delivery, capabilities } = setup();
        const failed = terminalJob({ id: "retry-job" });
        failed.payload.templateVariables["retrySafety"] = "uncertain";
        delivery.dispatchPendingJobNow.mockResolvedValue(failed);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "근거 부족 테스트" }))
            .rejects.toMatchObject({ name: "AgentActionUncertainError" });
    });

    it.each(["provider-rejected", "permanent-provider-rejected"])("reconciles a persisted %s job as failed", async (retrySafety) => {
        const { prisma, capabilities } = setup();
        const failed = terminalJob({ id: "job-a" });
        failed.payload.templateVariables["retrySafety"] = retrySafety;
        prisma.message_trigger_job.findFirst.mockResolvedValue(failed as never);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.reconcile!(context, {}, { jobId: failed.id }))
            .resolves.toEqual({ status: "failed", result: { status: "failed", jobId: failed.id } });
    });

    it("reports an Aligo permanent rejection as failed through send and later reconciliation, but refuses retry", async () => {
        const { repository, delivery, prisma, smsDelivery, aligoService, capabilities } = setup();
        aligoService.sendSms.mockResolvedValue({
            request: { receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: -101, message: "인증오류입니다.", msg_id: 0, success_cnt: 0, error_cnt: 1 },
        });
        delivery.dispatchPendingJobNow.mockImplementation(async () => {
            const job = repository.upsertPending.mock.calls[0][0] as MessageTriggerJobEntity;
            expect(await smsDelivery.sendJob(job)).toBe(false);
            job.status = "failed";
            prisma.message_trigger_job.findFirst.mockResolvedValue(job as never);
            repository.findByIdInBranch.mockResolvedValue(job);
            return job;
        });
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const input = { receiver: "01012345678", message: "영구 거절 테스트" };

        await expect(send.execute(context, input)).resolves.toEqual({ status: "failed", msgType: "LMS", jobId: "retry-job" });
        await expect(send.reconcile!(context, input, { jobId: "retry-job" }))
            .resolves.toEqual({ status: "failed", result: { status: "failed", jobId: "retry-job" } });
        await expect(retry.inspect!(context, { jobId: "retry-job" })).rejects.toThrow("not safely retryable");
        expect(repository.claimProviderRejectedForRetry).not.toHaveBeenCalled();
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("keeps reconciliation of a genuinely uncertain failed job uncertain", async () => {
        const { prisma, capabilities } = setup();
        const failed = terminalJob();
        failed.payload.templateVariables["retrySafety"] = "uncertain";
        prisma.message_trigger_job.findFirst.mockResolvedValue(failed as never);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.reconcile!(context, {}, { jobId: failed.id }))
            .resolves.toEqual(expect.objectContaining({ status: "uncertain" }));
    });

    it.each(["provider-rejected", "permanent-provider-rejected"])("reports an agent retry answered with %s as failed and reconciles it", async (retrySafety) => {
        const { delivery, prisma, capabilities } = setup();
        const retry = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await retry.inspect!(context, { jobId: "job-a" });
        const failed = terminalJob({ id: "retry-job" });
        failed.payload.templateVariables["retrySafety"] = retrySafety;
        delivery.dispatchPendingJobNow.mockResolvedValue(failed);
        prisma.message_trigger_job.findFirst.mockResolvedValue(failed as never);

        await expect(retry.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: "job-a" })).resolves.toEqual({ status: "failed", jobId: failed.id });
        await expect(retry.reconcile!(context, { jobId: "job-a" }, { jobId: failed.id }))
            .resolves.toEqual({ status: "failed", result: { status: "failed", jobId: failed.id } });
    });

    it("does not create an SMS rule or job when sender approval is revoked", async () => {
        const { senderApproval, repository, prisma, capabilities } = setup();
        senderApproval.ensureApproved.mockRejectedValue(new Error("approval required"));
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.inspect!(context, { receiver: "01012345678", message: "승인 필요" }))
            .rejects.toThrow("approval required");
        await expect(send.execute(context, { receiver: "01012345678", message: "승인 필요" }))
            .rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it("rejects unsupported SMS sender overrides and omits them from recovery forms", () => {
        const { capabilities } = setup();
        for (const name of ["messages.sendSms", "messages.scheduleSms"]) {
            const capability = capabilities.find((entry) => entry.meta.name === name)!;
            const input = name === "messages.scheduleSms"
                ? { receiver: "01012345678", message: "안내", senderPhone: "0212345678", scheduledDate: "2030-08-03", scheduledTime: "12:00" }
                : { receiver: "01012345678", message: "안내", senderPhone: "0212345678" };
            expect(capability.inputSchema.safeParse(input).success).toBe(false);
            expect(capability.formFields?.some((field) => field.name === "senderPhone")).toBe(false);
        }
    });

    it("creates one action-keyed retry only for an explicitly provider-rejected job", async () => {
        const { repository, delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms");

        const inspection = await capability!.inspect!(context, { jobId: "job-a" });
        const approvedContext = {
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        };
        const result = await capability!.execute(approvedContext, { jobId: "job-a" }) as { status: string; jobId: string };

        expect(inspection.targetVersion).toHaveLength(64);
        expect(repository.claimProviderRejectedForRetry).toHaveBeenCalledWith(
            principal.branchId,
            "job-a",
            inspection.targetVersion,
            expect.any(String),
            expect.objectContaining({ id: "job-a" }),
            expect.objectContaining({
                branchId: principal.branchId,
                dedupeKey: `agent-sms-retry:${context.actionId}`,
                status: "pending",
            }),
        );
        expect(delivery.dispatchPendingJobNow).toHaveBeenCalledWith("retry-job", {
            expectedBranchId: principal.branchId,
        });
        expect(result).toEqual({ status: "sent", jobId: "retry-job" });
    });

    it("reports a retry claim that waited past the lock timeout as a definite not-created failure, not uncertain", async () => {
        const { repository, delivery, capabilities } = setup();
        repository.claimProviderRejectedForRetry.mockResolvedValue({ kind: "lock_timeout" });
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: "job-a" });

        await expect(capability.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: "job-a" })).rejects.toMatchObject({
            name: "AgentActionCertainFailureError",
            message: expect.stringContaining("try again"),
        });
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("keeps an unclassified claim error (e.g. an interactive-transaction timeout) uncertain", async () => {
        const { repository, capabilities } = setup();
        repository.claimProviderRejectedForRetry.mockRejectedValue(Object.assign(new Error("Transaction already closed"), { code: "P2028" }));
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: "job-a" });

        const failure = await capability.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: "job-a" }).catch((error: unknown) => error);
        expect((failure as Error).name).not.toBe("AgentActionCertainFailureError");
    });

    it("fails closed when the provider-bound retry target drifts after revalidation", async () => {
        const source = terminalJob();
        const { repository, delivery, capabilities } = setup(source);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: source.id });
        await expect(capability.revalidate!(context, { jobId: source.id }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: true }));
        source.payload.messageBody = "변경된 승인 이후 본문";

        await expect(capability.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: source.id })).rejects.toThrow("changed after approval");
        expect(repository.upsertPending).not.toHaveBeenCalled();
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("binds ActionCoordinator approval through staged retry dispatch to the real Aligo use case", async () => {
        const source = terminalJob();
        let stagedRetry: MessageTriggerJobEntity | undefined;
        const repository = {
            findByIdInBranch: jest.fn().mockImplementation(async (_branchId: string, id: string) => id === "job-a" ? source : stagedRetry),
            findHistoryByBranch: jest.fn().mockResolvedValue([]),
            upsertPending: jest.fn().mockImplementation(async (candidate: MessageTriggerJobEntity) => {
                stagedRetry = Object.assign(candidate, { id: "retry-job" });
                return stagedRetry;
            }),
            claimProviderRejectedForRetry: jest.fn().mockImplementation(async (_branchId: string, _sourceJobId: string, _version: string, _snapshotHash: string, _source: MessageTriggerJobEntity, candidate: MessageTriggerJobEntity) => {
                stagedRetry = Object.assign(candidate, { id: "retry-job" });
                return { kind: "claimed", job: stagedRetry };
            }),
            claimPendingWithRuleFence: jest.fn().mockImplementation(async (id: string) => id === stagedRetry?.id ? "claim-a" : null),
            update: jest.fn().mockResolvedValue(undefined),
            findSentTriggerJobIdsSystemScope: jest.fn().mockResolvedValue(new Set<string>()),
        };
        const providerApi = {
            sendSms: jest.fn().mockResolvedValue({
                result_code: 1,
                message: "성공",
                msg_id: 99,
                success_cnt: 1,
                error_cnt: 0,
            }),
        };
        const aligoService = new AligoService(new SendAligoSmsUsecase(providerApi as never));
        const systemTemplateService = {
            getByKey: jest.fn().mockImplementation(async (templateKey: string) => ({
                id: `template-${templateKey}`,
                templateKey,
                content: "안내",
                requiredVariables: [],
                customVariables: [],
                updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            })),
        };
        const smsDelivery = new SmsTriggerDeliveryService(
            aligoService,
            systemTemplateService as never,
            { save: jest.fn().mockImplementation(async (log: unknown) => log) } as never,
        undefined, undefined, createLegacyAutomationDeliveryGate());
        const triggerDelivery = new MessageTriggerDeliveryService(smsDelivery);
        const senderApproval = {
            getApprovedBranchIds: jest.fn().mockResolvedValue(new Set([principal.branchId])),
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        const triggerService = new MessageTriggerService(
            {
                $transaction: jest.fn().mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) =>
                    work({
                        $queryRaw: jest.fn().mockImplementation(async () => [{
                            status: "processing",
                            claim_token: "claim-a",
                            branch_id: principal.branchId,
                            rule_id: source.ruleId,
                            client_id: source.clientId,
                            employee_schedule_id: source.employeeScheduleId,
                            recipient_type: source.recipientType,
                            template_key: source.templateKey,
                            payload: stagedRetry?.payload ?? source.payload,
                        }]),
                    })),
            } as never,
            triggerDelivery,
            senderApproval as never,
            { findByIdIncludingGlobal: jest.fn().mockResolvedValue(null) } as never,
            repository as never,
            { findSentTriggerJobIdsSystemScope: jest.fn().mockResolvedValue(new Set<string>()), save: jest.fn() } as never,
            systemTemplateService as never,
            {
                runExclusive: jest.fn().mockImplementation(async (
                    _templateKey: string,
                    work: (transaction: unknown) => Promise<unknown>,
                    transaction: unknown,
                ) => work(transaction)),
            } as never,
        undefined, undefined, undefined, undefined, undefined, createLegacyAutomationDeliveryGate({
                $transaction: jest.fn().mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) =>
                    work({
                        $queryRaw: jest.fn().mockImplementation(async () => [{
                            status: "processing",
                            claim_token: "claim-a",
                            branch_id: principal.branchId,
                            rule_id: source.ruleId,
                            client_id: source.clientId,
                            employee_schedule_id: source.employeeScheduleId,
                            recipient_type: source.recipientType,
                            template_key: source.templateKey,
                            payload: stagedRetry?.payload ?? source.payload,
                        }]),
                    })),
            } as never, undefined));
        const recipientPrisma = {
            client: {
                findFirst: jest.fn().mockResolvedValue({ id: 1, name: "테스트 고객", phone: "01012345678" }),
            },
            employee: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const provider = new MessageExternalAgentCapabilitiesProvider(
            recipientPrisma as never,
            triggerService,
            repository as never,
            smsDelivery,
            senderApproval as never,
        );
        const retry = provider.getCapabilities().find((entry) => entry.meta.name === "messages.retrySms")!;
        const actionRecords: { current?: Record<string, any> } = {};
        const actionPrisma = {
            agent_action: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
                    actionRecords.current = {
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        approvedBy: null,
                        approvedAt: null,
                        rejectedBy: null,
                        rejectedAt: null,
                        result: null,
                        error: null,
                        executedAt: null,
                        executionAttemptCount: 0,
                        resultPartPersistedAt: null,
                    };
                    return actionRecords.current;
                }),
                findFirst: jest.fn().mockImplementation(async () => actionRecords.current),
                updateMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
                    if (!actionRecords.current) return { count: 0 };
                    actionRecords.current = { ...actionRecords.current, ...data, updatedAt: new Date() };
                    return { count: 1 };
                }),
            },
        };
        const actionRepository = {
            createInActiveSession: jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
                const action = await actionPrisma.agent_action.create({ data: input });
                return { status: "created", action };
            }),
        };
        const coordinator = new ActionCoordinatorService(
            actionPrisma as never,
            { get: jest.fn().mockReturnValue(retry) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            {
                assertActive: jest.fn().mockResolvedValue(undefined),
                upsertActionResultMessage: jest.fn().mockResolvedValue(true),
            } as never,
            actionRepository as never,
            createSchedulerLeaseMock(),
        );

        const action = await coordinator.propose({
            sessionId: "session-a",
            principal,
            capability: "messages.retrySms",
            input: { jobId: source.id },
            locale: "ko",
        });
        const acknowledgement = coordinator.strongAcknowledgementToken(action);
        await expect(coordinator.approve(action.id, principal, action.proposalRevision, acknowledgement))
            .resolves.toEqual(expect.objectContaining({ action: expect.objectContaining({ status: "succeeded" }) }));

        expect(stagedRetry).toBeDefined();
        expect(stagedRetry?.payload.templateVariables["__smsDeliverySnapshot"]).toBeDefined();
        expect(providerApi.sendSms).toHaveBeenCalledWith(expect.objectContaining({
            receiver: "01012345678",
            message: source.payload.messageBody,
            title: source.payload.templateVariables["title"],
            msgType: "LMS",
            testModeYn: "N",
        }));
    });

    it("binds retry approval details to a masked recipient and exact message snapshot", async () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;

        const inspection = await capability.inspect!(context, { jobId: "job-a" });
        const serialized = JSON.stringify(inspection);

        expect(serialized).not.toContain("01012345678");
        expect(serialized).toContain("••••5678");
        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({
            receiver: "••••5678",
            templateKey: MessageTriggerTemplateKey.INFO,
            messageBody: "실패한 안내 본문",
            title: "실패한 안내 제목",
            deliveryType: "LMS",
        }));
        expect(inspection.summary).toContain("실패한 안내 본문");
        expect(inspection.summary).toContain("실패한 안내 제목");
        expect(inspection.summary).toContain(MessageTriggerTemplateKey.INFO);
        expect(inspection.summary).toContain("LMS");
    });

    it("keeps inspected retry values equivalent to the real SMS delivery request", async () => {
        const { aligoService, capabilities, repository, smsDelivery } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;

        const inspection = await capability.inspect!(context, { jobId: "job-a" });
        const source = await repository.findByIdInBranch(principal.branchId, "job-a");
        await smsDelivery.sendJob(source!);

        const request = aligoService.sendSms.mock.calls[0]?.[0] as {
            receiver: string;
            message: string;
            title: string;
            msgType: string;
        };
        const target = inspection.targetSnapshot!;
        expect(target["receiver"]).toBe("••••5678");
        expect(request.receiver).toBe("01012345678");
        expect(request.message).toBe(target["messageBody"]);
        expect(request.title).toBe(target["title"]);
        expect(aligoService.sendSms).toHaveBeenCalledWith(expect.objectContaining({ msgType: "AUTO" }));
        expect(target["deliveryType"]).toBe("LMS");
    });

    it.each([
        ["recipient", (job: MessageTriggerJobEntity) => { job.recipientPhone = "01099998888"; }],
        ["template key", (job: MessageTriggerJobEntity) => { job.templateKey = MessageTriggerTemplateKey.SERVICE_INFO; }],
        ["message body", (job: MessageTriggerJobEntity) => { job.payload.messageBody = "변경된 본문"; }],
        ["message title", (job: MessageTriggerJobEntity) => { job.payload.templateVariables["title"] = "변경된 제목"; }],
        ["delivery type", (job: MessageTriggerJobEntity) => { job.payload.templateVariables["msgType"] = "LMS"; }],
    ])("invalidates an approved retry when the %s changes", async (_field, mutate) => {
        const source = terminalJob();
        const { repository, capabilities } = setup(source);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: source.id });

        mutate(source);

        await expect(capability.revalidate!(context, { jobId: source.id }, inspection.targetVersion!)).resolves.toEqual(expect.objectContaining({ valid: false }));
        expect(repository.findByIdInBranch).toHaveBeenCalledWith(principal.branchId, source.id);
    });

    it("refuses retry when provider rejection or current-branch ownership cannot be proven", async () => {
        const unsafe = terminalJob({ branchId: "branch-b" });
        unsafe.payload.templateVariables["retrySafety"] = "uncertain";
        const { repository, capabilities } = setup(unsafe);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms");

        await expect(capability!.inspect!(context, { jobId: unsafe.id })).rejects.toThrow("not safely retryable");
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it("binds automation approval to the persisted send time", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const rule = await delivery.getRule(principal.branchId, "rule-a");
        rule.sendTime = "14:37";
        const inspection = await update.inspect!(context, { id: "rule-a", sendTime: "15:42" });
        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({ sendTime: "14:37" }));
        rule.sendTime = "16:00";
        await expect(update.revalidate!(context, { id: "rule-a", sendTime: "15:42" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: false }));
    });

    it("binds automation approval to the persisted target client status and retry-on-failure (규칙 메시지-04)", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const list = capabilities.find((entry) => entry.meta.name === "automation.list")!;
        const rule = await delivery.getRule(principal.branchId, "rule-a");
        rule.targetClientStatus = "waiting";
        rule.retryOnFailure = false;

        const listed = await list.execute(context, {}) as { rules: Array<{ id: string; targetClientStatus: string; retryOnFailure: boolean }> };
        expect(listed.rules.find((entry) => entry.id === "rule-a")).toEqual(expect.objectContaining({ targetClientStatus: "waiting", retryOnFailure: false }));

        const inspection = await update.inspect!(context, { id: "rule-a", name: "새 이름" });
        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({ targetClientStatus: "waiting", retryOnFailure: false }));
        rule.targetClientStatus = "active";
        await expect(update.revalidate!(context, { id: "rule-a", name: "새 이름" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: false }));
        rule.targetClientStatus = "waiting";
        rule.retryOnFailure = true;
        await expect(update.revalidate!(context, { id: "rule-a", name: "새 이름" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: false }));
    });

    it("uses the canonical automation service for branch-scoped lifecycle operations", async () => {
        const { delivery, capabilities } = setup();
        const list = capabilities.find((entry) => entry.meta.name === "automation.list");
        const setActive = capabilities.find((entry) => entry.meta.name === "automation.setActive");

        const listed = await list!.execute(context, {}) as { rules: Array<{ id: string }> };
        const inspection = await setActive!.inspect!(context, { id: "rule-a", isActive: false });
        const updated = await setActive!.execute(context, { id: "rule-a", isActive: false }) as { isActive: boolean };

        expect(delivery.listRulesReadOnly).toHaveBeenCalledWith(principal.branchId);
        expect(delivery.listRules).not.toHaveBeenCalled();
        expect(listed.rules).toEqual([expect.objectContaining({ id: "rule-a" })]);
        expect(inspection.targetVersion).toHaveLength(64);
        expect(setActive!.meta.approvalPolicy).toBe("strong");
        expect(delivery.updateRule).toHaveBeenCalledWith(principal.branchId, "rule-a", { isActive: false });
        expect(updated.isActive).toBe(false);
    });

    it.each([
        ["invalid recipient", { recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE }, "Invalid recipient for selected event type"],
        ["invalid offset", { offsetType: MessageTriggerOffsetType.IMMEDIATE }, "Invalid offset type for selected event type"],
        ["non-positive offset days", { offsetDays: 0 }, "Offset days must be greater than 0"],
        ["retired employee-assigned template", { templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED }, "SMS 발송 채널이 없는 템플릿입니다."],
        ["retired service-start template", { templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER }, "SMS 발송 채널이 없는 템플릿입니다."],
    ] as Array<[string, Record<string, unknown>, string]>)
    ("rejects %s during automation creation inspection", async (_label, overrides, message) => {
        const { prisma, delivery, capabilities } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "automation.create")!;
        const input = {
            name: "서비스 시작 알림",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            ...overrides,
        };

        await expect(create.inspect!(context, input)).rejects.toThrow(message);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(delivery.createRule).not.toHaveBeenCalled();
    });

    it.each([
        ["invalid recipient", { recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE }, "Invalid recipient for selected event type"],
        ["invalid offset", { offsetType: MessageTriggerOffsetType.IMMEDIATE }, "Invalid offset type for selected event type"],
        ["non-positive offset days", { offsetDays: 0 }, "Offset days must be greater than 0"],
        ["retired employee-assigned template", { templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED }, "SMS 발송 채널이 없는 템플릿입니다."],
        ["retired service-start template", { templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER }, "SMS 발송 채널이 없는 템플릿입니다."],
    ] as Array<[string, Record<string, unknown>, string]>)
    ("rejects %s during merged automation update inspection", async (_label, overrides, message) => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const input = { id: "rule-a", ...overrides };

        await expect(update.inspect!(context, input)).rejects.toThrow(message);
        expect(delivery.updateRule).not.toHaveBeenCalled();
    });

    it("classifies invalid automation creation as certain before starting a transaction", async () => {
        const { prisma, delivery, capabilities } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "automation.create")!;
        const input = {
            name: "서비스 시작 알림",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 0,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        };

        await expect(create.execute(context, input)).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
        expect(delivery.createRule).not.toHaveBeenCalled();
    });

    it("classifies invalid automation updates as certain before the canonical write", async () => {
        const { prisma, delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const input = { id: "rule-a", templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED };

        await expect(update.execute(context, input)).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
        expect(delivery.updateRule).not.toHaveBeenCalled();
    });

    it("routes versioned automation mutations through approved-target CAS hooks", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const remove = capabilities.find((entry) => entry.meta.name === "automation.delete")!;
        const inspection = await update.inspect!(context, { id: "rule-a", name: "승인된 규칙" });
        const approvedContext = {
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        };

        await expect(update.executeApprovedTarget!(approvedContext, { id: "rule-a", name: "승인된 규칙" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ status: "updated", id: "rule-a" }));
        expect(delivery.updateRuleApprovedTarget).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "승인된 규칙" },
            inspection.targetVersion,
            inspection.targetSnapshot,
        );

        const deleteInspection = await remove.inspect!(context, { id: "rule-a" });
        await expect(remove.executeApprovedTarget!(
            { ...context, approvedTargetSnapshot: deleteInspection.targetSnapshot },
            { id: "rule-a" },
            deleteInspection.targetVersion!,
        )).resolves.toEqual({ status: "deleted", id: "rule-a" });
        expect(delivery.deleteRuleApprovedTarget).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            deleteInspection.targetVersion,
            deleteInspection.targetSnapshot,
        );
    });

    it("reconciles automation creation only through its exact action receipt", async () => {
        const { delivery, prisma, capabilities } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "automation.create")!;
        const input = {
            name: "시작 알림",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        };

        await expect(create.execute(context, input)).resolves.toEqual({ status: "created", id: "rule-a", isActive: true });
        await expect(create.reconcile!(context, input, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "created", id: "rule-a", isActive: true },
        });

        expect(delivery.createRule).toHaveBeenCalledWith(principal.branchId, { ...input, sendTime: "09:00" }, expect.objectContaining({ agent_action: expect.any(Object) }));
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: context.actionId, capability: "automation.create" }),
        }));
        expect(delivery.listRules).not.toHaveBeenCalled();
    });

    it("does not report an automation rule when its action receipt cannot be persisted", async () => {
        const { delivery, prisma, capabilities } = setup();
        prisma.agent_action.updateMany.mockResolvedValue({ count: 0 });
        const create = capabilities.find((entry) => entry.meta.name === "automation.create")!;
        const input = {
            name: "시작 알림",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        };

        await expect(create.execute(context, input)).rejects.toThrow("receipt could not be persisted");
        expect(delivery.createRule).toHaveBeenCalledWith(principal.branchId, { ...input, sendTime: "09:00" }, expect.objectContaining({ agent_action: expect.any(Object) }));
    });

    it("rejects id-only automation updates before the canonical service is called", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;

        expect(update.inputSchema.safeParse({ id: "rule-a" }).success).toBe(false);
        await expect(update.execute(context, { id: "rule-a" })).rejects.toThrow();
        expect(delivery.updateRule).not.toHaveBeenCalled();
    });

    it("classifies a scheduled SMS that becomes too near as a certain pre-effect failure", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
        try {
            const { repository, capabilities } = setup();
            const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
            const input = { receiver: "01012345678", message: "안내", scheduledDate: "2026-08-03", scheduledTime: "09:15" };
            expect(schedule.inputSchema.safeParse(input).success).toBe(true);

            jest.setSystemTime(new Date("2026-08-03T00:06:00.000Z"));
            await expect(schedule.execute(context, input)).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
            expect(repository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("provides recoverable form fields for every automation mutation", () => {
        const { capabilities } = setup();

        for (const name of ["automation.create", "automation.update", "automation.setActive", "automation.delete"]) {
            const capability = capabilities.find((entry) => entry.meta.name === name);
            expect(capability?.formFields?.length).toBeGreaterThan(0);
        }
    });

    it("keeps automation deletion uncertain on operational lookup failures", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.delete")!;
        delivery.getRule.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(capability.reconcile!(context, { id: "rule-a" }, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule lookup failed",
        });

        delivery.getRule.mockRejectedValueOnce(new NotFoundException("missing"));
        await expect(capability.reconcile!(context, { id: "rule-a" }, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "deleted", id: "rule-a" },
        });
    });

    it("keeps automation update reconciliation uncertain on lookup failures", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const input = { id: "rule-a", name: "변경된 규칙" };
        delivery.getRule.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(capability.reconcile!(context, input, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule lookup failed",
        });

        delivery.getRule.mockRejectedValueOnce(new NotFoundException("missing"));
        await expect(capability.reconcile!(context, input, null)).resolves.toEqual({
            status: "failed",
            reason: "Automation rule no longer exists",
        });
    });

    it("does not reconcile automation success until job fencing and rebuild complete", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        delivery.isRuleMutationComplete.mockResolvedValue(false);

        await expect(capability.reconcile!(context, { id: "rule-a", name: "시작 알림" }, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule jobs have not completed fencing and rebuild",
        });
        expect(delivery.isRuleMutationComplete).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "시작 알림" },
        );
    });

    it("reconciles a rebuilt pending automation before delivery", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        delivery.isRuleMutationComplete.mockResolvedValue(true);

        await expect(capability.reconcile!(context, { id: "rule-a", name: "시작 알림" }, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "updated", id: "rule-a", isActive: true },
        });

        expect(delivery.isRuleMutationComplete).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "시작 알림" },
        );
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("keeps synthetic ad-hoc SMS rules inactive", async () => {
        const { prisma, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await capability.execute(context, { receiver: "01012345678", message: "안내" });

        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ isActive: false }),
            update: { isActive: false },
        }));
    });

    describe("synthetic ad-hoc SMS holder rule writes", () => {
        const run = async (stored: { isActive: boolean } | null) => {
            const { prisma, capabilities } = setup();
            prisma.message_trigger_rule.findFirst.mockResolvedValue(stored);
            const capability = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;
            await capability.execute(context, { receiver: "01012345678", message: "안내" });
            return prisma;
        };

        it("does not write the holder rule when it already exists and is inactive", async () => {
            const prisma = await run({ isActive: false });

            expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        });

        it("writes the holder rule once when it is missing, reading it branch-pinned first", async () => {
            const prisma = await run(null);

            expect(prisma.message_trigger_rule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ branchId: expect.any(String) }),
            }));
            expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledTimes(1);
        });

        it("forces the holder rule back to inactive once when it exists but is active", async () => {
            const prisma = await run({ isActive: true });

            expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledTimes(1);
            expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith(expect.objectContaining({
                update: { isActive: false },
            }));
        });
    });
});
