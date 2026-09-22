import { INestApplication } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { Prisma, PrismaClient } from "@prisma/client";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";

import { AgentController } from "interface/controllers/agent.controller";
import { AgentTaskController } from "interface/controllers/agent-task.controller";
import { AgentRuntimeService } from "application/agent/agent-runtime.service";
import { AgentFlagsService } from "application/agent/agent-flags.service";
import { AgentRateLimitService } from "application/agent/agent-rate-limit.service";
import { AgentModelFactory } from "infrastructure/agent/agent-model.factory";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { AgentTaskService } from "application/agent/agent-task.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext, TenantGuard } from "infrastructure/tenant";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { PrismaAgentSessionRepository } from "infrastructure/database/repositories/prisma-agent-session.repository";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { ServiceRecordSentryExceptionFilter } from "infrastructure/observability/service-record-sentry-exception.filter";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const USER_ID = "97000000-0000-4000-8000-000000000001";
const BRANCH_ID = "98000000-0000-4000-8000-000000000001";
const FOREIGN_USER_ID = "97000000-0000-4000-8000-000000000002";
const OTHER_BRANCH_ID = "98000000-0000-4000-8000-000000000002";
const MISSING_MEMBERSHIP_USER_ID = "97000000-0000-4000-8000-000000000003";
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
    let httpApp: INestApplication;
    let httpTaskService!: AgentTaskService;
    let guardedHttpApp: INestApplication;
    let guardedJwt!: JwtService;
    let guardedSetupCompleted = false;
    let authSessionId: string;
    let foreignUserAuthSessionId: string;
    let foreignBranchAuthSessionId: string;
    let missingMembershipAuthSessionId: string;
    const authFixtureIds: string[] = [];
    let httpSetupCompleted = false;
    const extraSessionIds: string[] = [];

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        const fixtureUserIds = [USER_ID, FOREIGN_USER_ID, MISSING_MEMBERSHIP_USER_ID];
        const fixtureBranchIds = [BRANCH_ID, OTHER_BRANCH_ID];
        await prisma.agent_session.deleteMany({ where: { userId: { in: fixtureUserIds } } });
        await prisma.auth_session.deleteMany({ where: { userId: { in: fixtureUserIds } } });
        await prisma.user_branch.deleteMany({ where: { userId: { in: fixtureUserIds }, branchId: { in: fixtureBranchIds } } });
        await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
        await prisma.branch.deleteMany({ where: { id: { in: fixtureBranchIds } } });
        await prisma.user.create({ data: {
            id: USER_ID,
            email: "agent-task-api-test@example.invalid",
            role: "admin",
            approvalStatus: "approved",
            tokenVersion: 0,
        } });
        await prisma.user.create({ data: {
            id: FOREIGN_USER_ID,
            email: "agent-task-api-foreign@example.invalid",
            role: "admin",
            approvalStatus: "approved",
            tokenVersion: 0,
        } });
        await prisma.user.create({ data: {
            id: MISSING_MEMBERSHIP_USER_ID,
            email: "agent-task-api-missing-membership@example.invalid",
            role: "admin",
            approvalStatus: "approved",
            tokenVersion: 0,
        } });
        await prisma.branch.create({ data: { id: BRANCH_ID, name: "Agent task API test branch", slug: "agent-task-api-test", isActive: true } });
        await prisma.branch.create({ data: { id: OTHER_BRANCH_ID, name: "Agent task API other branch", slug: "agent-task-api-other", isActive: true } });
        await prisma.user_branch.createMany({ data: [
            { userId: USER_ID, branchId: BRANCH_ID, role: "manager" },
            { userId: USER_ID, branchId: OTHER_BRANCH_ID, role: "manager" },
            { userId: FOREIGN_USER_ID, branchId: BRANCH_ID, role: "manager" },
        ] });
        authSessionId = randomUUID();
        foreignUserAuthSessionId = randomUUID();
        foreignBranchAuthSessionId = randomUUID();
        missingMembershipAuthSessionId = randomUUID();
        authFixtureIds.push(authSessionId, foreignUserAuthSessionId, foreignBranchAuthSessionId, missingMembershipAuthSessionId);
        await prisma.auth_session.createMany({ data: [
            { id: authSessionId, userId: USER_ID, selectedBranchId: BRANCH_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
            { id: foreignUserAuthSessionId, userId: FOREIGN_USER_ID, selectedBranchId: BRANCH_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
            { id: foreignBranchAuthSessionId, userId: USER_ID, selectedBranchId: OTHER_BRANCH_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
            { id: missingMembershipAuthSessionId, userId: MISSING_MEMBERSHIP_USER_ID, selectedBranchId: BRANCH_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        ] });
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

        const sessionService = new AgentSessionService(
            new PrismaAgentSessionRepository(prisma as never),
            new ConfigService(),
            { holdsLease: () => true } as never,
        );
        const policy = {
            assertCanCreate: jest.fn().mockResolvedValue(capability),
            assertCanPatch: jest.fn().mockReturnValue(capability),
        };
        const clients = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(null),
        };
        const taskService = new AgentTaskService(repository as never, policy as never, clients as never);
        httpTaskService = taskService;
        const jwtGuard = {
            canActivate: (context: { switchToHttp(): { getRequest(): { user?: unknown } } }) => {
                context.switchToHttp().getRequest().user = {
                    userId: USER_ID,
                    branchId: BRANCH_ID,
                    role: "admin",
                };
                return true;
            },
        };
        const tenantGuard = {
            canActivate: (context: { switchToHttp(): { getRequest(): { headers: Record<string, string | undefined>; tenant?: VerifiedTenantPrincipal } } }) => {
                const request = context.switchToHttp().getRequest();
                const mode = request.headers["x-agent-e2e-principal"];
                if (mode === "missing") return true;
                const tenant = mode === "other-user"
                    ? { ...principal, userId: "97000000-0000-4000-8000-000000000002" }
                    : mode === "other-branch"
                        ? { ...principal, branchId: "98000000-0000-4000-8000-000000000002" }
                        : principal;
                request.tenant = tenant;
                tenantContextStore.setBranchId(tenant.branchId);
                return true;
            },
        };
        const moduleRef = await Test.createTestingModule({
            controllers: [AgentController, AgentTaskController],
            providers: [
                { provide: AgentRuntimeService, useValue: {} },
                { provide: AgentSessionService, useValue: sessionService },
                { provide: CapabilityRegistryService, useValue: {} },
                { provide: AgentFlagsService, useValue: {} },
                { provide: AgentRateLimitService, useValue: {} },
                { provide: AgentModelFactory, useValue: {} },
                { provide: AgentTaskService, useValue: taskService },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(jwtGuard)
            .overrideGuard(TenantGuard)
            .useValue(tenantGuard)
            .compile();
        httpApp = moduleRef.createNestApplication();
        httpApp.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        httpApp.useGlobalFilters(new ServiceRecordSentryExceptionFilter(httpApp.get(HttpAdapterHost)));
        await httpApp.init();
        httpSetupCompleted = true;

        const guardedModuleRef = await Test.createTestingModule({
            imports: [
                PassportModule.register({ defaultStrategy: "jwt" }),
                JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: "7d" } }),
            ],
            controllers: [AgentController, AgentTaskController],
            providers: [
                { provide: PrismaService, useValue: prisma },
                { provide: AgentRuntimeService, useValue: {} },
                { provide: AgentSessionService, useValue: sessionService },
                { provide: CapabilityRegistryService, useValue: {} },
                { provide: AgentFlagsService, useValue: {} },
                { provide: AgentRateLimitService, useValue: {} },
                { provide: AgentModelFactory, useValue: {} },
                { provide: AgentTaskService, useValue: taskService },
                JwtStrategy,
                JwtGuard,
                TenantContext,
                TenantGuard,
            ],
        }).compile();
        guardedHttpApp = guardedModuleRef.createNestApplication();
        guardedHttpApp.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        guardedHttpApp.useGlobalFilters(new ServiceRecordSentryExceptionFilter(guardedHttpApp.get(HttpAdapterHost)));
        await guardedHttpApp.init();
        guardedJwt = guardedModuleRef.get(JwtService);
        guardedSetupCompleted = true;
    }, 30_000);

    afterAll(async () => {
        if (httpSetupCompleted) await httpApp.close();
        if (guardedSetupCompleted) await guardedHttpApp.close();
        await prisma.agent_task_event.deleteMany({ where: { sessionId } });
        await prisma.agent_task.deleteMany({ where: { sessionId } });
        if (extraSessionIds.length > 0) {
            await prisma.agent_session.deleteMany({ where: { id: { in: extraSessionIds } } });
        }
        await prisma.agent_session.deleteMany({ where: { id: sessionId } });
        if (authFixtureIds.length > 0) {
            await prisma.auth_session.deleteMany({ where: { id: { in: authFixtureIds } } });
        }
        await prisma.user_branch.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID, MISSING_MEMBERSHIP_USER_ID] } } });
        await prisma.branch.deleteMany({ where: { id: { in: [BRANCH_ID, OTHER_BRANCH_ID] } } });
        await prisma.user.deleteMany({ where: { id: { in: [USER_ID, FOREIGN_USER_ID, MISSING_MEMBERSHIP_USER_ID] } } });
        await prisma.$disconnect();
    }, 30_000);

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

    async function createExtraSession(input: { expiresAt: Date; archivedAt?: Date | null }) {
        const id = randomUUID();
        const created = await prisma.agent_session.create({
            data: {
                id,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "task-api-http-test",
                agentVersion: "task-api-http-test",
                expiresAt: input.expiresAt,
                ...(input.archivedAt === undefined ? {} : { archivedAt: input.archivedAt }),
            },
        });
        extraSessionIds.push(id);
        return created;
    }

    async function guardedToken(input: {
        userId: string;
        sessionId: string;
        branchId: string;
        branchRole?: string;
        role?: string;
    }): Promise<string> {
        return guardedJwt.signAsync({
            sub: input.userId,
            sid: input.sessionId,
            role: input.role ?? "admin",
            tokenVersion: 0,
            type: "access",
            branchId: input.branchId,
            branchRole: input.branchRole ?? "manager",
        });
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

    it("serves accepted create/edit HTTP responses and preserves an owned stale conflict snapshot", async () => {
        const createResponse = await request(httpApp.getHttpServer())
            .post("/ai/agent/tasks")
            .send({
                sessionId,
                capabilityId: "clients.create",
                clientEventId: randomUUID(),
                operations: [
                    { op: "set", field: "name", value: "HTTP API test" },
                    { op: "set", field: "phone", value: "010-1234-5678" },
                ],
            })
            .expect(201);
        expect(createResponse.headers["cache-control"]).toBe("no-store");
        const taskId = createResponse.body.snapshot.taskId as string;
        const revision = createResponse.body.snapshot.revision as number;

        const editResponse = await request(httpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: revision,
                operations: [{ op: "set", field: "address", value: "서울" }],
            })
            .expect(200);
        expect(editResponse.headers["cache-control"]).toBe("no-store");
        expect(editResponse.body.snapshot.confirmed.address).toBe("서울");

        const stale = await request(httpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: revision,
                operations: [{ op: "set", field: "address", value: "부산" }],
            })
            .expect(409);
        expect(stale.headers["cache-control"]).toBe("no-store");
        expect(stale.body).toMatchObject({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "revision" });
        expect(stale.body.snapshot).toEqual(expect.objectContaining({ taskId, revision: revision + 1 }));
        expect(stale.body.receipt).toBeUndefined();
        expect(JSON.stringify(stale.body)).not.toContain("부산");
        expect(stale.body.snapshot.server).toBeUndefined();
    });

    it("returns scoped 404s without snapshots and rejects absent principals", async () => {
        const createResponse = await request(httpApp.getHttpServer())
            .post("/ai/agent/tasks")
            .send({
                sessionId,
                capabilityId: "clients.create",
                clientEventId: randomUUID(),
                operations: [
                    { op: "set", field: "name", value: "Scoped HTTP test" },
                    { op: "set", field: "phone", value: "010-1234-5678" },
                ],
            })
            .expect(201);
        const taskId = createResponse.body.snapshot.taskId as string;

        const foreign = await request(httpApp.getHttpServer())
            .get(`/ai/agent/tasks/${taskId}`)
            .set("x-agent-e2e-principal", "other-user")
            .expect(404);
        expect(foreign.body.snapshot).toBeUndefined();

        await request(httpApp.getHttpServer())
            .get(`/ai/agent/tasks/${taskId}`)
            .set("x-agent-e2e-principal", "missing")
            .expect(403);
    });

    it("refuses a linked active action through the real HTTP conflict path", async () => {
        const createResponse = await request(httpApp.getHttpServer())
            .post("/ai/agent/tasks")
            .send({
                sessionId,
                capabilityId: "clients.create",
                clientEventId: randomUUID(),
                operations: [
                    { op: "set", field: "name", value: "Active action HTTP test" },
                    { op: "set", field: "phone", value: "010-1234-5678" },
                ],
            })
            .expect(201);
        const taskId = createResponse.body.snapshot.taskId as string;
        await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: randomUUID() } });

        const response = await request(httpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: createResponse.body.snapshot.revision,
                operations: [{ op: "set", field: "address", value: "서울" }],
            })
            .expect(409);
        expect(response.body).toMatchObject({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "active_task" });
        expect(response.body.snapshot).toEqual(expect.objectContaining({ taskId }));
    });

    it("persists provenance source changes and review metadata cleanup across a task reload", async () => {
        const created = await request(httpApp.getHttpServer())
            .post("/ai/agent/tasks")
            .send({
                sessionId,
                capabilityId: "clients.create",
                clientEventId: randomUUID(),
                operations: [
                    { op: "set", field: "name", value: "Persisted provenance test" },
                    { op: "set", field: "phone", value: "010-1234-5678" },
                ],
            })
            .expect(201);
        const taskId = created.body.snapshot.taskId as string;
        const row = await prisma.agent_task.findUnique({ where: { id: taskId } });
        if (!row) throw new Error("Expected persisted task row");
        const draft = JSON.parse(JSON.stringify(row.draft)) as {
            provenance: { confirmed: Record<string, unknown> };
            server: Record<string, unknown>;
        };
        draft.provenance.confirmed["name"] = {
            source: "model",
            capturedAt: "2026-01-01T00:00:00.000Z",
            eventId: randomUUID(),
            valueRef: randomUUID(),
        };
        draft.server["actionExpectedRevision"] = "review-only-v1";
        draft.server["actionProposalRevision"] = 4;
        await prisma.agent_task.update({
            where: { id: taskId },
            data: { status: "review_ready", draft: draft as Prisma.InputJsonValue },
        });
        const before = await prisma.agent_task.findUnique({ where: { id: taskId } });

        const edited = await request(httpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: created.body.snapshot.revision,
                operations: [{ op: "set", field: "name", value: "Persisted provenance test" }],
            })
            .expect(200);
        expect(edited.body.snapshot.state).toBe("collecting");
        expect(edited.body.snapshot.revision).toBe(created.body.snapshot.revision + 1);
        expect(edited.body.snapshot.provenance.confirmed.name.source).toBe("user");

        const after = await prisma.agent_task.findUnique({ where: { id: taskId } });
        expect(after?.revision).toBe((before?.revision ?? 0) + 1);
        const persistedDraft = after?.draft as { server?: Record<string, unknown> } | undefined;
        expect(persistedDraft?.server?.["actionExpectedRevision"]).toBeUndefined();
        expect(persistedDraft?.server?.["actionProposalRevision"]).toBeUndefined();
    });

    it("restores live, archived, and expired owned sessions without changing TTL", async () => {
        const liveBefore = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        const live = await request(httpApp.getHttpServer()).get(`/ai/agent/sessions/${sessionId}`).expect(200);
        expect(live.headers["cache-control"]).toBe("no-store");
        expect(live.body).toMatchObject({ taskRestoreStatus: "available", activeTaskId: null, pausedTaskIds: [] });
        const liveAfter = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        expect(liveAfter?.expiresAt).toEqual(liveBefore?.expiresAt);
        expect(liveAfter?.updatedAt).toEqual(liveBefore?.updatedAt);

        const archived = await createExtraSession({
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            archivedAt: new Date(),
        });
        const archivedBefore = await prisma.agent_session.findUnique({ where: { id: archived.id } });
        const archivedResponse = await request(httpApp.getHttpServer()).get(`/ai/agent/sessions/${archived.id}`).expect(200);
        expect(archivedResponse.body).toMatchObject({ taskRestoreStatus: "session_archived", activeTaskId: null, pausedTaskIds: [] });
        const archivedAfter = await prisma.agent_session.findUnique({ where: { id: archived.id } });
        expect(archivedAfter?.expiresAt).toEqual(archivedBefore?.expiresAt);
        expect(archivedAfter?.updatedAt).toEqual(archivedBefore?.updatedAt);

        const expired = await createExtraSession({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) });
        const expiredBefore = await prisma.agent_session.findUnique({ where: { id: expired.id } });
        const expiredResponse = await request(httpApp.getHttpServer()).get(`/ai/agent/sessions/${expired.id}`).expect(200);
        expect(expiredResponse.body).toMatchObject({ taskRestoreStatus: "session_expired", activeTaskId: null, pausedTaskIds: [] });
        const expiredAfter = await prisma.agent_session.findUnique({ where: { id: expired.id } });
        expect(expiredAfter?.expiresAt).toEqual(expiredBefore?.expiresAt);
        expect(expiredAfter?.updatedAt).toEqual(expiredBefore?.updatedAt);
    });

    it("does not query task restore for a foreign session and preserves no-store on session 404", async () => {
        const restoreSpy = jest.spyOn(httpTaskService, "restoreSession");
        try {
            const response = await request(httpApp.getHttpServer())
                .get(`/ai/agent/sessions/${sessionId}`)
                .set("x-agent-e2e-principal", "other-branch")
                .expect(404);
            expect(response.headers["cache-control"]).toBe("no-store");
            expect(restoreSpy).not.toHaveBeenCalled();
        } finally {
            restoreSpy.mockRestore();
        }
    });

    it("proves the real JWT and tenant guards reject invalid tokens and missing membership", async () => {
        await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${sessionId}`)
            .set("Authorization", "Bearer not-a-jwt")
            .expect(401);

        const missingMembershipToken = await guardedToken({
            userId: MISSING_MEMBERSHIP_USER_ID,
            sessionId: missingMembershipAuthSessionId,
            branchId: BRANCH_ID,
        });
        await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${sessionId}`)
            .set("Authorization", `Bearer ${missingMembershipToken}`)
            .expect(403);
    });

    it("proves the real owner scope, inactive restore classification, and unchanged TTL", async () => {
        const token = await guardedToken({ userId: USER_ID, sessionId: authSessionId, branchId: BRANCH_ID });
        const before = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        const live = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${sessionId}`)
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(live.headers["cache-control"]).toBe("no-store");
        expect(live.body).toMatchObject({ taskRestoreStatus: "available", activeTaskId: null, pausedTaskIds: [] });
        const after = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        expect(after?.expiresAt).toEqual(before?.expiresAt);
        expect(after?.updatedAt).toEqual(before?.updatedAt);

        const archived = await createExtraSession({
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            archivedAt: new Date(),
        });
        const archivedBefore = await prisma.agent_session.findUnique({ where: { id: archived.id } });
        const archivedResponse = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${archived.id}`)
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(archivedResponse.body).toMatchObject({ taskRestoreStatus: "session_archived", activeTaskId: null, pausedTaskIds: [] });
        const archivedAfter = await prisma.agent_session.findUnique({ where: { id: archived.id } });
        expect(archivedAfter?.expiresAt).toEqual(archivedBefore?.expiresAt);
        expect(archivedAfter?.updatedAt).toEqual(archivedBefore?.updatedAt);

        const expired = await createExtraSession({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) });
        const expiredBefore = await prisma.agent_session.findUnique({ where: { id: expired.id } });
        const expiredResponse = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${expired.id}`)
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(expiredResponse.body).toMatchObject({ taskRestoreStatus: "session_expired", activeTaskId: null, pausedTaskIds: [] });
        const expiredAfter = await prisma.agent_session.findUnique({ where: { id: expired.id } });
        expect(expiredAfter?.expiresAt).toEqual(expiredBefore?.expiresAt);
        expect(expiredAfter?.updatedAt).toEqual(expiredBefore?.updatedAt);

        const foreignUserToken = await guardedToken({
            userId: FOREIGN_USER_ID,
            sessionId: foreignUserAuthSessionId,
            branchId: BRANCH_ID,
        });
        const foreignUserResponse = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${sessionId}`)
            .set("Authorization", `Bearer ${foreignUserToken}`)
            .expect(404);
        expect(foreignUserResponse.headers["cache-control"]).toBe("no-store");

        const foreignBranchToken = await guardedToken({
            userId: USER_ID,
            sessionId: foreignBranchAuthSessionId,
            branchId: OTHER_BRANCH_ID,
        });
        await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/sessions/${sessionId}`)
            .set("Authorization", `Bearer ${foreignBranchToken}`)
            .expect(404);
    });

    it("proves accepted edit, owned stale 409 snapshot, and active-action refusal through real guards", async () => {
        const token = await guardedToken({ userId: USER_ID, sessionId: authSessionId, branchId: BRANCH_ID });
        const created = await request(guardedHttpApp.getHttpServer())
            .post("/ai/agent/tasks")
            .set("Authorization", `Bearer ${token}`)
            .send({
                sessionId,
                capabilityId: "clients.create",
                clientEventId: randomUUID(),
                operations: [
                    { op: "set", field: "name", value: "Real guard API test" },
                    { op: "set", field: "phone", value: "010-1234-5678" },
                ],
            })
            .expect(201);
        expect(created.headers["cache-control"]).toBe("no-store");
        const taskId = created.body.snapshot.taskId as string;
        const revision = created.body.snapshot.revision as number;
        const edited = await request(guardedHttpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .set("Authorization", `Bearer ${token}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: revision,
                operations: [{ op: "set", field: "address", value: "서울" }],
            })
            .expect(200);
        expect(edited.body.snapshot.confirmed.address).toBe("서울");

        const stale = await request(guardedHttpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .set("Authorization", `Bearer ${token}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: revision,
                operations: [{ op: "set", field: "address", value: "부산" }],
            })
            .expect(409);
        expect(stale.headers["cache-control"]).toBe("no-store");
        expect(stale.body).toMatchObject({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "revision" });
        expect(stale.body.snapshot).toEqual(expect.objectContaining({ taskId, revision: revision + 1 }));
        expect(stale.body.receipt).toBeUndefined();
        expect(JSON.stringify(stale.body)).not.toContain("부산");

        const foreignUserToken = await guardedToken({
            userId: FOREIGN_USER_ID,
            sessionId: foreignUserAuthSessionId,
            branchId: BRANCH_ID,
        });
        const foreignTaskResponse = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/tasks/${taskId}`)
            .set("Authorization", `Bearer ${foreignUserToken}`)
            .expect(404);
        expect(foreignTaskResponse.headers["cache-control"]).toBe("no-store");
        expect(foreignTaskResponse.body.snapshot).toBeUndefined();

        const foreignBranchToken = await guardedToken({
            userId: USER_ID,
            sessionId: foreignBranchAuthSessionId,
            branchId: OTHER_BRANCH_ID,
        });
        const foreignBranchTaskResponse = await request(guardedHttpApp.getHttpServer())
            .get(`/ai/agent/tasks/${taskId}`)
            .set("Authorization", `Bearer ${foreignBranchToken}`)
            .expect(404);
        expect(foreignBranchTaskResponse.headers["cache-control"]).toBe("no-store");
        expect(foreignBranchTaskResponse.body.snapshot).toBeUndefined();

        await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: randomUUID() } });
        const active = await request(guardedHttpApp.getHttpServer())
            .patch(`/ai/agent/tasks/${taskId}`)
            .set("Authorization", `Bearer ${token}`)
            .send({
                clientEventId: randomUUID(),
                expectedRevision: edited.body.snapshot.revision,
                operations: [{ op: "set", field: "address", value: "대전" }],
            })
            .expect(409);
        expect(active.body).toMatchObject({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "active_task" });
        expect(active.body.snapshot).toEqual(expect.objectContaining({ taskId }));
    });
});
