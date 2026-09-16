import { PrismaClient } from "@prisma/client";

import { AgentTaskService } from "application/agent/agent-task.service";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const USER_ID = "97000000-0000-4000-8000-000000000001";
const BRANCH_ID = "98000000-0000-4000-8000-000000000001";
const principal: VerifiedTenantPrincipal = {
    userId: USER_ID,
    branchId: BRANCH_ID,
    globalRole: "admin",
    branchRole: "manager",
};
const capability = {
    name: "clients.create",
    domain: "clients",
    version: "1.0.0",
    description: "Create",
    risk: "reversible-write" as const,
    requiredRoles: ["owner", "admin", "manager"],
    renderer: "action-proposal" as const,
    flagKey: "agent.capability.clients.create",
    sideEffect: true,
    approvalPolicy: "structured" as const,
    idempotencyPolicy: "action-id" as const,
};

describeAgentE2E("agent task API against the guarded local database", () => {
    let prisma: PrismaClient;
    let repository: PrismaAgentTaskRepository;
    let sessionId: string;

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await prisma.agent_session.deleteMany({ where: { userId: USER_ID, branchId: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.create({ data: { id: USER_ID, email: "agent-task-api-test@example.invalid" } });
        await prisma.branch.create({ data: { id: BRANCH_ID, name: "Agent task API test branch", slug: "agent-task-api-test" } });
        sessionId = "99000000-0000-4000-8000-000000000001";
        await prisma.agent_session.create({
            data: {
                id: sessionId,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "task-api-test",
                agentVersion: "task-api-test",
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });
        repository = new PrismaAgentTaskRepository(prisma as never);
    });

    afterAll(async () => {
        await prisma.agent_task_event.deleteMany({ where: { sessionId } });
        await prisma.agent_task.deleteMany({ where: { sessionId } });
        await prisma.agent_session.deleteMany({ where: { id: sessionId } });
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        await prisma.agent_task_event.deleteMany({ where: { sessionId } });
        await prisma.agent_task.deleteMany({ where: { sessionId } });
    });

    function service(): AgentTaskService {
        const policy = {
            assertCanCreate: jest.fn().mockResolvedValue(capability),
            assertCanPatch: jest.fn().mockReturnValue(capability),
        };
        const clients = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(null) };
        return new AgentTaskService(repository as never, policy as never, clients as never);
    }

    it("replays the durable create receipt after a fresh service instance", async () => {
        const clientEventId = "9a000000-0000-4000-8000-000000000001";
        const request = {
            sessionId,
            capabilityId: "clients.create",
            clientEventId,
            operations: [
                { op: "set", field: "name", value: "API test" },
                { op: "set", field: "phone", value: "010-1234-5678" },
            ],
        };
        const first = await service().create(principal, request);
        const replay = await service().create(principal, request);

        expect(replay.receipt).toEqual(first.receipt);
        expect(replay.snapshot.taskId).toBe(first.snapshot.taskId);
        expect(await prisma.agent_task_event.count({ where: { sessionId } })).toBe(1);
    });

    it("keeps a clear marker after a fresh service read", async () => {
        const task = await service().create(principal, {
            sessionId,
            capabilityId: "clients.create",
            clientEventId: "9b000000-0000-4000-8000-000000000001",
            operations: [{ op: "set", field: "name", value: "Clear API test" }, { op: "set", field: "phone", value: "01099998888" }],
        });
        await service().patch(principal, task.snapshot.taskId, {
            clientEventId: "9c000000-0000-4000-8000-000000000001",
            expectedRevision: task.snapshot.revision,
            operations: [{ op: "clear", field: "address" }],
        });

        const restored = await service().get(principal, task.snapshot.taskId);
        expect(restored.clearedFields).toEqual(["address"]);
        expect(await prisma.agent_task_event.count({ where: { taskId: task.snapshot.taskId } })).toBe(2);
    });

    it("round-trips a corrected update without retaining the discarded date", async () => {
        const task = await service().create(principal, {
            sessionId,
            capabilityId: "clients.update",
            clientEventId: "9d000000-0000-4000-8000-000000000001",
            operations: [
                { op: "set", field: "name", value: "Date API test" },
                { op: "set", field: "phone", value: "01088887777" },
                { op: "set", field: "startDate", value: "2026-03-01" },
            ],
        });
        await service().patch(principal, task.snapshot.taskId, {
            clientEventId: "9e000000-0000-4000-8000-000000000001",
            expectedRevision: task.snapshot.revision,
            operations: [
                { op: "discard-change", field: "startDate" },
                { op: "set", field: "dueDate", value: "2026-03-05" },
            ],
        });

        const restored = await service().get(principal, task.snapshot.taskId);
        expect(restored.confirmed.startDate).toBeUndefined();
        expect(restored.confirmed.dueDate).toBe("2026-03-05");
    });
});
