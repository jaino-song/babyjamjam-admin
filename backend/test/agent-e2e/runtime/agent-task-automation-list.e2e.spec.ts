import { AgentAutomationDeliveryGateService } from "../../../application/services/agent-automation-delivery-gate.service";
import { ClientAutomationSourceReader } from "../../../application/services/client-automation-source.reader";
import { AgentAutomationJobAuthorityService } from "../../../application/services/agent-automation-job-authority.service";
import { AgentAutomationAuthorityService } from "../../../application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService, agentAutomationTaskCommitReference, type AgentAutomationCommittedBatch } from "../../../application/agent/agent-automation-record-store.service";
import { createAgentAutomationQuestion, answerAgentAutomationQuestion } from "../../../application/agent/agent-automation-question";
import { parseTaskAutomationArtifact, TASK_AUTOMATION_ARTIFACT_KEY } from "../../../application/agent/agent-task-automation-artifact";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "../../../domain/constants/agent-automation-storage";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload } from "../../../domain/entities/message-trigger-job.entity";
import type { INestApplication } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { MessageExternalAgentCapabilitiesProvider } from "../../../application/usecases/message/message-external-agent-capabilities.provider";
import { MessageTriggerService } from "../../../application/services/message-trigger.service";
import { SMS_TEMPLATE_DELIVERY, SmsTriggerDeliveryService } from "../../../application/services/sms-trigger-delivery.service";
import { ClientAutomationImpactService } from "../../../application/services/client-automation-impact.service";
import { MessageAutomationBranchLockService } from "../../../application/services/message-automation-branch-lock.service";
import { AligoService } from "../../../application/services/aligo.service";
import { AligoDefaultSenderPolicyService } from "../../../application/services/aligo-default-sender-policy.service";
import { describeClientMessageEffect } from "../../../application/services/client-message-effect-recipe";
import { agentBindingHash } from "../../../domain/repositories/agent-linked-action.types";
import { CLIENT_AUTOMATION_IMPACT, type ClientAutomationImpactPort } from "../../../domain/ports/client-automation-impact.port";
import { AgentTaskAutomationService, type AgentTaskAutomationSource } from "../../../application/agent/agent-task-automation.service";
import { createEmptyAgentTaskDraft } from "../../../domain/entities/agent-task.entity";
import { buildClientMessageRecipe, buildMessageRecipeDedupeKey } from "../../../application/services/message-trigger-recipes";
import { createApprovedAgentTaskPersistenceClient, assertApprovedAgentTaskPersistenceDatabaseTarget } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "b7100000-0000-4000-8000-000000000001";
const clientIds = [971000001, 971000002];
const context = {
    principal: { userId: "b7200000-0000-4000-8000-000000000001", branchId, globalRole: "admin", branchRole: "admin" },
    sessionId: "b7300000-0000-4000-8000-000000000001", traceId: "readonly-rule-db-proof", locale: "ko",
};

