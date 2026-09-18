import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, agentAutomationRecordDigest,
    agentAutomationScheduleIdentity } from "../../../application/agent/agent-automation-consent";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope } from "../../../application/agent/agent-automation-coverage";
import { createAgentAutomationTerminalRecord, agentAutomationRecordKey, type AgentAutomationTaskCommit } from "../../../application/agent/agent-automation-terminal-record";
import { agentAutomationTaskCommitReference } from "../../../application/agent/agent-automation-record-store.service";
import { AgentAutomationJobAuthorityService, type CanonicalAutomationRenderer } from "../../../application/services/agent-automation-job-authority.service";
import { AligoDefaultSenderPolicyService } from "../../../application/services/aligo-default-sender-policy.service";
import { AligoService } from "../../../application/services/aligo.service";
import { ClientAutomationSourceReader } from "../../../application/services/client-automation-source.reader";
import { buildEmployeeAssignmentMessageEffect } from "../../../application/services/employee-assignment-message-effect-recipe";
import { buildEmployeeAssignmentMessageRecipe } from "../../../application/services/message-trigger-recipes";
import type { SmsTriggerDeliverySnapshot } from "../../../application/services/sms-trigger-delivery.service";
import { AgentAutomationScope, AgentAutomationAuthority, AgentAutomationCoverage } from "../../../domain/entities/agent-automation-consent";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload, type MessageTriggerJobStatus } from "../../../domain/entities/message-trigger-job.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "../../../domain/constants/message-trigger-catalog";
import { AGENT_AUTOMATION_RECORD_CANCEL_REASON, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "../../../domain/constants/agent-automation-storage";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "../../../domain/constants/message-automation-intent";
import { agentBindingHash } from "../../../domain/repositories/agent-linked-action.types";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "7c000000-0000-4000-8000-000000000001";
const clientId = 971400001;
const scheduleId = 971400011;
const primaryEmployeeId = 31211;
const secondaryEmployeeId = 31212;
const replacementEmployeeId = 31213;
const ruleId = "employee-authority-rule";
const parentPolicyKey = `branch:${branchId}:message_policy:trigger-dispatch:enabled`;
const materializationTime = new Date("2026-09-18T00:00:00.000Z");

const fakeSnapshot: SmsTriggerDeliverySnapshot = {
    templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
    receiver: "01000000311",
    maskedReceiver: "010****0311",
    recipientName: "합성 담당자",
    message: "합성 직원 배정 안내",
    title: "직원 배정 안내",
    requestedDeliveryType: "AUTO",
    deliveryType: "LMS",
    estimatedCost: "1",
    templateVersion: "synthetic-template-v1",
    templateHash: "b".repeat(64),
    configVersion: "synthetic-config-v1",
    configHash: "c".repeat(64),
    snapshotHash: "d".repeat(64),
};

describeAgentE2E("employee-assignment automation authority adapter", () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let adapter: AgentAutomationJobAuthorityService;
    let render: jest.MockedFunction<CanonicalAutomationRenderer>;
    let sendSms: jest.SpyInstance;
    let deliveryJobId: string;
    let deliveryJob: MessageTriggerJobEntity;

    async function cleanup() {
        if (!prisma) return;
        await prisma.message_log.deleteMany({ where: { branchId } });
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId } });
        await prisma.employee_schedule.deleteMany({ where: { branchId } });
        await prisma.client.deleteMany({ where: { id: clientId, branchId } });
        await prisma.employee.deleteMany({ where: { branchId, id: { in: [primaryEmployeeId, secondaryEmployeeId, replacementEmployeeId] } } });
        await prisma.system_setting.deleteMany({ where: { key: parentPolicyKey } });
        await prisma.message_trigger_rule.deleteMany({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
    }

    async function readDeliveryJob(): Promise<MessageTriggerJobEntity> {
        const row = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: deliveryJobId } });
        return MessageTriggerJobEntity.reconstitute(
            row.id,
            row.branchId,
            row.ruleId,
            row.status as MessageTriggerJobStatus,
            row.scheduledFor,
            row.sentAt,
            row.canceledAt,
            row.cancelReason,
            row.clientId,
            row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType,
            row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey,
            row.dedupeKey,
            row.payload as unknown as MessageTriggerJobPayload,
            row.createdAt,
            row.updatedAt,
            row.attempts,
            row.nextAttemptAt,
            row.claimToken,
        );
    }

    async function check(mode: "materialize" | "dispatch", preparedSnapshotHash?: string) {
        deliveryJob = await readDeliveryJob();
        return prisma.$transaction((tx) => adapter.checkAutomaticJob(tx, deliveryJob, mode, render, preparedSnapshotHash));
    }

    async function persistSeal(seal: NonNullable<Extract<Awaited<ReturnType<typeof check>>, { status: "allowed" }>["seal"]>) {
        const payload = { ...deliveryJob.payload, agentAutomationSeal: seal };
        await prisma.message_trigger_job.update({ where: { id: deliveryJobId }, data: { payload: payload as unknown as Prisma.InputJsonValue } });
    }

    async function seedAuthority() {
        const sources = app.get(ClientAutomationSourceReader);
        const settings = await sources.readClientAutomationSettings(branchId);
        if (settings.status !== "available") throw new Error("Missing synthetic automation settings");
        const rule = settings.rules.find(({ id, branchId: owner }) => id === ruleId && owner === branchId);
        const schedules = await sources.readClientAutomationSchedules(branchId, clientId);
        const schedule = schedules.find(({ id }) => id === scheduleId);
        const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        if (!rule || !schedule) throw new Error("Missing synthetic employee assignment source");
        const recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, materializationTime);
        if (!recipe) throw new Error("Missing synthetic employee assignment recipe");
        const sender = app.get(AligoDefaultSenderPolicyService).read();
        if (sender.availability !== "available") throw new Error("Missing synthetic sender policy");
        const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: client.createdAt.toISOString() });
        const scheduleIdentity = agentAutomationScheduleIdentity(schedule.incarnationId);
        const effect = buildEmployeeAssignmentMessageEffect({
            branchId,
            subject: { kind: "client", clientId, clientIdentity },
            rule,
            schedule,
            scheduleIdentity,
            recipe,
            snapshot: fakeSnapshot,
            change: "create",
            policy: {
                dispatchEnabled: settings.dispatchEnabled,
                senderApproved: settings.senderApproved,
                senderIdentityDigest: sender.identityDigest,
                senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
                pastTriggerEnabled: settings.pastTriggerEnabled,
                pastTriggerConfig: settings.pastTriggerConfig,
            },
        });
        if (!effect) throw new Error("Missing synthetic employee assignment effect");

        const scope: AgentAutomationScope = {
            branchId,
            clientId,
            clientIdentity,
            kind: "employee-assignment",
            ruleId,
            scheduleId,
            scheduleIdentity,
            recipientType: "primary-employee",
        };
        const origin = {
            kind: "task" as const,
            userId: randomUUID(),
            actionId: randomUUID(),
            taskId: randomUUID(),
            taskRevision: 1,
            consentEventId: randomUUID(),
        };
        const recordedAt = new Date("2026-09-18T01:00:00.000Z").toISOString();
        const mutationDigest = agentBindingHash({ kind: "synthetic-employee-authority", scope, source: recipe.payload });
        const coverage: AgentAutomationCoverage = {
            kind: "coverage",
            version: 1,
            id: randomUUID(),
            scope: agentAutomationCoverageScope(scope),
            sequence: 1,
            previousId: null,
            origin,
            mutationDigest,
            grandfatheredScopes: [],
            recordedAt,
            recordDigest: "",
        };
        coverage.recordDigest = agentAutomationCoverageRecordDigest(coverage);
        const authority: AgentAutomationAuthority = {
            version: 1,
            id: randomUUID(),
            scope,
            sequence: 1,
            previousId: null,
            origin,
            decision: "allow",
            noSend: false,
            effects: [effect],
            scopeEffectDigest: agentAutomationEffectDigest([effect]),
            reviewedEffectDigest: agentAutomationEffectDigest([effect]),
            reviewedPolicyDigest: agentAutomationPolicyDigest([effect]),
            recordedAt,
            recordDigest: "",
        };
        authority.recordDigest = agentAutomationRecordDigest(authority);
        const commit: AgentAutomationTaskCommit = {
            version: 1,
            kind: "task",
            actionId: origin.actionId,
            userId: origin.userId,
            taskId: origin.taskId,
            taskRevision: origin.taskRevision,
            questionRef: randomUUID(),
            inputHash: agentBindingHash({ kind: "synthetic-input", clientId }),
            capability: "clients.update",
            resourceId: clientId,
            receiptDigest: agentBindingHash({ kind: "synthetic-receipt", clientId }),
            recordedAt,
        };
        const taskAutomationReference = agentAutomationTaskCommitReference({
            actionId: origin.actionId,
            taskId: origin.taskId,
            taskRevision: origin.taskRevision,
            batch: { authorities: [authority], coverages: [coverage] },
        });

        deliveryJobId = randomUUID();
        await prisma.$transaction(async (tx) => {
            await tx.message_trigger_job.create({ data: {
                id: deliveryJobId,
                branchId,
                ruleId,
                status: "pending",
                scheduledFor: recipe.scheduledFor,
                clientId,
                employeeScheduleId: scheduleId,
                recipientType: recipe.recipientType,
                recipientPhone: recipe.recipientPhone,
                templateKey: recipe.templateKey,
                dedupeKey: recipe.dedupeKey,
                payload: { ...recipe.payload, taskAutomationReference } as unknown as Prisma.InputJsonValue,
            } });
            for (const record of [coverage, authority]) {
                const terminal = createAgentAutomationTerminalRecord(record, commit);
                await tx.message_trigger_job.create({ data: {
                    id: record.id,
                    branchId,
                    ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    dedupeKey: agentAutomationRecordKey(record),
                    status: "canceled",
                    scheduledFor: new Date(recordedAt),
                    canceledAt: new Date(recordedAt),
                    cancelReason: AGENT_AUTOMATION_RECORD_CANCEL_REASON,
                    clientId: null,
                    employeeScheduleId: null,
                    recipientPhone: null,
                    recipientType: MessageTriggerRecipientType.CLIENT,
                    templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                    nextAttemptAt: null,
                    claimToken: null,
                    attempts: 0,
                    canceledByUser: false,
                    payload: { [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: terminal } as unknown as Prisma.InputJsonValue,
                } });
            }
        });
        deliveryJob = await readDeliveryJob();
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.branch.create({ data: {
            id: branchId,
            name: "합성 직원 권한 지점",
            slug: "agent-task-automation-employee-authority-e2e",
            isActive: true,
            smsSenderApprovalStatus: "approved",
            smsSenderApprovalApprovedAt: new Date("2026-09-17T00:00:00.000Z"),
        } });
        await prisma.system_setting.create({ data: { key: parentPolicyKey, value: "true" } });
        await prisma.client.create({ data: {
            id: clientId,
            branchId,
            name: "합성 고객",
            phone: "01000000301",
            phoneNormalized: "01000000301",
            voucherClient: false,
            serviceStatus: "pre_booking",
            startDate: new Date("2026-10-01T00:00:00.000Z"),
        } });
        await prisma.employee.createMany({ data: [
            { id: primaryEmployeeId, branchId, name: "합성 담당자", phone: "01000000311", phoneNormalized: "01000000311", workArea: [], grade: "test" },
            { id: secondaryEmployeeId, branchId, name: "합성 보조자", phone: "01000000312", phoneNormalized: "01000000312", workArea: [], grade: "test" },
            { id: replacementEmployeeId, branchId, name: "변경 담당자", phone: "01000000313", phoneNormalized: "01000000313", workArea: [], grade: "test" },
        ] });
        await prisma.message_trigger_rule.create({ data: {
            id: ruleId,
            branchId,
            name: "합성 직원 배정 규칙",
            isActive: true,
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            sendTime: "09:00",
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            isDefault: false,
        } });
        await prisma.message_trigger_rule.upsert({
            where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            update: {},
            create: {
                id: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                branchId: null,
                name: "메시지 자동화 생성 복구 표식",
                isActive: false,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: false,
                jobsStale: false,
            },
        });
        await prisma.employee_schedule.create({ data: {
            id: scheduleId,
            branchId,
            clientId,
            primaryEmployeeId,
            secondaryEmployeeId,
            workAddress: "합성 일정 주소",
            startDate: new Date("2026-10-01T00:00:00.000Z"),
            endDate: new Date("2026-10-10T00:00:00.000Z"),
        } });

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentModelFactory)
            .useValue({ modelId: "unused-employee-authority-proof", create: jest.fn(() => { throw new Error("No model call is allowed in employee authority proof"); }) })
            .compile();
        app = moduleRef.createNestApplication();
        await app.init();
        adapter = app.get(AgentAutomationJobAuthorityService);
        render = jest.fn(async (job, transaction) => {
            void job;
            void transaction;
            return fakeSnapshot;
        });
        sendSms = jest.spyOn(app.get(AligoService), "sendSms");
        await seedAuthority();
    }, 30_000);

    beforeEach(() => {
        sendSms?.mockClear();
        render?.mockClear();
    });

    afterAll(async () => {
        sendSms?.mockRestore();
        await app?.close();
        if (prisma) {
            await cleanup();
            await prisma.$disconnect();
        }
    }, 30_000);

    it("allows a matching employee-assignment job through the real AppModule and never sends", async () => {
        const materialize = await tenantContextStore.run({ origin: "http", branchId }, () => check("materialize"));
        expect(materialize.status).toBe("allowed");
        if (materialize.status !== "allowed") throw new Error("Missing employee assignment authority seal");
        await persistSeal(materialize.seal);
        const dispatch = await tenantContextStore.run({ origin: "http", branchId }, () => check("dispatch", fakeSnapshot.snapshotHash));
        expect(dispatch.status).toBe("allowed");
        expect(render).toHaveBeenCalled();
        expect(sendSms).not.toHaveBeenCalled();
        expect(await prisma.message_log.count({ where: { branchId } })).toBe(0);
    });

    it.each([
        ["retimed", { startDate: new Date("2026-10-02T00:00:00.000Z") }],
        ["replaced", { replaced: true }],
        ["terminated", { terminatedAt: new Date("2026-09-20T00:00:00.000Z") }],
        ["employee changed", { primaryEmployeeId: replacementEmployeeId }],
    ] as const)("refuses a %s schedule before provider admission", async (_label, change) => {
        const before = await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } });
        try {
            await prisma.employee_schedule.update({ where: { id: scheduleId }, data: change });
            const result = await tenantContextStore.run({ origin: "http", branchId }, () => check("dispatch", fakeSnapshot.snapshotHash));
            expect(result.status).toBe("refused");
            expect(sendSms).not.toHaveBeenCalled();
        } finally {
            await prisma.employee_schedule.update({ where: { id: scheduleId }, data: {
                startDate: before.startDate,
                endDate: before.endDate,
                replaced: before.replaced,
                terminatedAt: before.terminatedAt,
                primaryEmployeeId: before.primaryEmployeeId,
            } });
        }
    });

    it("refuses a changed recipient scope with the previously issued seal", async () => {
        const baseline = await tenantContextStore.run({ origin: "http", branchId }, () => check("materialize"));
        expect(baseline.status).toBe("allowed");
        if (baseline.status !== "allowed") throw new Error("Missing employee assignment baseline seal");
        await persistSeal(baseline.seal);
        const original = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: deliveryJobId } });
        try {
            await prisma.message_trigger_job.update({ where: { id: deliveryJobId }, data: { recipientType: MessageTriggerRecipientType.SECONDARY_EMPLOYEE } });
            const result = await tenantContextStore.run({ origin: "http", branchId }, () => check("dispatch", fakeSnapshot.snapshotHash));
            expect(result.status).toBe("refused");
            expect(sendSms).not.toHaveBeenCalled();
        } finally {
            await prisma.message_trigger_job.update({ where: { id: deliveryJobId }, data: { recipientType: original.recipientType } });
        }
    });
});
