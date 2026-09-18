import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { CapabilityRegistryService } from "../../../application/agent/capability-registry.service";
import { agentBindingHash, agentLinkedProposalRevision } from "../../../domain/repositories/agent-linked-action.types";
import { createAgentAutomationQuestion, answerAgentAutomationQuestion } from "../../../application/agent/agent-automation-question";
import { parseTaskAutomationArtifact, TASK_AUTOMATION_ARTIFACT_KEY, taskAutomationPublicSummary } from "../../../application/agent/agent-task-automation-artifact";
import { clientAgentTargetVersion } from "../../../application/usecases/client/client-agent-target";
import { SmsTriggerDeliveryService } from "../../../application/services/sms-trigger-delivery.service";
import { AgentAutomationJobAuthorityService } from "../../../application/services/agent-automation-job-authority.service";
import { MessageAutomationIntentService } from "../../../application/services/message-automation-intent.service";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload, type MessageTriggerJobStatus } from "../../../domain/entities/message-trigger-job.entity";
import { ClientAutomationImpactService } from "../../../application/services/client-automation-impact.service";
import { CLIENT_AUTOMATION_IMPACT } from "../../../domain/ports/client-automation-impact.port";
import { SERVICE_RECORD_LINK_RULE_ID } from "../../../domain/constants/service-record-link-message";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "../../../domain/constants/message-automation-intent";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "../../../domain/constants/message-trigger-catalog";
import { DEFAULT_CLIENT_GREETING_TRIGGER, DEFAULT_SERVICE_INFO_TRIGGER } from "../../../application/services/message-trigger-defaults";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "7d000000-0000-4000-8000-000000000001";
const userId = "7d000000-0000-4000-8000-000000000002";
const clientId = 971500001;
const employeeId = 31221;
const scheduleId = 971500011;
const caseId = "7d000000-0000-4000-8000-000000000004";
const parentPolicyKey = `branch:${branchId}:message_policy:trigger-dispatch:enabled`;
const serviceStart = new Date("2026-10-01T00:00:00.000Z");
const serviceEnd = new Date("2026-10-15T00:00:00.000Z");

