import { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";

import {
    AgentTaskCommandRequestSchema,
    type AgentTask,
} from "@babyjamjam/shared";
import { AgentTaskController } from "interface/controllers/agent-task.controller";
import { AgentTaskService } from "application/agent/agent-task.service";
import { ConversationTaskOrchestratorService } from "application/agent/conversation-task-orchestrator.service";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { createEmptyAgentTaskDraft, type AgentTaskDraft } from "domain/entities/agent-task.entity";
import type { ClientEntity } from "domain/entities/client.entity";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { ServiceRecordSentryExceptionFilter } from "infrastructure/observability/service-record-sentry-exception.filter";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";
import {
    conversationMessageEventId,
    conversationMessageHash,
} from "application/agent/conversation-task-policy";

/**
 * These are real database and HTTP checks. They are opt-in through the same
 * strict AGENT_E2E database guard used by the other agent suites; no separate
 * conversation-only gate may turn this file into a schema-only fixture.
 */
const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;

const USER_ID = "9a000000-0000-4000-8000-000000000001";
const BRANCH_ID = "9b000000-0000-4000-8000-000000000001";
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

function futureDate(): Date {
    return new Date(Date.now() + 60 * 60 * 1000);
}

function makeClient(id: number, name = `대상 고객 ${id}`): ClientEntity {
    return {
        id,
        name,
        address: null,
        phone: `0101234${String(id).padStart(4, "0")}`,
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        dueDate: null,
        birthDate: null,
        careCenter: null,
        voucherClient: false,
        birthday: null,
        serviceStatus: "pre_booking",
        breastPump: false,
        eDocId: null,
        areaId: null,
        branchId: BRANCH_ID,
    } as unknown as ClientEntity;
}

function taskDraft(snapshotRef = randomUUID()): AgentTaskDraft {
    return createEmptyAgentTaskDraft(snapshotRef);
}

function policyStub() {
    return {
        assertCanCreate: jest.fn().mockResolvedValue(capability),
        assertCanPatch: jest.fn().mockReturnValue(capability),
        assertCanStartUpdate: jest.fn().mockResolvedValue(undefined),
        assertCanPrepareReview: jest.fn().mockResolvedValue(capability),
    };
}

describeAgentE2E("conversation task runtime against the guarded local database", () => {
    let prisma: PrismaClient;
    let repository: PrismaAgentTaskRepository;
    let sessionId: string;
    let httpApp: INestApplication;
    let httpSetupCompleted = false;
    const sessionIds = new Set<string>();
    const clientsById = new Map<number, ClientEntity>();

    const clients = {
        findByPhone: jest.fn().mockResolvedValue(null),
        findById: jest.fn().mockImplementation(async (_branchId: string, id: number) => clientsById.get(id) ?? null),
        findByIdForUpdate: jest.fn().mockImplementation(async (_branchId: string, id: number) => clientsById.get(id) ?? null),
    };

    function service(): AgentTaskService {
        return new AgentTaskService(repository as never, policyStub() as never, clients as never);
    }

    function scope(forSession = sessionId) {
        return { userId: USER_ID, branchId: BRANCH_ID, sessionId: forSession };
    }

    async function createSession(): Promise<string> {
        const id = randomUUID();
        sessionIds.add(id);
        await prisma.agent_session.create({
            data: {
                id,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "conversation-task-e2e",
                agentVersion: "conversation-task-e2e",
                expiresAt: futureDate(),
            },
        });
        return id;
    }

    async function removeSession(id: string): Promise<void> {
        await prisma.agent_task_event.deleteMany({ where: { sessionId: id } });
        await prisma.agent_action.deleteMany({ where: { sessionId: id } });
        await prisma.agent_task.deleteMany({ where: { sessionId: id } });
        await prisma.agent_session.deleteMany({ where: { id } });
    }

    async function seedResolvedCreate(input: {
        sessionId: string;
        taskId?: string;
        targetRef?: string;
        target?: ClientEntity;
        eventId?: string;
        draft?: AgentTaskDraft;
    }) {
        const target = input.target ?? makeClient(401);
        clientsById.set(target.id, target);
        const targetRef = input.targetRef ?? randomUUID();
        const targetVersion = clientAgentTargetVersion(target);
        const eventId = input.eventId ?? randomUUID();
        const draft = input.draft ?? taskDraft();
        draft.confirmed.name = "명시적 등록 이름";
        draft.provenance.confirmed["name"] = {
            source: "user",
            capturedAt: new Date().toISOString(),
            eventId,
            valueRef: randomUUID(),
        };
        draft.server.references.target = { targetRef, clientId: target.id };
        const created = await repository.createWithEvent(scope(input.sessionId), {
            taskId: input.taskId ?? randomUUID(),
            capabilityId: "clients.create",
            draft,
            status: "collecting",
            targetRef,
            targetVersion,
            expiresAt: futureDate(),
        }, {
            clientEventId: eventId,
            operation: "create",
            requestHash: "a".repeat(64),
            acceptedRevision: 1,
        });
        if (created.status !== "created") throw new Error(`Expected seeded task, got ${created.status}`);
        return { task: created.task, target, targetRef, targetVersion, eventId };
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await prisma.agent_session.deleteMany({ where: { userId: USER_ID, branchId: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.create({ data: { id: USER_ID, email: "agent-task-conversation@example.invalid", role: "admin", approvalStatus: "approved" } });
        await prisma.branch.create({ data: { id: BRANCH_ID, name: "Agent task conversation test branch", slug: "agent-task-conversation-test" } });
        repository = new PrismaAgentTaskRepository(prisma as never);

        const taskService = service();
        const moduleRef = await Test.createTestingModule({
            controllers: [AgentTaskController],
            providers: [{ provide: AgentTaskService, useValue: taskService }],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: { switchToHttp(): { getRequest(): { user?: unknown } } }) => {
                    context.switchToHttp().getRequest().user = { userId: USER_ID, branchId: BRANCH_ID, role: "admin" };
                    return true;
                },
            })
            .overrideGuard(TenantGuard)
            .useValue({
                canActivate: (context: { switchToHttp(): { getRequest(): { tenant?: VerifiedTenantPrincipal } } }) => {
                    const request = context.switchToHttp().getRequest();
                    request.tenant = principal;
                    tenantContextStore.setBranchId(BRANCH_ID);
                    return true;
                },
            })
            .compile();
        httpApp = moduleRef.createNestApplication();
        httpApp.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        httpApp.useGlobalFilters(new ServiceRecordSentryExceptionFilter(httpApp.get(HttpAdapterHost)));
        await httpApp.init();
        httpSetupCompleted = true;
    }, 30_000);

    beforeEach(async () => {
        sessionId = await createSession();
        clientsById.clear();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        const ids = [...sessionIds];
        sessionIds.clear();
        for (const id of ids) await removeSession(id);
    });

    afterAll(async () => {
        if (httpSetupCompleted) await httpApp.close();
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.$disconnect();
    }, 30_000);

    it("validates and executes start-update through the real controller boundary", async () => {
        const seeded = await seedResolvedCreate({ sessionId });
        const command = {
            clientEventId: randomUUID(),
            expectedRevision: seeded.task.revision,
            command: "start-update" as const,
            targetRef: seeded.targetRef,
            expectedTargetVersion: seeded.targetVersion,
        };
        expect(AgentTaskCommandRequestSchema.parse(command)).toEqual(command);

        const response = await request(httpApp.getHttpServer())
            .post(`/ai/agent/tasks/${seeded.task.taskId}/commands`)
            .send(command)
            .expect(201);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body.snapshot.capabilityId).toBe("clients.update");
        expect(response.body.snapshot.taskId).not.toBe(seeded.task.taskId);

        const sourceRow = await prisma.agent_task.findUnique({ where: { id: seeded.task.taskId } });
        const destinationRow = await prisma.agent_task.findUnique({ where: { id: response.body.snapshot.taskId as string } });
        const receiptRow = await prisma.agent_task_event.findFirst({ where: { clientEventId: command.clientEventId } });
        const sessionRow = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        expect(sourceRow).toEqual(expect.objectContaining({ status: "paused", activeSlot: null }));
        expect(destinationRow).toEqual(expect.objectContaining({ capabilityId: "clients.update", activeSlot: 1, revision: 1 }));
        expect(receiptRow).toEqual(expect.objectContaining({ taskId: response.body.snapshot.taskId, operation: "command:start-update" }));
        expect(sourceRow?.lastAcceptedAt).toEqual(destinationRow?.lastAcceptedAt);
        expect(destinationRow?.lastAcceptedAt).toEqual(receiptRow?.acceptedAt);
        expect(sessionRow?.expiresAt).toEqual(destinationRow?.expiresAt);

        await request(httpApp.getHttpServer())
            .post(`/ai/agent/tasks/${seeded.task.taskId}/commands`)
            .send({ ...command, clientEventId: randomUUID(), targetRef: 17 })
            .expect(400);
    });

    it("replays the original conversation intake after another task becomes active and after service recreation", async () => {
        const policy = policyStub();
        const firstService = new AgentTaskService(repository as never, policy as never, clients as never);
        const firstOrchestrator = new ConversationTaskOrchestratorService(firstService, policy as never);
        const original = {
            principal,
            sessionId,
            message: {
                id: randomUUID(),
                role: "user" as const,
                parts: [{ type: "text", text: "이름: 첫 등록, 전화번호: 01012345678" }],
            },
            capabilityId: "clients.create" as const,
        };
        const created = await firstOrchestrator.handleUserTurn(original);
        if (!created.task) throw new Error("Expected original task");
        const paused = await firstService.command(principal, created.task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.task.revision,
            command: "pause",
        });
        expect(paused.snapshot.state).toBe("paused");

        const continuation = await firstOrchestrator.handleUserTurn({
            ...original,
            message: {
                ...original.message,
                id: randomUUID(),
                parts: [{ type: "text", text: "이름: 두 번째 등록, 전화번호: 01012345679" }],
            },
        });
        expect(continuation.task?.taskId).not.toBe(created.task.taskId);

        const restartedPolicy = policyStub();
        const restarted = new AgentTaskService(repository as never, restartedPolicy as never, clients as never);
        const restartedOrchestrator = new ConversationTaskOrchestratorService(restarted, restartedPolicy as never);
        const replay = await restartedOrchestrator.handleUserTurn(original);
        expect(replay.replayed).toBe(true);
        expect(replay.mutated).toBe(false);
        expect(replay.task?.taskId).toBe(created.task.taskId);
        expect(replay.task?.state).toBe("paused");

        await expect(restartedOrchestrator.handleUserTurn({
            ...original,
            message: { ...original.message, parts: [{ type: "text", text: "이름: 변조된 재시도" }] },
        })).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "event_payload" }),
        });

        await prisma.agent_task.update({ where: { id: created.task.taskId }, data: { purgedAt: new Date() } });
        const intakeEventId = conversationMessageEventId({
            userId: USER_ID,
            branchId: BRANCH_ID,
            sessionId,
            messageId: original.message.id,
        });
        const intakeHash = conversationMessageHash({
            userId: USER_ID,
            branchId: BRANCH_ID,
            sessionId,
            messageId: original.message.id,
            text: "이름: 첫 등록, 전화번호: 01012345678",
        });
        await expect(restarted.replayConversationIntake(principal, sessionId, intakeEventId, intakeHash))
            .rejects.toMatchObject({ status: 410 });
    });

    it("stores explicit text/form facts only in the protected task draft and leaves receipts text-free", async () => {
        const taskService = service();
        const orchestrator = new ConversationTaskOrchestratorService(taskService, policyStub() as never);
        const messageId = randomUUID();
        const protectedText = "이름: 보호된 이름, 전화번호: 01024681357";
        const protectedAddress = "서울시 보호구역 101";
        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            capabilityId: "clients.create",
            message: {
                id: messageId,
                role: "user",
                parts: [{ type: "text", text: protectedText }],
            },
            formSubmission: { formId: "client-intake", values: { address: protectedAddress } },
        });
        if (!result.task) throw new Error("Expected captured task");
        const row = await prisma.agent_task.findUnique({ where: { id: result.task.taskId } });
        if (!row) throw new Error("Expected persisted task row");
        const events = await prisma.agent_task_event.findMany({ where: { sessionId } });
        expect(JSON.stringify(row.draft)).toContain("보호된 이름");
        expect(JSON.stringify(row.draft)).toContain("01024681357");
        expect(JSON.stringify(row.draft)).toContain(protectedAddress);
        expect(JSON.stringify(events)).not.toContain(protectedText);
        expect(JSON.stringify(events)).not.toContain("01024681357");
        expect(await prisma.agent_message.count({ where: { sessionId } })).toBe(0);
    });

    it("replaces derived choices, replays them without a TTL extension, and keeps identity references protected", async () => {
        clientsById.set(401, makeClient(401, "선택 고객 하나"));
        clientsById.set(402, makeClient(402, "선택 고객 둘"));
        const taskService = service();
        const created = await taskService.create(principal, {
            sessionId,
            capabilityId: "clients.create",
            clientEventId: randomUUID(),
            operations: [
                { op: "set", field: "name", value: "선택 입력" },
                { op: "set", field: "phone", value: "01088887777" },
            ],
        });
        const first = await taskService.attachChoices(principal, created.snapshot.taskId, {
            expectedRevision: created.snapshot.revision,
            producer: "client-target",
            results: [{ label: "ignored", clientId: 401 }],
        });
        const storedFirst = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        const sessionBeforeChoices = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        if (!storedFirst) throw new Error("Expected persisted choice task");
        const replay = await taskService.attachChoices(principal, created.snapshot.taskId, {
            expectedRevision: created.snapshot.revision,
            producer: "client-target",
            results: [{ label: "ignored", clientId: 401 }],
        });
        const storedReplay = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(replay.receipt).toEqual(first.receipt);
        expect(replay.snapshot.revision).toBe(first.snapshot.revision);
        expect(storedReplay?.lastAcceptedAt).toEqual(storedFirst.lastAcceptedAt);
        expect(storedReplay?.expiresAt).toEqual(storedFirst.expiresAt);

        const replacement = await taskService.attachChoices(principal, created.snapshot.taskId, {
            expectedRevision: first.snapshot.revision,
            producer: "client-target",
            results: [{ label: "ignored", clientId: 402 }],
        });
        expect(replacement.snapshot.revision).toBe(first.snapshot.revision + 1);
        expect(replacement.snapshot.choiceSets).toHaveLength(1);
        expect(replacement.snapshot.choiceSets[0]?.options[0]?.label).toBe("선택 고객 둘");
        const storedReplacement = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(storedReplacement?.lastAcceptedAt).toEqual(storedFirst.lastAcceptedAt);
        expect(storedReplacement?.expiresAt).toEqual(storedFirst.expiresAt);
        const sessionAfterChoices = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        expect(sessionAfterChoices?.expiresAt).toEqual(sessionBeforeChoices?.expiresAt);
        expect(JSON.stringify(replacement.snapshot)).not.toContain("clientId");
        expect(JSON.stringify(storedReplacement?.draft)).toContain("402");
    });

    it("keeps GET read-only and omits protected task references from the HTTP projection", async () => {
        const questionService = service();
        const question = await new ConversationTaskOrchestratorService(questionService, policyStub() as never).handleUserTurn({
            principal,
            sessionId,
            capabilityId: "clients.create",
            message: {
                id: randomUUID(),
                role: "user",
                parts: [{ type: "text", text: "오늘 운영시간이 어떻게 돼?" }],
            },
        });
        expect(question.isQuestion).toBe(true);
        expect(question.task).toBeNull();
        expect(question.mutated).toBe(false);
        expect(await prisma.agent_task.count({ where: { sessionId } })).toBe(0);
        expect(await prisma.agent_task_event.count({ where: { sessionId } })).toBe(0);

        clientsById.set(401, makeClient(401, "조회 대상 고객"));
        const taskService = service();
        const created = await taskService.create(principal, {
            sessionId,
            capabilityId: "clients.create",
            clientEventId: randomUUID(),
            operations: [
                { op: "set", field: "name", value: "조회 테스트" },
                { op: "set", field: "phone", value: "01077776666" },
            ],
        });
        await taskService.attachChoices(principal, created.snapshot.taskId, {
            expectedRevision: created.snapshot.revision,
            producer: "client-target",
            results: [{ label: "ignored", clientId: 401 }],
        });
        const before = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        if (!before) throw new Error("Expected task row");
        const response = await request(httpApp.getHttpServer())
            .get(`/ai/agent/tasks/${created.snapshot.taskId}`)
            .expect(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body.server).toBeUndefined();
        expect(response.body.choiceSets[0].options[0].label).toBe("조회 대상 고객");
        const after = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(after?.revision).toBe(before.revision);
        expect(after?.updatedAt).toEqual(before.updatedAt);
    });

    it("serializes concurrent identical intake edits into one receipt and event", async () => {
        const taskService = service();
        const created = await taskService.create(principal, {
            sessionId,
            capabilityId: "clients.create",
            clientEventId: randomUUID(),
            operations: [{ op: "set", field: "name", value: "동시성 등록" }],
        });
        const clientEventId = randomUUID();
        const input = {
            clientEventId,
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "address", value: "서울" }],
        };
        const [left, right] = await Promise.all([
            taskService.patch(principal, created.snapshot.taskId, input),
            taskService.patch(principal, created.snapshot.taskId, input),
        ]);
        expect(left.receipt).toEqual(right.receipt);
        expect(left.snapshot.revision).toBe(created.snapshot.revision + 1);
        expect(await prisma.agent_task_event.count({ where: { sessionId } })).toBe(2);
        expect(await prisma.agent_task.count({ where: { sessionId } })).toBe(1);
    });

    it("rolls back a conversion-shaped task and receipt write together", async () => {
        const seeded = await seedResolvedCreate({ sessionId });
        const beforeTask = await prisma.agent_task.findUnique({ where: { id: seeded.task.taskId } });
        const beforeSession = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        if (!beforeTask) throw new Error("Expected source task");
        const result = await repository.withTransaction(scope(), async (unitOfWork) => {
            const session = await unitOfWork.lockSession();
            if (session.status !== "locked") throw new Error("Expected locked session");
            const locked = await unitOfWork.lockTask(seeded.task.taskId);
            if (locked.status !== "locked") throw new Error("Expected locked source task");
            const updated = await unitOfWork.updateTask({
                expectedRevision: locked.task.revision,
                status: "paused",
                draft: { ...locked.task.draft, currentSnapshotRef: randomUUID() },
                acceptedAt: new Date(),
                expiresAt: futureDate(),
            });
            if (updated.status !== "updated") throw new Error("Expected source update");
            const destination = await unitOfWork.createTask({
                taskId: randomUUID(),
                capabilityId: "clients.update",
                draft: taskDraft(),
                status: "collecting",
                targetRef: randomUUID(),
                targetVersion: "c".repeat(64),
                expiresAt: futureDate(),
            });
            if (destination.status !== "created") throw new Error("Expected destination task");
            const inserted = await unitOfWork.insertEvent({
                clientEventId: randomUUID(),
                operation: "command:start-update",
                requestHash: "b".repeat(64),
                acceptedRevision: destination.task.revision,
            });
            if (inserted.status !== "inserted") throw new Error("Expected conversion receipt");
            const retained = await unitOfWork.ensureSessionRetention(futureDate());
            if (retained.status === "storage_failure") throw new Error("Expected retention extension");
            throw new Error("injected postwrite failure");
        });
        expect(result).toEqual({ status: "storage_failure" });
        const afterTask = await prisma.agent_task.findUnique({ where: { id: seeded.task.taskId } });
        expect(afterTask).toEqual(beforeTask);
        expect(await prisma.agent_task.count({ where: { sessionId } })).toBe(1);
        expect(await prisma.agent_task_event.count({ where: { sessionId } })).toBe(1);
        const afterSession = await prisma.agent_session.findUnique({ where: { id: sessionId } });
        expect(afterSession?.expiresAt).toEqual(beforeSession?.expiresAt);
    });

    it("replays a conversion receipt after the source is resumed and revised", async () => {
        const seeded = await seedResolvedCreate({ sessionId });
        const taskService = service();
        const command = {
            clientEventId: randomUUID(),
            expectedRevision: seeded.task.revision,
            command: "start-update" as const,
            targetRef: seeded.targetRef,
            expectedTargetVersion: seeded.targetVersion,
        };
        const [converted, concurrentReplay] = await Promise.all([
            taskService.command(principal, seeded.task.taskId, command),
            taskService.command(principal, seeded.task.taskId, command),
        ]);
        expect(concurrentReplay.receipt).toEqual(converted.receipt);
        expect(concurrentReplay.snapshot.taskId).toBe(converted.snapshot.taskId);
        expect(await prisma.agent_task.count({ where: { sessionId } })).toBe(2);
        expect(await prisma.agent_task_event.count({ where: { sessionId } })).toBe(2);
        const destinationPaused = await taskService.command(principal, converted.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: converted.snapshot.revision,
            command: "pause",
        });
        expect(destinationPaused.snapshot.state).toBe("paused");
        const sourceResumed = await taskService.command(principal, seeded.task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: seeded.task.revision + 1,
            command: "resume",
        });
        const sourceRevised = await taskService.patch(principal, seeded.task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: sourceResumed.snapshot.revision,
            operations: [{ op: "set", field: "address", value: "재개 후 수정" }],
        });
        const replay = await taskService.command(principal, seeded.task.taskId, command);
        expect(sourceRevised.snapshot.taskId).toBe(seeded.task.taskId);
        expect(replay.receipt).toEqual(expect.objectContaining({
            taskId: converted.receipt.taskId,
            eventId: converted.receipt.eventId,
            eventHash: converted.receipt.eventHash,
            acceptedRevision: converted.receipt.acceptedRevision,
        }));
        expect(replay.receipt.currentSnapshotRef).toBe(replay.snapshot.currentSnapshotRef);
        expect(replay.receipt.currentSnapshotRef).not.toBe(converted.receipt.currentSnapshotRef);
        expect(replay.snapshot.taskId).toBe(converted.snapshot.taskId);
        expect(replay.snapshot.state).toBe("paused");
    });

    it("keeps a protected target version behind a server reference during the HTTP round trip", async () => {
        const seeded = await seedResolvedCreate({ sessionId });
        const response = await request(httpApp.getHttpServer())
            .get(`/ai/agent/tasks/${seeded.task.taskId}`)
            .expect(200);
        const snapshot = response.body as AgentTask;
        expect(snapshot.target).toEqual({ targetRef: seeded.targetRef, version: seeded.targetVersion });
        expect(snapshot).not.toHaveProperty("server");
        expect(JSON.stringify(snapshot)).not.toContain(seeded.target.name);
    });
});
