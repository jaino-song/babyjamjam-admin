import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { MessageExternalAgentCapabilitiesProvider } from "../../../application/usecases/message/message-external-agent-capabilities.provider";
import { MessageTriggerService } from "../../../application/services/message-trigger.service";
import { SmsTriggerDeliveryService } from "../../../application/services/sms-trigger-delivery.service";
import { AligoService } from "../../../application/services/aligo.service";
import { AligoDefaultSenderPolicyService } from "../../../application/services/aligo-default-sender-policy.service";
import { describeClientMessageEffect } from "../../../application/services/client-message-effect-recipe";
import { agentBindingHash } from "../../../domain/repositories/agent-linked-action.types";
import { CLIENT_AUTOMATION_IMPACT, type ClientAutomationImpactPort } from "../../../domain/ports/client-automation-impact.port";
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
});