describeAgentE2E("production service-record-link task effect planner", () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let previousBaseUrl: string | undefined;

    async function cleanup() {
        if (!prisma) return;
        await prisma.agent_action.deleteMany({ where: { branchId } });
        await prisma.agent_task_event.deleteMany({ where: { branchId } });
        await prisma.agent_task.deleteMany({ where: { branchId } });
        await prisma.agent_session.deleteMany({ where: { branchId } });
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.message_log.deleteMany({ where: { branchId } });
        await prisma.service_record_token.deleteMany({ where: { branchId } });
        await prisma.service_record_case.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId } });
        await prisma.employee_schedule.deleteMany({ where: { branchId } });
        await prisma.client.deleteMany({ where: { id: clientId, branchId } });
        await prisma.employee.deleteMany({ where: { id: employeeId, branchId } });
        await prisma.system_setting.deleteMany({ where: { key: parentPolicyKey } });
        await prisma.user.deleteMany({ where: { id: userId } });
        await prisma.message_trigger_rule.deleteMany({ where: { id: SERVICE_RECORD_LINK_RULE_ID } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        previousBaseUrl = process.env["MOBILE_SERVICE_RECORD_BASE_URL"];
        process.env["MOBILE_SERVICE_RECORD_BASE_URL"] = "https://m.admin.babyjamjam.com";
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.user.create({ data: { id: userId, email: "agent-task-service-record-link@example.invalid", role: "admin", approvalStatus: "approved" } });
        await prisma.branch.create({ data: {
            id: branchId,
            name: "합성 제공기록지 task 지점",
            slug: "agent-task-service-record-link-e2e",
            isActive: true,
            smsSenderApprovalStatus: "approved",
            smsSenderApprovalApprovedAt: new Date("2026-09-17T00:00:00.000Z"),
        } });
        await prisma.system_setting.create({ data: { key: parentPolicyKey, value: "true" } });
        await prisma.client.create({ data: {
            id: clientId,
            branchId,
            name: "합성 고객",
            phone: "01000000501",
            phoneNormalized: "01000000501",
            voucherClient: false,
            serviceStatus: "pre_booking",
            startDate: serviceStart,
            endDate: serviceEnd,
        } });
        await prisma.employee.create({ data: {
            id: employeeId,
            branchId,
            name: "합성 담당자",
            phone: "01000000511",
            phoneNormalized: "01000000511",
            workArea: [],
            grade: "test",
        } });
        await prisma.employee_schedule.create({ data: {
            id: scheduleId,
            branchId,
            clientId,
            primaryEmployeeId: employeeId,
            workAddress: "합성 일정 주소",
            startDate: serviceStart,
            endDate: serviceEnd,
        } });
        await prisma.service_record_case.create({ data: {
            id: caseId,
            branchId,
            clientId,
            status: "IN_PROGRESS",
            startDate: serviceStart,
            endDate: serviceEnd,
            requiredSessionCount: 10,
            formVersion: 1,
            version: 1,
        } });
        await prisma.service_record_token.create({ data: {
            branchId,
            scheduleId,
            employeeId,
            serviceRecordCaseId: caseId,
            linkTokenHash: "efl_task_source_token",
            expectedPhoneHash: createHash("sha256").update("01000000511").digest("hex"),
            expiresAt: new Date("2026-10-22T11:00:00.000Z"),
            active: true,
        } });
        await prisma.message_trigger_rule.createMany({ data: [
            { id: "task-service-info-default", branchId, name: DEFAULT_SERVICE_INFO_TRIGGER.name,
                isActive: true, eventType: DEFAULT_SERVICE_INFO_TRIGGER.eventType, offsetType: DEFAULT_SERVICE_INFO_TRIGGER.offsetType,
                offsetDays: DEFAULT_SERVICE_INFO_TRIGGER.offsetDays ?? 0, sendTime: "09:00",
                recipientType: DEFAULT_SERVICE_INFO_TRIGGER.recipientType, templateKey: DEFAULT_SERVICE_INFO_TRIGGER.templateKey, isDefault: true },
            { id: "task-client-greeting-default", branchId, name: DEFAULT_CLIENT_GREETING_TRIGGER.name,
                isActive: true, eventType: DEFAULT_CLIENT_GREETING_TRIGGER.eventType, offsetType: DEFAULT_CLIENT_GREETING_TRIGGER.offsetType,
                offsetDays: DEFAULT_CLIENT_GREETING_TRIGGER.offsetDays ?? 0, sendTime: "09:00",
                recipientType: DEFAULT_CLIENT_GREETING_TRIGGER.recipientType, templateKey: DEFAULT_CLIENT_GREETING_TRIGGER.templateKey, isDefault: true },
        ] });
        await prisma.message_trigger_rule.create({ data: {
            id: SERVICE_RECORD_LINK_RULE_ID,
            branchId: null,
            name: "제공기록지 링크",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            sendTime: "15:00",
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            isDefault: false,
        } });

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentModelFactory)
            .useValue({ modelId: "unused-service-record-planner-proof", create: jest.fn(() => { throw new Error("No model call is allowed in service-record planner proof"); }) })
            .compile();
        app = moduleRef.createNestApplication();
        await app.init();
    }, 30_000);

    afterAll(async () => {
        await app?.close();
        if (prisma) {
            await cleanup();
            await prisma.$disconnect();
        }
        if (previousBaseUrl === undefined) delete process.env["MOBILE_SERVICE_RECORD_BASE_URL"];
        else process.env["MOBILE_SERVICE_RECORD_BASE_URL"] = previousBaseUrl;
    }, 30_000);

    it("emits a digest-only service-record-link effect from the real planner", async () => {
        const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
        const result = await tenantContextStore.run({ origin: "http", branchId }, () => planner.planClientWrite(branchId, {
            kind: "update",
            clientId,
            values: { name: "정정 합성 고객" },
        }));
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId, change: "create" }),
        ]));
        expect(JSON.stringify(result)).not.toContain("efl_task_source_token");
        expect(JSON.stringify(result)).not.toContain("01000000511");
        expect(await prisma.message_trigger_job.count({ where: { branchId } })).toBe(0);
        expect(await prisma.message_log.count({ where: { branchId } })).toBe(0);
    });

    it("represents a missing token as an unavailable service-record scope", async () => {
        await prisma.service_record_token.deleteMany({ where: { branchId, scheduleId } });
        try {
            const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
            const result = await tenantContextStore.run({ origin: "http", branchId }, () => planner.planClientWrite(branchId, {
                kind: "update", clientId, values: { name: "토큰 발급 전 정정 고객" },
            }));
            expect(result).toMatchObject({ availability: "unavailable", reason: "source-unavailable", complete: true });
            expect(result.effects).toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId, change: "create" }),
            ]));
            expect(JSON.stringify(result)).not.toContain("01000000511");
            expect(await prisma.message_trigger_job.count({ where: { branchId } })).toBe(0);
        } finally {
            await prisma.service_record_token.create({ data: {
                branchId,
                scheduleId,
                employeeId,
                serviceRecordCaseId: caseId,
                linkTokenHash: "efl_task_source_token",
                expectedPhoneHash: createHash("sha256").update("01000000511").digest("hex"),
                expiresAt: new Date("2026-10-22T11:00:00.000Z"),
                active: true,
            } });
        }
    });

    it("represents a missing system rule as an unavailable service-record scope", async () => {
        await prisma.message_trigger_rule.delete({ where: { id: SERVICE_RECORD_LINK_RULE_ID } });
        try {
            const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
            const result = await tenantContextStore.run({ origin: "http", branchId }, () => planner.planClientWrite(branchId, {
                kind: "update", clientId, values: { name: "규칙 복구 전 정정 고객" },
            }));
            expect(result).toMatchObject({ availability: "unavailable", reason: "source-unavailable", complete: true });
            expect(result.effects).toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId, change: "create" }),
            ]));
            expect(JSON.stringify(result)).not.toContain("efl_task_source_token");
            expect(JSON.stringify(result)).not.toContain("01000000511");
        } finally {
            await prisma.message_trigger_rule.create({ data: {
                id: SERVICE_RECORD_LINK_RULE_ID,
                branchId: null,
                name: "제공기록지 링크",
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                sendTime: "15:00",
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                isDefault: false,
            } });
        }
    });

    it("carries the real task planner through commit, intent fulfillment, job and authority", async () => {
        const registry = app.get(CapabilityRegistryService);
        const capability = registry.get("clients.update");
        const existing = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        const targetVersion = clientAgentTargetVersion(existing as never);
        const sessionId = randomUUID();
        const taskId = randomUUID();
        const actionId = randomUUID();
        const nextName = "실제 task 정정 고객";
        const principal = { userId, branchId, globalRole: "admin", branchRole: "admin" } as const;
        const contextBase = { principal, sessionId, traceId: randomUUID(), locale: "ko" } as const;
        const input = { id: clientId, name: nextName, targetVersion };
        const canonicalInput = capability.canonicalizeInput
            ? await capability.canonicalizeInput(contextBase as never, input)
            : input;
        const impact = await capability.planAutomationImpact!(contextBase as never, canonicalInput, taskId);
        expect(impact.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId, change: "create" }),
        ]));

        const question = createAgentAutomationQuestion(impact);
        const answer = answerAgentAutomationQuestion({
            presented: question,
            current: question,
            choice: "yes",
            noSend: false,
            clientEventId: randomUUID(),
        });
        if (answer.status !== "accepted") throw new Error("The synthetic positive consent was not accepted");
        const artifact = parseTaskAutomationArtifact({
            version: 1,
            actionId,
            taskId,
            taskRevision: 1,
            sessionId,
            userId,
            branchId,
            capability: "clients.update",
            inputHash: agentBindingHash(canonicalInput),
            targetClientId: clientId,
            targetVersion,
            question,
            consent: answer.consent,
            noSend: false,
            impact: { ...impact, grandfatheredEffects: impact.grandfatheredEffects ?? [] },
        });
        if (!artifact) throw new Error("The production planner artifact did not parse");
        const proposal = {
            input: canonicalInput,
            automation: taskAutomationPublicSummary(artifact),
            [TASK_AUTOMATION_ARTIFACT_KEY]: artifact,
        };
        const actionLike = {
            capability: "clients.update",
            capabilityVersion: capability.meta.version,
            risk: "external-side-effect" as const,
            proposal,
        };
        const expiresAt = new Date("2099-01-01T00:00:00.000Z");
        await prisma.agent_session.create({ data: {
            id: sessionId, userId, branchId, model: "synthetic", agentVersion: "phase7", expiresAt,
        } });
        await prisma.agent_task.create({ data: {
            id: taskId, sessionId, userId, branchId, capabilityId: "clients.update", revision: 1,
            status: "executing", draft: {}, targetRef: { clientId }, targetVersion, activeActionId: actionId, expiresAt,
        } });
        await prisma.agent_action.create({ data: {
            id: actionId,
            sessionId,
            userId,
            branchId,
            taskId,
            taskRevision: 1,
            capability: "clients.update",
            capabilityVersion: capability.meta.version,
            risk: "external-side-effect",
            status: "executing",
            inputHash: artifact.inputHash,
            proposal: proposal as unknown as Prisma.InputJsonValue,
            proposalRevision: agentLinkedProposalRevision(taskId, 1, actionLike),
            targetVersion,
            targetSnapshot: { id: clientId, name: existing.name } as unknown as Prisma.InputJsonValue,
            authorizationContext: { approvalPolicy: "strong" } as unknown as Prisma.InputJsonValue,
            expiresAt,
            idempotencyKey: randomUUID(),
            requestDedupeKey: randomUUID(),
            dedupeExpiresAt: expiresAt,
        } });

        const result = await capability.executeApprovedTarget!(
            { ...contextBase, actionId, taskAutomation: artifact } as never,
            { id: clientId, name: nextName },
            targetVersion,
        );
        expect(result).toEqual({ id: clientId, name: nextName, status: "updated" });

        const intent = await prisma.message_trigger_job.findFirstOrThrow({
            where: { branchId, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, employeeScheduleId: scheduleId },
        });
        const intentPayload = intent.payload as Record<string, unknown>;
        const intentVariables = intentPayload["templateVariables"] as Record<string, unknown>;
        const taskReference = intentPayload["taskAutomationReference"] ?? intentVariables["taskAutomationReference"];
        expect(taskReference).toBeTruthy();
        expect(JSON.stringify(intentPayload)).not.toContain("01000000511");
        expect(JSON.stringify(intentPayload)).not.toContain("efl_task_source_token");

        const intentService = app.get(MessageAutomationIntentService);
        await intentService.fulfillScheduleIntent({ branchId, scheduleId, includePast: true, replaceExisting: true,
            taskAutomationReference: taskReference as never });
        const row = await prisma.message_trigger_job.findFirstOrThrow({
            where: { branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID, employeeScheduleId: scheduleId },
        });
        expect((row.payload as Record<string, unknown>)["taskAutomationReference"]).toEqual(taskReference);

        const delivery = app.get(SmsTriggerDeliveryService);
        const authority = app.get(AgentAutomationJobAuthorityService);
        const job = MessageTriggerJobEntity.reconstitute(
            row.id, row.branchId, row.ruleId, row.status as MessageTriggerJobStatus, row.scheduledFor,
            row.sentAt, row.canceledAt, row.cancelReason, row.clientId, row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType, row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey, row.dedupeKey,
            row.payload as unknown as MessageTriggerJobPayload, row.createdAt, row.updatedAt,
            row.attempts, row.nextAttemptAt, row.claimToken,
        );
        const allowed = await tenantContextStore.run({ origin: "http", branchId }, () => prisma.$transaction((tx) => authority.checkAutomaticJob(
            tx,
            job,
            "materialize",
            (candidate, transaction) => delivery.resolveCanonicalDeliverySnapshot(candidate, transaction),
        )));
        expect(allowed.status).toBe("allowed");
        expect(await prisma.message_log.count({ where: { branchId } })).toBe(0);
    });
});