describeAgentE2E("real automation.list with two eligible clients and missing defaults", () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    const createModel = jest.fn(() => { throw new Error("No model call is allowed in rule-list DB proof"); });

    async function cleanup() {
        await prisma.message_log.deleteMany({ where: { branchId } });
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId } });
        await prisma.client.deleteMany({ where: { branchId, id: { in: clientIds } } });
        await prisma.system_setting.deleteMany({ where: { key: { startsWith: `branch:${branchId}:` } } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
    }

    async function storedAutomation() {
        return {
            // Include all global rules, including the internal intent rule.
            rules: await prisma.message_trigger_rule.findMany({
                where: { OR: [{ branchId }, { branchId: null }] }, orderBy: { id: "asc" },
            }),
            jobs: await prisma.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } }),
            logs: await prisma.message_log.findMany({ where: { branchId }, orderBy: { id: "asc" } }),
        };
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.branch.create({ data: {
            id: branchId, name: "합성 자동화 조회 지점", slug: "agent-task-automation-list-e2e",
            isActive: true, smsSenderApprovalStatus: "approved", smsSenderApprovalApprovedAt: new Date(),
        } });
        await prisma.system_setting.create({ data: { key: `branch:${branchId}:message_policy:trigger-dispatch:enabled`, value: "true" } });
        await prisma.client.createMany({ data: clientIds.map((id, index) => ({
            id, branchId, name: `합성 고객 ${index + 1}`, phone: `0100000000${index + 1}`,
            phoneNormalized: `0100000000${index + 1}`, voucherClient: false, serviceStatus: "pre_booking",
            startDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        })) });
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentModelFactory).useValue({ modelId: "unused-readonly-proof", create: createModel }).compile();
        app = moduleRef.createNestApplication();
        await app.init();
    }, 30_000);

    afterAll(async () => {
        await app?.close();
        if (prisma) {
            await cleanup();
            await prisma.$disconnect();
        }
    }, 30_000);

    it("does not create defaults, jobs, intents or logs through the real read capability", async () => {
        expect(await prisma.message_trigger_rule.count({ where: { branchId } })).toBe(0);
        const before = await storedAutomation();
        const capability = app.get(MessageExternalAgentCapabilitiesProvider).getCapabilities()
            .find(({ meta }) => meta.name === "automation.list")!;
        const result = await tenantContextStore.run({ origin: "http", branchId },
            () => capability.execute(context, {})) as { rules: Array<{ id: string }> };
        expect(result.rules.every(({ id }) => before.rules.some((rule) => rule.id === id))).toBe(true);
        const settings = await tenantContextStore.run({ origin: "http", branchId },
            () => app.get(MessageTriggerService).readClientAutomationSettings(branchId));
        expect(settings).toMatchObject({ status: "available", defaultsPresent: false, dispatchEnabled: true, senderApproved: true });
        const impact = await tenantContextStore.run({ origin: "http", branchId }, () =>
            app.get<ClientAutomationImpactPort>(CLIENT_AUTOMATION_IMPACT).planClientWrite(branchId, {
                kind: "create", taskId: context.sessionId, values: { name: "합성 초안", phone: "01000000003" },
            }));
        expect(impact).toMatchObject({ availability: "unavailable", reason: "missing-default-rules", effects: [], complete: true });
        const draft = createEmptyAgentTaskDraft(context.sessionId);
        draft.confirmed = { name: "합성 초안", phone: "01000000003", voucherClient: false, serviceStatus: "pre_booking" };
        const source: AgentTaskAutomationSource = { ...context.principal, sessionId: context.sessionId, taskId: context.sessionId,
            capabilityId: "clients.create", targetRef: null, targetVersion: null, draft };
        const question = await tenantContextStore.run({ origin: "http", branchId }, () =>
            app.get(AgentTaskAutomationService).evaluate(source, context.principal));
        expect(question.question).toMatchObject({ availability: "unavailable", reason: "missing-default-rules" });
        expect(await storedAutomation()).toEqual(before);
        expect(createModel).not.toHaveBeenCalled();
    });

    it("keeps ordinary management provisioning effective for both eligible clients", async () => {
        // Positive control: the same DB and policy state would have produced
        // defaults and branch-wide jobs on the former agent read path.
        await tenantContextStore.run({ origin: "http", branchId },
            () => app.get(MessageTriggerService).listRules(branchId));
        expect(await prisma.message_trigger_rule.count({ where: { branchId } })).toBe(2);
        const jobs = await prisma.message_trigger_job.findMany({ where: { branchId } });
        expect(new Set(jobs.map((job) => job.clientId))).toEqual(new Set(clientIds));
        expect(jobs.length).toBeGreaterThanOrEqual(2);
        expect(jobs.every((job) => job.status === "pending")).toBe(true);
        expect(await prisma.message_log.count({ where: { branchId } })).toBe(0);
        expect(createModel).not.toHaveBeenCalled();
    });

    it("uses the real discovered client capability and injected planner to present a stable task question", async () => {
        const before = await storedAutomation();
        const draft = createEmptyAgentTaskDraft(context.sessionId);
        draft.confirmed = { name: "합성 초안", phone: "01000000003", voucherClient: false, serviceStatus: "pre_booking" };
        const source: AgentTaskAutomationSource = { ...context.principal, sessionId: context.sessionId, taskId: context.sessionId,
            capabilityId: "clients.create", targetRef: null, targetVersion: null, draft };
        const service = app.get(AgentTaskAutomationService);
        const initial = await tenantContextStore.run({ origin: "http", branchId }, () => service.evaluate(source, context.principal));
        expect(initial.question.availability).toBe("available");
        expect(initial.effects.length).toBeGreaterThan(0);
        source.draft.server.automation = initial;
        expect(await tenantContextStore.run({ origin: "http", branchId }, () => service.evaluate(source, context.principal))).toEqual(initial);
        expect(JSON.stringify(initial)).not.toMatch(/합성 초안|01000000003/);
        expect(await storedAutomation()).toEqual(before);
        expect(createModel).not.toHaveBeenCalled();
    });

    it("reads settings and the exact materialization source without changing settings, customers or automation", async () => {
        const trigger = app.get(MessageTriggerService);
        const before = await storedAutomation();
        const settingsBefore = await prisma.system_setting.findMany({ where: { key: { startsWith: `branch:${branchId}:` } }, orderBy: { key: "asc" } });
        const clientsBefore = await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const send = jest.spyOn(app.get(AligoService), "sendSms");
        await tenantContextStore.run({ origin: "http", branchId }, async () => {
            const settings = await trigger.readClientAutomationSettings(branchId);
            expect(settings).toMatchObject({ status: "available", defaultsPresent: true, senderApproved: true, dispatchEnabled: true });
            const source = await trigger.readClientAutomationSource(branchId, clientIds[0]!);
            expect(source).toMatchObject({ id: clientIds[0], name: clientsBefore[0]!.name, phone: clientsBefore[0]!.phone,
                createdAt: clientsBefore[0]!.createdAt, startDate: clientsBefore[0]!.startDate });
            if (settings.status !== "available" || !source) throw new Error("Missing positive planning fixture");
            const rule = settings.rules.find((entry) => entry.branchId === branchId && entry.templateKey === "CLIENT_GREETING");
            if (!rule) throw new Error("Missing provisioned greeting rule");
            const senderPolicy = app.get(AligoDefaultSenderPolicyService).read();
            expect(senderPolicy).toMatchObject({ availability: "available", mode: "stub" });
            if (senderPolicy.availability !== "available") throw new Error("Missing synthetic provider policy");
            const described = await describeClientMessageEffect({ branchId,
                subject: { kind: "client", clientId: source.id, clientIdentity: agentBindingHash({ id: source.id, createdAt: source.createdAt }) },
                rule, client: source, change: "refresh", now: new Date(), delivery: app.get(SmsTriggerDeliveryService),
                policy: { dispatchEnabled: settings.dispatchEnabled, senderApproved: settings.senderApproved,
                    senderIdentityDigest: senderPolicy.identityDigest, senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
                    pastTriggerEnabled: settings.pastTriggerEnabled, pastTriggerConfig: settings.pastTriggerConfig },
            });
            expect(described.status).toBe("effect");
            expect(JSON.stringify(described)).not.toContain(source.phone);
            expect(JSON.stringify(described)).not.toContain(source.name);
            expect(await trigger.readClientAutomationSource(branchId, 971000099)).toBeNull();
        });
        expect(await storedAutomation()).toEqual(before);
        expect(await prisma.system_setting.findMany({ where: { key: { startsWith: `branch:${branchId}:` } }, orderBy: { key: "asc" } })).toEqual(settingsBefore);
        expect(await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(clientsBefore);
        expect(createModel).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        send.mockRestore();
    });

    it("plans the actual scoped pending delta without changing either customer's jobs or source rows", async () => {
        const before = await storedAutomation();
        const clientsBefore = await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const send = jest.spyOn(app.get(AligoService), "sendSms");
        const planner = app.get<ClientAutomationImpactPort>(CLIENT_AUTOMATION_IMPACT);
        const impact = await tenantContextStore.run({ origin: "http", branchId }, () => planner.planClientWrite(branchId, {
            kind: "update", clientId: clientIds[0]!, values: { phone: "01000000003" },
        }));
        expect(impact.complete).toBe(true);
        expect(impact.effects.length).toBeGreaterThan(0);
        const affectedIds = new Set(impact.affectedJobs.map(({ id }) => id));
        expect(affectedIds.size).toBeGreaterThan(0);
        expect(before.jobs.filter(({ id }) => affectedIds.has(id)).every(({ clientId }) => clientId === clientIds[0])).toBe(true);
        for (const client of clientsBefore) {
            expect(JSON.stringify(impact)).not.toContain(client.name);
            expect(JSON.stringify(impact)).not.toContain(client.phone);
        }
        const missing = await tenantContextStore.run({ origin: "http", branchId }, () => planner.planClientWrite(branchId, {
            kind: "update", clientId: 971000099, values: { phone: "01000000003" },
        }));
        expect(missing).toMatchObject({ availability: "unavailable", complete: false, affectedJobs: [], effects: [] });
        expect(await storedAutomation()).toEqual(before);
        expect(await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(clientsBefore);
        expect(send).not.toHaveBeenCalled();
        expect(createModel).not.toHaveBeenCalled();
        send.mockRestore();
    });

    it("omits pre-start catch-up after service begins using actual branch rules", async () => {
        const before = await storedAutomation();
        const impact = await tenantContextStore.run({ origin: "http", branchId }, () =>
            app.get<ClientAutomationImpactPort>(CLIENT_AUTOMATION_IMPACT).planClientWrite(branchId, {
                kind: "create", taskId: context.sessionId, values: { name: "합성 시작 고객", phone: "01000000003",
                    startDate: new Date(Date.now() - 86_400_000) },
            }));
        expect(impact.effects.some(({ templateKey }) => templateKey === "SERVICE_INFO")).toBe(false);
        expect(impact.effects.some(({ templateKey }) => templateKey === "CLIENT_GREETING")).toBe(true);
        expect(await storedAutomation()).toEqual(before);
    });

    it("distinguishes a real immediate pending refresh from a processing-claim cancellation", async () => {
        const planner = app.get<ClientAutomationImpactPort>(CLIENT_AUTOMATION_IMPACT);
        await tenantContextStore.run({ origin: "http", branchId }, async () => {
            const trigger = app.get(MessageTriggerService);
            const source = await trigger.readClientAutomationSource(branchId, clientIds[0]!);
            const rule = (await trigger.listRulesReadOnly(branchId)).find(({ templateKey }) => templateKey === "CLIENT_GREETING");
            if (!rule || !source) throw new Error("Missing synthetic immediate source");
            const recipe = buildClientMessageRecipe(rule, source, new Date());
            if (!recipe) throw new Error("Missing synthetic immediate recipe");
            const row = await prisma.message_trigger_job.create({ data: {
                branchId, ruleId: rule.id, status: "pending", scheduledFor: recipe.scheduledFor,
                clientId: source.id, employeeScheduleId: null, recipientType: recipe.recipientType,
                recipientPhone: recipe.recipientPhone, templateKey: recipe.templateKey, dedupeKey: recipe.dedupeKey,
                payload: JSON.parse(JSON.stringify(recipe.payload)),
            } });
            const write = { kind: "update" as const, clientId: source.id, values: { phone: "01000000003" } };
            const pending = await planner.planClientWrite(branchId, write);
            expect(pending.effects.find(({ ruleId }) => ruleId === rule.id)).toMatchObject({ change: "refresh" });
            await prisma.message_trigger_job.update({ where: { id: row.id }, data: { status: "processing", claimToken: "synthetic-planner-claim" } });
            const before = await storedAutomation();
            const processing = await planner.planClientWrite(branchId, write);
            expect(processing.effects.find(({ ruleId }) => ruleId === rule.id)).toMatchObject({ change: "cancel" });
            expect(processing.affectedJobs.find(({ id }) => id === row.id)?.version).not.toBe(pending.affectedJobs.find(({ id }) => id === row.id)?.version);
            expect(await storedAutomation()).toEqual(before);
        });
        expect(createModel).not.toHaveBeenCalled();
    });

    it("reads uncommitted policy, sender, rule and global override values through the supplied transaction", async () => {
        const trigger = app.get(MessageTriggerService);
        const before = await storedAutomation();
        const beforeBranch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
        const lock = new MessageAutomationBranchLockService(prisma as never);
        await expect(tenantContextStore.run({ origin: "http", branchId }, () => lock.runExclusive(branchId, async (tx) => {
            const set = async (key: string, value: string) => tx.system_setting.upsert({ where: { key }, create: { key, value }, update: { value } });
            await set(`branch:${branchId}:message_policy:past-trigger:enabled`, "false");
            await set(`branch:${branchId}:message_automation:past_trigger`, JSON.stringify({ sendIntervalMinutes: 39, ruleOrder: ["synthetic-rule"] }));
            await tx.branch.update({ where: { id: branchId }, data: { smsSenderApprovalApprovedAt: new Date("2026-01-02T00:00:00.000Z") } });
            const base = await tx.message_trigger_rule.findFirstOrThrow({ where: { branchId, templateKey: "CLIENT_GREETING" } });
            await tx.message_trigger_rule.update({ where: { id: base.id }, data: { name: "합성 트랜잭션 변경" } });
            const global = await tx.message_trigger_rule.create({ data: { ...base, id: "synthetic-transaction-global", branchId: null, isDefault: false } });
            await tx.message_trigger_rule_branch_override.create({ data: { branchId, ruleId: global.id, isActive: false } });
            const inside = await trigger.readClientAutomationSettings(branchId, tx);
            expect(inside).toMatchObject({ status: "available", dispatchEnabled: true, senderApproved: true,
                senderApprovedAt: new Date("2026-01-02T00:00:00.000Z"), pastTriggerEnabled: false,
                pastTriggerConfig: { sendIntervalMinutes: 39, ruleOrder: ["synthetic-rule"] } });
            if (inside.status !== "available") throw new Error("Missing synthetic settings");
            expect(inside.rules.find(({ id }) => id === base.id)?.name).toBe("합성 트랜잭션 변경");
            expect(inside.rules.find(({ id }) => id === global.id)?.isActive).toBe(false);
            await set(`branch:${branchId}:message_policy:trigger-dispatch:enabled`, "false");
            await tx.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "pending" } });
            expect(await trigger.readClientAutomationSettings(branchId, tx)).toMatchObject({ dispatchEnabled: false, senderApproved: false });
            throw new Error("SYNTHETIC_ROLLBACK");
        }))).rejects.toThrow("SYNTHETIC_ROLLBACK");
        expect(await storedAutomation()).toEqual(before);
        expect(await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).toEqual(beforeBranch);
    });

    it("uses uncommitted client/job generations for the final planner and retains normal preview behavior", async () => {
        const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
        const write = { kind: "update" as const, clientId: clientIds[0]!, values: { phone: "01000000003" } };
        const before = await storedAutomation();
        await tenantContextStore.run({ origin: "http", branchId }, async () => {
            const baseline = await planner.planClientWrite(branchId, write);
            expect(baseline.complete).toBe(true);
            await expect(prisma.$transaction(async (tx) => {
                await tx.client.update({ where: { id: clientIds[0]! }, data: { name: "합성 변경된 이름" } });
                const affected = before.jobs.find(({ id }) => baseline.affectedJobs.some((job) => job.id === id));
                if (!affected) throw new Error("Missing synthetic affected job");
                await tx.message_trigger_job.update({ where: { id: affected.id }, data: { claimToken: "synthetic-final-check" } });
                const inside = await planner.planClientWriteInTransaction(tx, branchId, write);
                expect(inside.complete).toBe(true);
                expect(inside.sourceGuard).not.toBe(baseline.sourceGuard);
                expect(inside.effects.map(({ sourceDigest }) => sourceDigest)).not.toEqual(baseline.effects.map(({ sourceDigest }) => sourceDigest));
                expect(inside.affectedJobs.find(({ id }) => id === affected.id)?.version).not.toBe(baseline.affectedJobs.find(({ id }) => id === affected.id)?.version);
                expect(await planner.planClientWrite(branchId, write)).toEqual(baseline);
                throw new Error("SYNTHETIC_ROLLBACK");
            })).rejects.toThrow("SYNTHETIC_ROLLBACK");
            expect(await planner.planClientWrite(branchId, write)).toEqual(baseline);
        });
        expect(await storedAutomation()).toEqual(before);
    });

    it("renders the uncommitted branch template without opening an independent template transaction", async () => {
        const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
        const write = { kind: "create" as const, taskId: context.sessionId, values: { name: "합성 미리보기", phone: "01000000003" } };
        const beforeBranch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
        await tenantContextStore.run({ origin: "http", branchId }, async () => {
            const baseline = await planner.planClientWrite(branchId, write);
            const prior = baseline.effects.find(({ templateKey }) => templateKey === "CLIENT_GREETING");
            expect(prior).toBeDefined();
            await expect(prisma.$transaction(async (tx) => {
                const key = SMS_TEMPLATE_DELIVERY.CLIENT_GREETING!.systemTemplateKey!;
                const at = "2026-09-17T00:00:00.000Z";
                await tx.branch.update({ where: { id: branchId }, data: { systemTemplateSnapshot: {
                    version: 1, createdAt: at, createdBy: "synthetic", templates: { [key]: {
                        id: "synthetic-template", content: "합성 변경 안내 {{name}}", createdAt: at, updatedAt: at, customVariables: [],
                    } },
                } as Prisma.InputJsonValue } });
                const inside = await planner.planClientWriteInTransaction(tx, branchId, write);
                const current = inside.effects.find(({ templateKey }) => templateKey === "CLIENT_GREETING");
                expect(inside).toMatchObject({ complete: true, availability: "available" });
                expect(current?.templateDigest).not.toBe(prior!.templateDigest);
                expect(current?.sourceDigest).toBe(prior!.sourceDigest);
                expect(await planner.planClientWrite(branchId, write)).toEqual(baseline);
                throw new Error("SYNTHETIC_ROLLBACK");
            })).rejects.toThrow("SYNTHETIC_ROLLBACK");
        });
        expect(await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).toEqual(beforeBranch);
        expect(createModel).not.toHaveBeenCalled();
    });
    it("binds committed authority to a persisted concrete recipe, including copied seals and catch-up schedules", async () => {
        const before = await storedAutomation();
        const beforeClients = await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const sourceReader = app.get(ClientAutomationSourceReader);
        const sender = app.get(AligoDefaultSenderPolicyService);
        const sms = app.get(SmsTriggerDeliveryService);
        const lock = new MessageAutomationBranchLockService(prisma as never);
        const records = new AgentAutomationRecordStoreService(lock);
        const adapter = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(records), sourceReader, sender);
        const planner = app.get<ClientAutomationImpactService>(CLIENT_AUTOMATION_IMPACT);
        const send = jest.spyOn(app.get(AligoService), "sendSms");
        let committedBatch: AgentAutomationCommittedBatch | undefined;
        await expect(tenantContextStore.run({ origin: "http", branchId }, () => lock.runExclusive(branchId, async (tx) => {
            const taskId = randomUUID(); const sessionId = randomUUID(); const actionId = randomUUID();
            const createdId = 971000090; const userId = context.principal.userId;
            const values = { name: "합성 동의 고객", phone: "01000000009" };
            await tx.system_setting.upsert({ where: { key: `branch:${branchId}:message_policy:past-trigger:enabled` },
                create: { key: `branch:${branchId}:message_policy:past-trigger:enabled`, value: "true" }, update: { value: "true" } });
            const impact = await planner.planClientWriteInTransaction(tx, branchId, { kind: "create", taskId, values });
            expect(impact).toMatchObject({ complete: true, availability: "available" });
            expect(impact.effects.length).toBeGreaterThan(0);
            const question = createAgentAutomationQuestion(impact);
            const answer = answerAgentAutomationQuestion({ choice: "yes", presented: question, current: question, noSend: false, clientEventId: randomUUID() });
            if (answer.status !== "accepted") throw new Error("Missing synthetic answer");
            const artifact = parseTaskAutomationArtifact({ version: 1, actionId, sessionId, taskId, taskRevision: 2, userId, branchId,
                capability: "clients.create", inputHash: agentBindingHash(values), targetClientId: null, targetVersion: null,
                question, consent: answer.consent, noSend: false, impact });
            if (!artifact) throw new Error("Missing synthetic artifact");
            const expiresAt = new Date("2099-01-01");
            await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, role: "admin", email: "source-authority@example.invalid" } });
            await tx.agent_session.create({ data: { id: sessionId, userId, branchId, model: "synthetic", agentVersion: "phase7", expiresAt } });
            await tx.agent_task.create({ data: { id: taskId, sessionId, userId, branchId, capabilityId: "clients.create", revision: 2,
                status: "executing", draft: {}, activeActionId: actionId, expiresAt } });
            await tx.agent_action.create({ data: { id: actionId, sessionId, userId, branchId, taskId, taskRevision: 2, capability: "clients.create",
                capabilityVersion: "phase7", risk: "external-side-effect", status: "executing", inputHash: artifact.inputHash,
                proposal: { [TASK_AUTOMATION_ARTIFACT_KEY]: artifact } as unknown as Prisma.InputJsonValue, proposalRevision: agentBindingHash("proposal"),
                authorizationContext: {}, expiresAt, idempotencyKey: randomUUID(), requestDedupeKey: randomUUID(), dedupeExpiresAt: expiresAt } });
            await records.runTaskMutation({ ...context, sessionId, actionId }, artifact, async (transaction) => {
                const client = await transaction.client.create({ data: { id: createdId, branchId, ...values, voucherClient: false, serviceStatus: "pre_booking" } });
                return { clientId: createdId, result: { id: createdId, status: "created" }, affectedJobs: [], coverages: [{ scope: {
                    branchId, clientId: createdId, clientIdentity: agentBindingHash({ version: 1, resource: "client", id: createdId, createdAt: client.createdAt!.toISOString() }),
                    kind: "client-rule", scheduleId: null, scheduleIdentity: null, recipientType: "client",
                }, grandfatheredScopes: [] }] };
            }, async (_transaction, batch) => { committedBatch = batch; }, tx);
            if (!committedBatch) throw new Error("Missing committed automation batch");
            const taskAutomationReference = agentAutomationTaskCommitReference({ actionId, taskId, taskRevision: 2, batch: committedBatch });
            const client = await sourceReader.readClientAutomationSource(branchId, createdId, tx);
            const settings = await sourceReader.readClientAutomationSettings(branchId, tx);
            if (!client || settings.status !== "available") throw new Error("Missing synthetic source");
            const rule = settings.rules.find(({ templateKey }) => templateKey === "CLIENT_GREETING")!;
            const recipe = buildClientMessageRecipe(rule, client, new Date())!;
            const storedJob = await tx.message_trigger_job.create({ data: {
                ...recipe,
                payload: { ...recipe.payload, taskAutomationReference } as unknown as Prisma.InputJsonValue,
            } });
            const job = MessageTriggerJobEntity.reconstitute(storedJob.id, branchId, rule.id, "pending", recipe.scheduledFor,
                null, null, null, createdId, null, recipe.recipientType, recipe.recipientPhone!, recipe.templateKey,
                recipe.dedupeKey, storedJob.payload as unknown as MessageTriggerJobPayload, storedJob.createdAt, storedJob.updatedAt);
            const persistCandidate = () => tx.message_trigger_job.update({ where: { id: job.id }, data: {
                scheduledFor: job.scheduledFor, dedupeKey: job.dedupeKey, payload: job.payload as unknown as Prisma.InputJsonValue,
            } });
            const render = (candidate: MessageTriggerJobEntity, transaction: Prisma.TransactionClient) => sms.resolveCanonicalDeliverySnapshot(candidate, transaction);
            const allowed = await adapter.checkAutomaticJob(tx, job, "materialize", render);
            expect(allowed.status).toBe("allowed"); if (allowed.status !== "allowed") throw new Error("Missing current source seal");
            job.payload = { ...job.payload, [AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]: allowed.seal };
            await persistCandidate();
            const snapshot = await render(job, tx);
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render, snapshot.snapshotHash)).toEqual(allowed);
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render, agentBindingHash("wrong-frozen-body"))).toMatchObject({ status: "refused" });
            const originalPayload = structuredClone(job.payload);
            const originalTime = new Date(job.scheduledFor); const originalKey = job.dedupeKey;
            const restore = async () => {
                job.payload = structuredClone(originalPayload); job.scheduledFor = new Date(originalTime); job.dedupeKey = originalKey;
                await persistCandidate();
            };
            // Even a persisted same-scope copy must not inherit the first row's grant.
            const duplicate = await tx.message_trigger_job.create({ data: { ...recipe, dedupeKey: `${recipe.dedupeKey}:copy`,
                payload: job.payload as unknown as Prisma.InputJsonValue } });
            const copied = MessageTriggerJobEntity.reconstitute(duplicate.id, branchId, rule.id, "pending", recipe.scheduledFor,
                null, null, null, createdId, null, recipe.recipientType, recipe.recipientPhone!, recipe.templateKey,
                duplicate.dedupeKey, structuredClone(job.payload), duplicate.createdAt, duplicate.updatedAt);
            expect(await adapter.checkAutomaticJob(tx, copied, "dispatch", render)).toMatchObject({ status: "refused" });
            await tx.message_trigger_job.delete({ where: { id: duplicate.id } });
            const mutations = [
                () => { job.dedupeKey += ":copied"; },
                () => { job.scheduledFor = new Date(originalTime.getTime() + 60_000);
                    job.dedupeKey = buildMessageRecipeDedupeKey(rule.id, `client:${createdId}`, job.scheduledFor, rule.recipientType); },
                () => { job.payload.templateVariables["unusedVariable"] = "synthetic"; },
                () => { job.payload.memberId = "other-member"; },
            ];
            for (const mutate of mutations) {
                mutate(); await persistCandidate();
                expect((await render(job, tx)).snapshotHash).toBe(snapshot.snapshotHash);
                expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
                await restore();
            }
            // A stale intent can legitimately keep a stable batch time preceding
            // its immediate recipe time. Stamp only after that final schedule.
            const batchTime = new Date(originalTime.getTime() - 120_000);
            job.scheduledFor = batchTime;
            job.dedupeKey = buildMessageRecipeDedupeKey(rule.id, `client:${createdId}`, batchTime, rule.recipientType);
            delete job.payload.agentAutomationSeal;
            job.payload.catchUp = { batchId: `client:${createdId}:${batchTime.toISOString()}`, sequence: 1,
                intervalMinutes: settings.pastTriggerConfig.sendIntervalMinutes, originalScheduledFor: originalTime.toISOString(), predecessorDedupeKey: null };
            await persistCandidate();
            const catchUpAllowed = await adapter.checkAutomaticJob(tx, job, "materialize", render);
            expect(catchUpAllowed.status).toBe("allowed");
            if (catchUpAllowed.status !== "allowed") throw new Error("Missing catch-up seal");
            job.payload.agentAutomationSeal = catchUpAllowed.seal; await persistCandidate();
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toEqual(catchUpAllowed);
            job.payload.catchUp.originalScheduledFor = new Date(originalTime.getTime() + 1).toISOString();
            await persistCandidate();
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            await restore();
            // The production retroactive path orders all due client rules in
            // one batch, so a predecessor may have a different rule and its
            // own original recipe time. Mirror that heterogeneous topology.
            const chainIntervalMinutes = settings.pastTriggerConfig.sendIntervalMinutes;
            expect(chainIntervalMinutes).toBeGreaterThan(0);
            const chainOriginalTime = new Date(originalTime);
            // Make the service-start rule due, as the real synchronizer does
            // before applyRetroactiveSendConfig orders the two candidates.
            await tx.client.update({ where: { id: createdId }, data: {
                startDate: new Date(chainOriginalTime.getTime() - 20 * 24 * 60 * 60 * 1000),
            } });
            const chainClient = await sourceReader.readClientAutomationSource(branchId, createdId, tx);
            const predecessorRule = settings.rules.find((candidate) => candidate.branchId === branchId
                && candidate.id !== rule.id && candidate.templateKey !== rule.templateKey);
            if (!chainClient || !predecessorRule) throw new Error("Missing heterogeneous catch-up fixture");
            const predecessorRecipe = buildClientMessageRecipe(predecessorRule, chainClient, chainOriginalTime);
            const successorRecipe = buildClientMessageRecipe(rule, chainClient, chainOriginalTime);
            if (!predecessorRecipe || !successorRecipe) throw new Error("Missing heterogeneous catch-up recipe");
            const chainBatchTime = new Date(chainOriginalTime.getTime() - 24 * 60 * 60 * 1000);
            const chainRows: Array<{ id: string; scheduledFor: Date; dedupeKey: string; payload: unknown;
                recipientType: typeof successorRecipe.recipientType; recipientPhone: string; templateKey: typeof successorRecipe.templateKey;
                createdAt: Date; updatedAt: Date }> = [];
            let previousKey: string | null = null;
            for (const [index, baseRecipe] of [predecessorRecipe, successorRecipe].entries()) {
                const sequence = index + 1;
                const scheduledFor = new Date(chainBatchTime.getTime() + (sequence - 1) * chainIntervalMinutes * 60_000);
                const dedupeKey = buildMessageRecipeDedupeKey(baseRecipe.ruleId, `client:${createdId}`, scheduledFor, baseRecipe.recipientType);
                const catchUpMetadata = { batchId: `client:${createdId}:${chainBatchTime.toISOString()}`, sequence,
                    intervalMinutes: chainIntervalMinutes, originalScheduledFor: baseRecipe.scheduledFor.toISOString(), predecessorDedupeKey: previousKey };
                const row = await tx.message_trigger_job.create({ data: { ...baseRecipe, scheduledFor, dedupeKey,
                    payload: { ...baseRecipe.payload, catchUp: catchUpMetadata } as unknown as Prisma.InputJsonValue } });
                chainRows.push({ id: row.id, scheduledFor, dedupeKey, payload: row.payload,
                    recipientType: baseRecipe.recipientType, recipientPhone: baseRecipe.recipientPhone!, templateKey: baseRecipe.templateKey,
                    createdAt: row.createdAt, updatedAt: row.updatedAt });
                previousKey = dedupeKey;
            }
            const chainSuccessor = chainRows[1]!;
            const chainJob = MessageTriggerJobEntity.reconstitute(chainSuccessor.id, branchId, successorRecipe.ruleId, "pending", chainSuccessor.scheduledFor,
                null, null, null, createdId, null, chainSuccessor.recipientType, chainSuccessor.recipientPhone, chainSuccessor.templateKey,
                chainSuccessor.dedupeKey, chainSuccessor.payload as MessageTriggerJobEntity["payload"], chainSuccessor.createdAt, chainSuccessor.updatedAt);
            const persistChainJob = () => tx.message_trigger_job.update({ where: { id: chainJob.id }, data: {
                scheduledFor: chainJob.scheduledFor, dedupeKey: chainJob.dedupeKey, payload: chainJob.payload as unknown as Prisma.InputJsonValue,
            } });
            const chainAllowed = await adapter.checkAutomaticJob(tx, chainJob, "materialize", render);
            expect(chainAllowed.status).toBe("allowed");
            if (chainAllowed.status !== "allowed") throw new Error("Missing canonical catch-up chain seal");
            chainJob.payload.agentAutomationSeal = chainAllowed.seal;
            await persistChainJob();
            expect(await adapter.checkAutomaticJob(tx, chainJob, "dispatch", render)).toEqual(chainAllowed);

            const predecessorRow = chainRows[0]!;
            const predecessorPayload = structuredClone(predecessorRow.payload) as { catchUp: { predecessorDedupeKey: string | null } };
            predecessorPayload.catchUp.predecessorDedupeKey = "missing-catch-up-predecessor";
            await tx.message_trigger_job.update({ where: { id: predecessorRow.id }, data: { payload: predecessorPayload as unknown as Prisma.InputJsonValue } });
            expect(await adapter.checkAutomaticJob(tx, chainJob, "dispatch", render)).toMatchObject({ status: "refused" });
            await tx.message_trigger_job.update({ where: { id: predecessorRow.id }, data: { payload: predecessorRow.payload as Prisma.InputJsonValue } });

            await tx.message_trigger_job.update({ where: { id: predecessorRow.id }, data: { scheduledFor: new Date(predecessorRow.scheduledFor.getTime() + 60_000) } });
            expect(await adapter.checkAutomaticJob(tx, chainJob, "dispatch", render)).toMatchObject({ status: "refused" });
            await tx.message_trigger_job.update({ where: { id: predecessorRow.id }, data: { scheduledFor: predecessorRow.scheduledFor } });

            const chainCatchUp = chainJob.payload.catchUp!;
            const originalPredecessorKey = chainCatchUp.predecessorDedupeKey;
            chainCatchUp.predecessorDedupeKey = "missing-catch-up-predecessor";
            await persistChainJob();
            expect(await adapter.checkAutomaticJob(tx, chainJob, "dispatch", render)).toMatchObject({ status: "refused" });
            chainCatchUp.predecessorDedupeKey = originalPredecessorKey;
            await persistChainJob();
            expect(await adapter.checkAutomaticJob(tx, chainJob, "dispatch", render)).toEqual(chainAllowed);
            await tx.message_trigger_job.deleteMany({ where: { id: { in: chainRows.map(({ id }) => id) } } });

            job.payload.templateVariables["__smsDeliverySnapshot"] = "private prepared snapshot";
            await persistCandidate();
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render, snapshot.snapshotHash)).toEqual(allowed);
            await restore();
            // Complete source validation also rejects an unsealed bad materialization,
            // even when that extra field never appears in the rendered SMS.
            delete job.payload.agentAutomationSeal; job.payload.templateVariables["unusedVariable"] = "synthetic";
            await persistCandidate();
            expect(await adapter.checkAutomaticJob(tx, job, "materialize", render)).toMatchObject({ status: "refused" });
            await restore();
            job.payload.recipientPhone = "01000000008";
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            job.payload = structuredClone(originalPayload);
            job.payload.templateVariables = { ...job.payload.templateVariables, name: "합성 위조 이름" };
            job.payload.recipientName = "합성 위조 이름";
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            job.payload = structuredClone(originalPayload);
            await tx.client.update({ where: { id: createdId }, data: { phone: "01000000008" } });
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            await tx.client.update({ where: { id: createdId }, data: { phone: values.phone } });
            const beforeBranch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
            const key = SMS_TEMPLATE_DELIVERY.CLIENT_GREETING!.systemTemplateKey!;
            const at = "2026-09-17T00:00:00.000Z";
            await tx.branch.update({ where: { id: branchId }, data: { systemTemplateSnapshot: { version: 1, createdAt: at, createdBy: "synthetic",
                templates: { [key]: { id: "synthetic-authority-template", content: "합성 변경 문구", createdAt: at, updatedAt: at, customVariables: [] } } } } });
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            await tx.branch.update({ where: { id: branchId }, data: { systemTemplateSnapshot: beforeBranch.systemTemplateSnapshot === null ? Prisma.DbNull : beforeBranch.systemTemplateSnapshot as Prisma.InputJsonValue } });
            await tx.system_setting.update({ where: { key: `branch:${branchId}:message_policy:trigger-dispatch:enabled` }, data: { value: "false" } });
            expect(await adapter.checkAutomaticJob(tx, job, "dispatch", render)).toMatchObject({ status: "refused" });
            expect(await tx.message_log.count({ where: { branchId } })).toBe(0);
            expect(await tx.message_trigger_job.count({ where: { branchId, clientId: createdId } })).toBe(1);
            throw new Error("SYNTHETIC_ROLLBACK");
        }))).rejects.toThrow("SYNTHETIC_ROLLBACK");
        expect(await storedAutomation()).toEqual(before);
        expect(await prisma.client.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeClients);
        expect(send).not.toHaveBeenCalled(); expect(createModel).not.toHaveBeenCalled(); send.mockRestore();
    });

    it("uses the shared real gate for automatic preparation and one stub provider crossing", async () => {
        const trigger = app.get(MessageTriggerService); const sms = app.get(SmsTriggerDeliveryService);
        const gate = app.get(AgentAutomationDeliveryGateService); const sources = app.get(ClientAutomationSourceReader);
        expect((trigger as unknown as { automationDeliveryGate: unknown }).automationDeliveryGate).toBe(gate);
        expect((sms as unknown as { automationDeliveryGate: unknown }).automationDeliveryGate).toBe(gate);
        const send = jest.spyOn(app.get(AligoService), "sendSms");
        await tenantContextStore.run({ origin: "http", branchId }, async () => {
            await trigger.listRules(branchId);
            const settings = await sources.readClientAutomationSettings(branchId);
            const client = await sources.readClientAutomationSource(branchId, clientIds[0]!);
            if (settings.status !== "available" || !client) throw new Error("Missing synthetic legacy source");
            const rule = settings.rules.find(({ templateKey }) => templateKey === "CLIENT_GREETING")!;
            const recipe = buildClientMessageRecipe(rule, client, new Date())!;
            const row = await prisma.message_trigger_job.create({ data: { ...recipe, payload: recipe.payload as unknown as Prisma.InputJsonValue } });
            await Promise.allSettled([1, 2].map(() => trigger.dispatchPendingJobNow(row.id, { expectedBranchId: branchId })));
            expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sent");
            expect(send).toHaveBeenCalledTimes(1);
            const logs = await prisma.message_log.findMany({ where: { triggerJobId: row.id } });
            expect(logs).toHaveLength(1);
            expect(logs[0]!.providerAcceptanceState).toBe("accepted");
        });
        expect(createModel).not.toHaveBeenCalled(); send.mockRestore();
    });

    it.each(["failed", "sent"])("does not overwrite a concurrent %s result after dispatch admission refuses", async (status) => {
        const trigger = app.get(MessageTriggerService);
        const gate = app.get(AgentAutomationDeliveryGateService);
        const sources = app.get(ClientAutomationSourceReader);
        const send = jest.spyOn(app.get(AligoService), "sendSms");
        const consume = gate.consumeDispatch.bind(gate);
        const take = jest.spyOn(gate, "consumeDispatch").mockImplementationOnce(async (job, preparation) => {
            // Simulate a recovery owner finishing this same claim after the
            // dispatch CAS commits, before the final provider admission read.
            const current = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } });
            expect(current.status).toBe("dispatching");
            expect(current.claimToken).toBe(job.claimToken);
            await prisma.message_trigger_job.update({ where: { id: job.id }, data: {
                status, sentAt: status === "sent" ? new Date() : null,
            } });
            return consume(job, preparation);
        });
        try {
            await tenantContextStore.run({ origin: "http", branchId }, async () => {
                await trigger.listRules(branchId);
                const settings = await sources.readClientAutomationSettings(branchId);
                const client = await sources.readClientAutomationSource(branchId, clientIds[0]!);
                if (settings.status !== "available" || !client) throw new Error("Missing synthetic legacy source");
                const rule = settings.rules.find(({ templateKey }) => templateKey === "CLIENT_GREETING")!;
                const recipe = buildClientMessageRecipe(rule, client, new Date())!;
                const row = await prisma.message_trigger_job.create({ data: { ...recipe, payload: recipe.payload as unknown as Prisma.InputJsonValue } });
                await trigger.dispatchPendingJobNow(row.id, { expectedBranchId: branchId });
                const persisted = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: row.id } });
                expect(persisted.status).toBe(status);
                expect(persisted.attempts).toBe(0);
                expect(persisted.nextAttemptAt).toBeNull();
                if (status === "sent") expect(persisted.sentAt).not.toBeNull();
                expect(take).toHaveBeenCalledTimes(1);
                expect(send).not.toHaveBeenCalled();
                expect(await prisma.message_log.count({ where: { triggerJobId: row.id } })).toBe(0);
            });
            expect(createModel).not.toHaveBeenCalled();
        } finally { take.mockRestore(); send.mockRestore(); }
    });

});
