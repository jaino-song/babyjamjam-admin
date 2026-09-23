import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, agentAutomationRecordDigest } from "../../../application/agent/agent-automation-consent";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope } from "../../../application/agent/agent-automation-coverage";
import { createAgentAutomationTerminalRecord, decodeAgentAutomationTerminalRow, agentAutomationRecordKey, type AgentAutomationTaskCommit } from "../../../application/agent/agent-automation-terminal-record";
import { agentAutomationTaskCommitReference } from "../../../application/agent/agent-automation-record-store.service";
import { AgentAutomationAuthorityService } from "../../../application/agent/agent-automation-authority.service";
import { AgentAutomationJobAuthorityService } from "../../../application/services/agent-automation-job-authority.service";
import { AligoDefaultSenderPolicyService } from "../../../application/services/aligo-default-sender-policy.service";
import { AligoService } from "../../../application/services/aligo.service";
import { ClientAutomationSourceReader } from "../../../application/services/client-automation-source.reader";
import { MessageRetrySchedulerService } from "../../../application/services/message-retry-scheduler.service";
import { SchedulerLeaseService } from "../../../application/services/scheduler-lease.service";
import { buildAutomationRetrySealVariables } from "../../../application/services/automation-retry-seal";
import { buildClientMessageRecipe } from "../../../application/services/message-trigger-recipes";
import { describeClientMessageEffect } from "../../../application/services/client-message-effect-recipe";
import { SmsTriggerDeliveryService } from "../../../application/services/sms-trigger-delivery.service";
import { MESSAGE_LOG_REPOSITORY, type IMessageLogRepository } from "../../../domain/repositories/message-log.repository.interface";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationScope } from "../../../domain/entities/agent-automation-consent";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload, type MessageTriggerJobStatus } from "../../../domain/entities/message-trigger-job.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "../../../domain/constants/message-trigger-catalog";
import { AGENT_AUTOMATION_RECORD_CANCEL_REASON, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY, AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "../../../domain/constants/agent-automation-storage";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "../../../domain/constants/message-automation-intent";
import { agentBindingHash } from "../../../domain/repositories/agent-linked-action.types";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" && process.env["E2E_VENDOR_STUBS"] === "1"
    ? describe
    : describe.skip;

const branchId = "7c000000-0000-4000-8000-000000000701";
const userId = "7c000000-0000-4000-8000-000000000702";
const parentPolicyKey = `branch:${branchId}:message_policy:trigger-dispatch:enabled`;
const materializationTime = new Date("2026-09-18T01:00:00.000Z");
const recordedAt = new Date("2026-09-18T02:00:00.000Z").toISOString();

type ScenarioKind = "allowed" | "stale" | "deny" | "noSend" | "uncertain";

interface RetryScenario {
    kind: ScenarioKind;
    clientId: number;
    ruleId: string;
    jobId: string;
    sessionId: string;
    taskId: string;
    actionId: string;
    taskReference: ReturnType<typeof agentAutomationTaskCommitReference>;
    coverage: AgentAutomationCoverage;
    authority: AgentAutomationAuthority;
    snapshotHash: string;
    snapshotMessage: string;
    snapshotReceiver: string;
    sourceLogId: number;
    sourceVariables: Record<string, string>;
}

function asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

describeAgentE2E("task automation durable retry and recovery", () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let sendSms: jest.SpyInstance;

    async function cleanup(): Promise<void> {
        if (!prisma) return;
        await prisma.message_log.deleteMany({ where: { branchId } });
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.agent_action.deleteMany({ where: { branchId } });
        await prisma.agent_task_event.deleteMany({ where: { branchId } });
        await prisma.agent_task.deleteMany({ where: { branchId } });
        await prisma.agent_session.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId } });
        await prisma.client.deleteMany({ where: { branchId } });
        await prisma.system_setting.deleteMany({ where: { key: parentPolicyKey } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
        await prisma.user.deleteMany({ where: { id: userId } });
    }

    async function readJob(jobId: string): Promise<MessageTriggerJobEntity> {
        const row = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
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

    async function createTaskRows(ids: { sessionId: string; taskId: string; actionId: string }): Promise<void> {
        const expiresAt = new Date("2099-01-01T00:00:00.000Z");
        await prisma.agent_session.create({
            data: {
                id: ids.sessionId,
                userId,
                branchId,
                model: "synthetic",
                agentVersion: "phase7-retry-recovery",
                expiresAt,
            },
        });
        await prisma.agent_task.create({
            data: {
                id: ids.taskId,
                sessionId: ids.sessionId,
                userId,
                branchId,
                capabilityId: "clients.update",
                revision: 1,
                status: "executing",
                draft: {},
                expiresAt,
                activeActionId: ids.actionId,
            },
        });
        await prisma.agent_action.create({
            data: {
                id: ids.actionId,
                sessionId: ids.sessionId,
                userId,
                branchId,
                taskId: ids.taskId,
                taskRevision: 1,
                capability: "clients.update",
                capabilityVersion: "phase7",
                risk: "external-side-effect",
                status: "executing",
                proposal: asJson({ synthetic: true }),
                proposalRevision: agentBindingHash({ kind: "synthetic-proposal", actionId: ids.actionId }),
                inputHash: agentBindingHash({ kind: "synthetic-input", actionId: ids.actionId }),
                authorizationContext: asJson({}),
                expiresAt,
                idempotencyKey: randomUUID(),
                requestDedupeKey: randomUUID(),
                dedupeExpiresAt: expiresAt,
            },
        });
    }

    async function seedScenario(kind: ScenarioKind, clientId: number): Promise<RetryScenario> {
        const ruleId = `agent-retry-recovery-${kind}`;
        const jobId = randomUUID();
        const sessionId = randomUUID();
        const taskId = randomUUID();
        const actionId = randomUUID();
        const clientPhone = `01000000${String(clientId).slice(-3)}`;
        await prisma.client.create({
            data: {
                id: clientId,
                branchId,
                name: `합성 재시도 고객 ${kind}`,
                phone: clientPhone,
                phoneNormalized: clientPhone,
                voucherClient: false,
                serviceStatus: "pre_booking",
                startDate: new Date("2026-10-01T00:00:00.000Z"),
            },
        });
        await prisma.message_trigger_rule.create({
            data: {
                id: ruleId,
                branchId,
                name: `합성 재시도 규칙 ${kind}`,
                isActive: true,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                sendTime: "09:00",
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: false,
            },
        });

        const sourceReader = app.get(ClientAutomationSourceReader);
        const settings = await sourceReader.readClientAutomationSettings(branchId);
        if (settings.status !== "available") throw new Error("Synthetic automation settings unavailable");
        const rule = settings.rules.find((candidate) => candidate.id === ruleId && candidate.branchId === branchId);
        const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
        const source = await sourceReader.readClientAutomationSource(branchId, clientId);
        if (!rule || !source) throw new Error(`Synthetic retry source unavailable for ${kind}`);
        const recipe = buildClientMessageRecipe(rule, source, materializationTime);
        if (!recipe) throw new Error(`Synthetic retry recipe unavailable for ${kind}`);

        const delivery = app.get(SmsTriggerDeliveryService);
        const initialJob = MessageTriggerJobEntity.reconstitute(
            jobId,
            branchId,
            ruleId,
            "failed",
            recipe.scheduledFor,
            null,
            null,
            null,
            clientId,
            null,
            recipe.recipientType,
            recipe.recipientPhone ?? null,
            recipe.templateKey,
            recipe.dedupeKey,
            recipe.payload,
            new Date("2026-09-18T00:00:00.000Z"),
            new Date("2026-09-18T00:00:00.000Z"),
            1,
            null,
            null,
        );
        const snapshot = await delivery.resolveCanonicalDeliverySnapshot(initialJob);
        const sender = app.get(AligoDefaultSenderPolicyService).read();
        if (sender.availability !== "available") throw new Error("Synthetic sender policy unavailable");
        const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: client.createdAt.toISOString() });
        const effectDescription = await describeClientMessageEffect({
            branchId,
            subject: { kind: "client", clientId, clientIdentity },
            rule,
            client: source,
            change: "create",
            policy: {
                dispatchEnabled: settings.dispatchEnabled,
                senderApproved: settings.senderApproved,
                senderIdentityDigest: sender.identityDigest,
                senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
                pastTriggerEnabled: settings.pastTriggerEnabled,
                pastTriggerConfig: settings.pastTriggerConfig,
            },
            now: materializationTime,
            delivery,
        });
        if (effectDescription.status !== "effect") throw new Error(`Synthetic retry effect unavailable for ${kind}`);
        const scope: AgentAutomationScope = {
            branchId,
            clientId,
            clientIdentity,
            kind: "client-rule",
            ruleId,
            scheduleId: null,
            scheduleIdentity: null,
            recipientType: "client",
        };
        const origin = {
            kind: "task" as const,
            userId,
            actionId,
            taskId,
            taskRevision: 1,
            consentEventId: randomUUID(),
        };
        const mutationDigest = agentBindingHash({ kind: "synthetic-retry-recovery", scope, source: recipe.payload });
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
        const effect = effectDescription.effect;
        const authority: AgentAutomationAuthority = {
            version: 1,
            id: randomUUID(),
            scope,
            sequence: 1,
            previousId: null,
            origin,
            decision: kind === "allowed" || kind === "stale" || kind === "uncertain" ? "allow" : "deny",
            noSend: kind === "noSend",
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
            actionId,
            userId,
            taskId,
            taskRevision: 1,
            questionRef: randomUUID(),
            inputHash: agentBindingHash({ kind: "synthetic-input", clientId }),
            capability: "clients.update",
            resourceId: clientId,
            receiptDigest: agentBindingHash({ kind: "synthetic-receipt", clientId }),
            recordedAt,
        };
        const taskReference = agentAutomationTaskCommitReference({
            actionId,
            taskId,
            taskRevision: 1,
            batch: { authorities: [authority], coverages: [coverage] },
        });
        await createTaskRows({ sessionId, taskId, actionId });

        const sourcePayload = { ...recipe.payload, taskAutomationReference: taskReference };
        await prisma.message_trigger_job.create({
            data: {
                id: jobId,
                branchId,
                ruleId,
                status: "failed",
                scheduledFor: recipe.scheduledFor,
                attempts: 1,
                clientId,
                employeeScheduleId: null,
                recipientType: recipe.recipientType,
                recipientPhone: recipe.recipientPhone,
                templateKey: recipe.templateKey,
                dedupeKey: recipe.dedupeKey,
                payload: asJson(sourcePayload),
            },
        });
        for (const record of [coverage, authority]) {
            const terminal = createAgentAutomationTerminalRecord(record, commit);
            await prisma.message_trigger_job.create({
                data: {
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
                    payload: asJson({ [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: terminal }),
                },
            });
        }

        let job = await readJob(jobId);
        let sealVariables: Record<string, string> = {};
        if (kind === "allowed" || kind === "stale" || kind === "uncertain") {
            const resolver = app.get(AgentAutomationJobAuthorityService);
            const materialize = await tenantContextStore.run({ origin: "http", branchId }, () => prisma.$transaction((tx) => resolver.checkAutomaticJob(
                tx,
                job,
                "materialize",
                (current, tx) => delivery.resolveCanonicalDeliverySnapshot(current, tx),
            )));
            if (materialize.status !== "allowed") throw new Error(`Synthetic retry seal refused for ${kind}`);
            await prisma.message_trigger_job.update({
                where: { id: jobId },
                data: { payload: asJson({ ...sourcePayload, [AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]: materialize.seal }) },
            });
            job = await readJob(jobId);
            sealVariables = buildAutomationRetrySealVariables(job, snapshot.snapshotHash);
            if (Object.keys(sealVariables).length !== 7) throw new Error(`Synthetic retry seal missing for ${kind}`);
        } else {
            await prisma.message_trigger_job.update({
                where: { id: jobId },
                data: { payload: asJson({ ...sourcePayload, [AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]: {} }) },
            });
            job = await readJob(jobId);
            sealVariables = { automationSnapshotHash: snapshot.snapshotHash };
        }

        const sourceVariables: Record<string, string> = {
            ...sealVariables,
            senderPhone: "01000000999",
            recipientName: source.name,
            title: snapshot.title,
            msgType: snapshot.requestedDeliveryType,
            triggerType: "client_created",
            automationKey: "CLIENT_GREETING_SMS",
            retrySafety: kind === "uncertain" ? "uncertain" : "provider-rejected",
        };
        const sourceLog = await prisma.message_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: "client_greeting_sms",
                triggerJobId: jobId,
                receiver: snapshot.receiver,
                clientId,
                recipientName: snapshot.recipientName,
                recipientPhone: snapshot.receiver,
                messageBody: snapshot.message,
                variables: asJson(sourceVariables),
                status: "failed",
                errorMessage: "synthetic provider rejection",
                attempts: 1,
                lastAttemptAt: new Date("2026-09-18T02:05:00.000Z"),
                nextRetryAt: new Date(Date.now() - 60_000),
                providerAcceptanceKey: `agent-retry-recovery:${kind}:${randomUUID()}`,
                providerAcceptanceFingerprint: agentBindingHash({ kind: "synthetic-source", jobId, snapshotHash: snapshot.snapshotHash }),
                providerAcceptanceState: kind === "uncertain" ? "uncertain" : "rejected",
            },
        });
        return {
            kind,
            clientId,
            ruleId,
            jobId,
            sessionId,
            taskId,
            actionId,
            taskReference,
            coverage,
            authority,
            snapshotHash: snapshot.snapshotHash,
            snapshotMessage: snapshot.message,
            snapshotReceiver: snapshot.receiver,
            sourceLogId: sourceLog.id,
            sourceVariables,
        };
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.user.create({ data: { id: userId, email: "agent-retry-recovery@example.invalid", role: "admin" } });
        await prisma.branch.create({
            data: {
                id: branchId,
                name: "합성 재시도 복구 지점",
                slug: "agent-task-automation-retry-recovery-e2e",
                isActive: true,
                smsSenderApprovalStatus: "approved",
                smsSenderApprovalApprovedAt: new Date("2026-09-17T00:00:00.000Z"),
            },
        });
        await prisma.system_setting.create({ data: { key: parentPolicyKey, value: "true" } });
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
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentModelFactory)
            .useValue({
                modelId: "unused-retry-recovery-proof",
                providerOptions: () => ({}),
                create: jest.fn(() => {
                    throw new Error("No model call is allowed in retry recovery proof");
                }),
            })
            .compile();
        app = moduleRef.createNestApplication();
        await app.init();
        // The guarded runner keeps background schedulers in standby so an AppModule
        // integration test cannot start unrelated cron work. This spec invokes the
        // retry cycle explicitly, so grant only that in-process call the lease gate.
        jest.spyOn(app.get(SchedulerLeaseService), "holdsLease").mockReturnValue(true);
        sendSms = jest.spyOn(app.get(AligoService), "sendSms");
    }, 30_000);

    afterAll(async () => {
        sendSms?.mockRestore();
        await app?.close();
        if (prisma) {
            await cleanup();
            await prisma.$disconnect();
        }
    }, 30_000);

    it("retries only the sealed task job after task purge and refuses stale, uncertain, deny and noSend outcomes", async () => {
        const scenarios: RetryScenario[] = [];
        for (const [kind, clientId] of [
            ["allowed", 979700701],
            ["stale", 979700702],
            ["deny", 979700703],
            ["noSend", 979700704],
            ["uncertain", 979700705],
        ] as const) {
            scenarios.push(await seedScenario(kind, clientId));
        }
        const allowed = scenarios.find(({ kind }) => kind === "allowed")!;
        const stale = scenarios.find(({ kind }) => kind === "stale")!;
        const deny = scenarios.find(({ kind }) => kind === "deny")!;
        const noSend = scenarios.find(({ kind }) => kind === "noSend")!;
        const uncertain = scenarios.find(({ kind }) => kind === "uncertain")!;

        const staleClientBefore = await prisma.client.findUniqueOrThrow({ where: { id: stale.clientId } });
        const staleSourceBefore = await prisma.message_log.findUniqueOrThrow({ where: { id: stale.sourceLogId } });
        await prisma.client.update({
            where: { id: stale.clientId },
            data: { phone: "01000000888", phoneNormalized: "01000000888" },
        });
        expect(staleClientBefore.phone).not.toBe("01000000888");
        expect(deny.authority).toMatchObject({ decision: "deny", noSend: false });
        expect(noSend.authority).toMatchObject({ decision: "deny", noSend: true });

        const repository = app.get<IMessageLogRepository>(MESSAGE_LOG_REPOSITORY);
        const pending = (await Promise.all(scenarios.map(({ sourceLogId }) => repository.findByIdInBranch(branchId, sourceLogId))))
            .filter((log): log is NonNullable<typeof log> => log !== null);
        const findPending = jest.spyOn(repository, "findPendingRetriesSystemScope").mockResolvedValue(pending);
        try {
            await app.get(MessageRetrySchedulerService).retryFailedMessages();
        } finally {
            findPending.mockRestore();
        }

        expect(sendSms).toHaveBeenCalledTimes(1);
        expect(sendSms.mock.calls[0]?.[0]).toMatchObject({ receiver: allowed.snapshotReceiver, message: allowed.snapshotMessage });

        const logsFor = async (jobId: string) => prisma.message_log.findMany({ where: { triggerJobId: jobId }, orderBy: { id: "asc" } });
        const allowedLogs = await logsFor(allowed.jobId);
        expect(allowedLogs).toHaveLength(2);
        expect(allowedLogs[0]).toMatchObject({ status: "failed", providerAcceptanceState: "rejected", nextRetryAt: null });
        expect(allowedLogs[1]).toMatchObject({ status: "sent", providerAcceptanceState: "accepted", nextRetryAt: null });
        expect((allowedLogs[1]!.variables as Record<string, string>)["automationSealDigest"])
            .toBe(allowed.sourceVariables["automationSealDigest"]);
        expect((allowedLogs[1]!.variables as Record<string, string>)["retrySafety"]).toBe("accepted");
        expect(allowedLogs[1]!.receiver).toBe(allowed.snapshotReceiver);
        expect(allowedLogs[1]!.messageBody).toBe(allowed.snapshotMessage);

        for (const scenario of [stale, deny, noSend]) {
            const logs = await logsFor(scenario.jobId);
            expect(logs).toHaveLength(2);
            expect(logs[0]).toMatchObject({ status: "failed", providerAcceptanceState: "rejected", nextRetryAt: null });
            expect(logs[1]).toMatchObject({ status: "failed", providerAcceptanceState: "prepared", nextRetryAt: null });
            expect(logs[1]!.errorMessage).toContain("자동 문자 권한 증거");
            expect(logs.every(({ status }) => status !== "sent")).toBe(true);
        }
        const staleLogs = await logsFor(stale.jobId);
        expect(staleLogs[0]!.receiver).toBe(staleSourceBefore.receiver);
        expect(staleLogs[0]!.messageBody).toBe(staleSourceBefore.messageBody);
        const uncertainLogs = await logsFor(uncertain.jobId);
        expect(uncertainLogs).toHaveLength(1);
        expect(uncertainLogs[0]).toMatchObject({ status: "failed", providerAcceptanceState: "uncertain", nextRetryAt: null });
        expect(uncertainLogs[0]!.errorMessage).toContain("불확실");
        for (const scenario of scenarios) {
            const sourceLog = await prisma.message_log.findUniqueOrThrow({ where: { id: scenario.sourceLogId } });
            expect(sourceLog.variables).toEqual(scenario.sourceVariables);
            const terminalRows = await prisma.message_trigger_job.findMany({
                where: { id: { in: [scenario.coverage.id, scenario.authority.id] } },
            });
            expect(terminalRows).toHaveLength(2);
            expect(terminalRows.every((row) => decodeAgentAutomationTerminalRow(row) !== null)).toBe(true);
        }

        const resolver = app.get(AgentAutomationJobAuthorityService);
        for (const scenario of [stale, deny, noSend]) {
            const scenarioJob = await readJob(scenario.jobId);
            const dispatch = await tenantContextStore.run({ origin: "http", branchId }, () => prisma.$transaction((tx) => resolver.checkAutomaticJob(
                tx,
                scenarioJob,
                "dispatch",
                (current, tx) => app.get(SmsTriggerDeliveryService).resolveCanonicalDeliverySnapshot(current, tx),
                scenario.snapshotHash,
            )));
            expect(dispatch.status).toBe("refused");
        }

        const terminalRowsBeforePurge = await prisma.message_trigger_job.findMany({
            where: { id: { in: [allowed.coverage.id, allowed.authority.id] } },
            orderBy: { id: "asc" },
        });
        expect(terminalRowsBeforePurge).toHaveLength(2);
        expect(terminalRowsBeforePurge.every((row) => decodeAgentAutomationTerminalRow(row) !== null)).toBe(true);
        expect(await prisma.agent_action.findUnique({ where: { id: allowed.actionId } })).not.toBeNull();

        await prisma.agent_action.delete({ where: { id: allowed.actionId } });
        await prisma.agent_task.delete({ where: { id: allowed.taskId } });
        await prisma.agent_session.delete({ where: { id: allowed.sessionId } });
        expect(await prisma.agent_action.findUnique({ where: { id: allowed.actionId } })).toBeNull();
        expect(await prisma.agent_task.findUnique({ where: { id: allowed.taskId } })).toBeNull();
        expect(await prisma.agent_session.findUnique({ where: { id: allowed.sessionId } })).toBeNull();

        const reloadedResolver = new AgentAutomationJobAuthorityService(
            app.get(AgentAutomationAuthorityService),
            app.get(ClientAutomationSourceReader),
            app.get(AligoDefaultSenderPolicyService),
        );
        const reloadedJob = await readJob(allowed.jobId);
        const dispatchAfterPurge = await tenantContextStore.run({ origin: "http", branchId }, () => prisma.$transaction((tx) => reloadedResolver.checkAutomaticJob(
            tx,
            reloadedJob,
            "dispatch",
            (current, tx) => app.get(SmsTriggerDeliveryService).resolveCanonicalDeliverySnapshot(current, tx),
            allowed.snapshotHash,
        )));
        expect(dispatchAfterPurge.status).toBe("allowed");
        expect(dispatchAfterPurge).toMatchObject({ status: "allowed", seal: { authorityId: allowed.authority.id, authorityDigest: allowed.authority.recordDigest } });

        const terminalRowsAfterPurge = await prisma.message_trigger_job.findMany({
            where: { id: { in: [allowed.coverage.id, allowed.authority.id] } },
            orderBy: { id: "asc" },
        });
        expect(terminalRowsAfterPurge).toEqual(terminalRowsBeforePurge);
        expect(terminalRowsAfterPurge.every((row) => decodeAgentAutomationTerminalRow(row) !== null)).toBe(true);
        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: deny.jobId } })).payload).toHaveProperty(AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY);
        expect(await prisma.message_trigger_job.count({ where: { branchId, dedupeKey: { startsWith: AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX } } })).toBe(10);
        expect(staleClientBefore.createdAt).toEqual((await prisma.client.findUniqueOrThrow({ where: { id: stale.clientId } })).createdAt);
    }, 30_000);
});
