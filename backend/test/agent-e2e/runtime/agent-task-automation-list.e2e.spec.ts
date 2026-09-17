import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { tenantContextStore } from "../../../infrastructure/tenant/tenant-context.store";
import { MessageExternalAgentCapabilitiesProvider } from "../../../application/usecases/message/message-external-agent-capabilities.provider";
import { MessageTriggerService } from "../../../application/services/message-trigger.service";
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
});
