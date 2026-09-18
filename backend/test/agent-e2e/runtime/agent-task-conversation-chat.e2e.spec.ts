import { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { MockLanguageModelV3 } from "ai/test";
import request from "supertest";
import { randomUUID } from "node:crypto";

import { AppModule } from "../../../app.module";
import { AgentModelFactory } from "../../../infrastructure/agent/agent-model.factory";
import { GlobalValidationPipe } from "../../../infrastructure/pipes/global-validation.pipe";
import { ServiceRecordSentryExceptionFilter } from "../../../infrastructure/observability/service-record-sentry-exception.filter";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";

/**
 * This suite intentionally boots the real application module.  The only
 * replacement is the language-model/provider seam; JWT, tenant, capability,
 * conversation-task, repository, and controller paths remain production code.
 */
const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;

const USER_ID = "a7000000-0000-4000-8000-000000000001";
const FOREIGN_USER_ID = "a7000000-0000-4000-8000-000000000002";
const BRANCH_ID = "a8000000-0000-4000-8000-000000000001";
const FOREIGN_BRANCH_ID = "a8000000-0000-4000-8000-000000000002";
const AUTH_SESSION_ID = "a9000000-0000-4000-8000-000000000001";
const FOREIGN_AUTH_SESSION_ID = "a9000000-0000-4000-8000-000000000002";
const AGENT_SESSION_ID = "aa000000-0000-4000-8000-000000000001";
const CLIENT_ID = 970000001;
const FLAGS_KEY = "agent.flags";
const EMERGENCY_KEY = "agent.flags.emergency-disabled";
const PASSWORDLESS_AGENT_VERSION = "agent-task-conversation-chat-e2e";

const protectedName = "홍길동";
const protectedPhone = "01024681357";
const protectedAddress = "서울시 보호구역 101";

type RecordingModel = MockLanguageModelV3 & {
    doGenerateCalls: Array<Record<string, unknown>>;
    doStreamCalls: Array<Record<string, unknown>>;
};

const emptyUsage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function createRecordingModel(): RecordingModel {
    const model = new MockLanguageModelV3({
        provider: "babyjamjam-agent-e2e",
        modelId: "babyjamjam-agent-e2e-v1",
        doGenerate: async () => ({
            content: [{ type: "text", text: '{"domains":["clients"]}' }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: emptyUsage,
            warnings: [],
        }),
        doStream: async () => ({
            stream: new ReadableStream({
                start(controller) {
                    const id = `chat-e2e-text-${randomUUID()}`;
                    controller.enqueue({ type: "stream-start", warnings: [] });
                    controller.enqueue({ type: "text-start", id });
                    controller.enqueue({ type: "text-delta", id, delta: "[agent-chat-e2e-stub]" });
                    controller.enqueue({ type: "text-end", id });
                    controller.enqueue({
                        type: "finish",
                        usage: emptyUsage,
                        finishReason: { unified: "stop", raw: "stop" },
                    });
                    controller.close();
                },
            }),
        }),
    });
    return model as unknown as RecordingModel;
}

function serializedCalls(model: RecordingModel): string {
    return JSON.stringify({ generate: model.doGenerateCalls, stream: model.doStreamCalls });
}

function futureDate(hours = 24): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describeAgentE2E("authenticated AppModule conversation chat proof", () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let model: RecordingModel;
    let accessToken: string;
    let foreignToken: string;
    let previousFlags: string | null = null;
    let previousEmergency: string | null = null;

    async function buildApp(): Promise<void> {
        model = createRecordingModel();
        const modelFactory = {
            modelId: "babyjamjam-agent-e2e-v1",
            create: jest.fn(() => model),
        };
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentModelFactory)
            .useValue(modelFactory)
            .compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)));
        await app.init();
    }

    async function chat(token: string, messageId: string, text: string, sessionId = AGENT_SESSION_ID) {
        return request(app.getHttpServer())
            .post("/ai/agent/chat")
            .set("Authorization", `Bearer ${token}`)
            .send({
                sessionId,
                locale: "ko",
                messages: [{ id: messageId, role: "user", parts: [{ type: "text", text }] }],
            })
            .expect((response) => {
                if (![200, 201].includes(response.status)) {
                    throw new Error(`Unexpected chat status ${response.status}: ${response.text}`);
                }
            });
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();

        // Fixture rows are scoped to this suite and removed in afterAll.  A
        // bare client is used only for setup/inspection so fixture writes do
        // not depend on an application HTTP tenant ALS context.
        await prisma.agent_task_event.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_message.deleteMany({ where: { session: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } } });
        await prisma.agent_trace.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_action.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_task.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_session.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.auth_session.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.user_branch.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.client.deleteMany({ where: { id: CLIENT_ID } });
        await prisma.branch.deleteMany({ where: { id: { in: [BRANCH_ID, FOREIGN_BRANCH_ID] } } });
        await prisma.user.deleteMany({ where: { id: { in: [USER_ID, FOREIGN_USER_ID] } } });

        await prisma.user.createMany({
            data: [
                {
                    id: USER_ID,
                    email: "agent-task-chat-e2e@example.invalid",
                    name: "Agent Chat E2E",
                    role: "admin",
                    approvalStatus: "approved",
                    emailVerified: true,
                    tokenVersion: 0,
                },
                {
                    id: FOREIGN_USER_ID,
                    email: "agent-task-chat-foreign@example.invalid",
                    name: "Agent Chat Foreign",
                    role: "admin",
                    approvalStatus: "approved",
                    emailVerified: true,
                    tokenVersion: 0,
                },
            ],
        });
        await prisma.branch.createMany({
            data: [
                { id: BRANCH_ID, name: "Agent Chat E2E Branch", slug: "agent-task-chat-e2e", isActive: true },
                { id: FOREIGN_BRANCH_ID, name: "Agent Chat Foreign Branch", slug: "agent-task-chat-foreign", isActive: true },
            ],
        });
        await prisma.user_branch.createMany({
            data: [
                { userId: USER_ID, branchId: BRANCH_ID, role: "manager" },
                { userId: FOREIGN_USER_ID, branchId: FOREIGN_BRANCH_ID, role: "manager" },
            ],
        });
        await prisma.auth_session.createMany({
            data: [
                { id: AUTH_SESSION_ID, userId: USER_ID, selectedBranchId: BRANCH_ID, expiresAt: futureDate(24 * 30) },
                { id: FOREIGN_AUTH_SESSION_ID, userId: FOREIGN_USER_ID, selectedBranchId: FOREIGN_BRANCH_ID, expiresAt: futureDate(24 * 30) },
            ],
        });
        await prisma.agent_session.create({
            data: {
                id: AGENT_SESSION_ID,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: PASSWORDLESS_AGENT_VERSION,
                agentVersion: PASSWORDLESS_AGENT_VERSION,
                expiresAt: futureDate(24 * 30),
            },
        });
        await prisma.client.create({
            data: {
                id: CLIENT_ID,
                name: "조회용 산모",
                phone: "01099990000",
                phoneNormalized: "01099990000",
                voucherClient: false,
                serviceStatus: "pre_booking",
                branchId: BRANCH_ID,
            },
        });

        const flags = await prisma.system_setting.findUnique({ where: { key: FLAGS_KEY } });
        const emergency = await prisma.system_setting.findUnique({ where: { key: EMERGENCY_KEY } });
        previousFlags = flags?.value ?? null;
        previousEmergency = emergency?.value ?? null;
        await prisma.system_setting.upsert({
            where: { key: FLAGS_KEY },
            update: {
                value: JSON.stringify({
                    enabled: true,
                    rolloutStage: "development",
                    capabilities: { "conversation.tasks": true },
                    risks: { read: true, "reversible-write": true },
                }),
            },
            create: {
                key: FLAGS_KEY,
                value: JSON.stringify({
                    enabled: true,
                    rolloutStage: "development",
                    capabilities: { "conversation.tasks": true },
                    risks: { read: true, "reversible-write": true },
                }),
            },
        });
        await prisma.system_setting.upsert({
            where: { key: EMERGENCY_KEY },
            update: { value: "false" },
            create: { key: EMERGENCY_KEY, value: "false" },
        });

        await buildApp();
        const jwt = app.get(JwtService);
        accessToken = await jwt.signAsync({
            sub: USER_ID,
            sid: AUTH_SESSION_ID,
            role: "admin",
            tokenVersion: 0,
            type: "access",
            branchId: BRANCH_ID,
            branchRole: "manager",
        });
        foreignToken = await jwt.signAsync({
            sub: FOREIGN_USER_ID,
            sid: FOREIGN_AUTH_SESSION_ID,
            role: "admin",
            tokenVersion: 0,
            type: "access",
            branchId: FOREIGN_BRANCH_ID,
            branchRole: "manager",
        });
    }, 30_000);

    afterAll(async () => {
        await app?.close();
        if (previousFlags === null) {
            await prisma.system_setting.deleteMany({ where: { key: FLAGS_KEY } });
        } else {
            await prisma.system_setting.update({ where: { key: FLAGS_KEY }, data: { value: previousFlags } });
        }
        if (previousEmergency === null) {
            await prisma.system_setting.deleteMany({ where: { key: EMERGENCY_KEY } });
        } else {
            await prisma.system_setting.update({ where: { key: EMERGENCY_KEY }, data: { value: previousEmergency } });
        }
        await prisma.agent_task_event.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_message.deleteMany({ where: { session: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } } });
        await prisma.agent_trace.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_action.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_task.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.agent_session.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.auth_session.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.user_branch.deleteMany({ where: { userId: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.client.deleteMany({ where: { id: CLIENT_ID } });
        await prisma.branch.deleteMany({ where: { id: { in: [BRANCH_ID, FOREIGN_BRANCH_ID] } } });
        await prisma.user.deleteMany({ where: { id: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.$disconnect();
    }, 30_000);

    it("keeps authenticated intake protected and stores facts only in the server task draft", async () => {
        await request(app.getHttpServer())
            .post("/ai/agent/chat")
            .send({
                sessionId: AGENT_SESSION_ID,
                locale: "ko",
                messages: [{ id: "missing-auth-turn", role: "user", parts: [{ type: "text", text: "고객 등록해줘" }] }],
            })
            .expect(401);

        await chat(accessToken, "protected-intake", `고객 등록해줘. 이름: ${protectedName}, 전화번호: ${protectedPhone}`);
        await chat(accessToken, "protected-address", `이름: ${protectedName}, 주소: ${protectedAddress}`);

        const task = await prisma.agent_task.findFirst({
            where: { sessionId: AGENT_SESSION_ID, userId: USER_ID, capabilityId: "clients.create" },
            orderBy: { createdAt: "asc" },
        });
        expect(task).not.toBeNull();
        expect(JSON.stringify(task?.draft)).toContain(protectedName);
        expect(JSON.stringify(task?.draft)).toContain(protectedPhone);
        expect(JSON.stringify(task?.draft)).toContain(protectedAddress);

        const messages = await prisma.agent_message.findMany({ where: { sessionId: AGENT_SESSION_ID } });
        const persisted = JSON.stringify(messages);
        expect(persisted).not.toContain(protectedName);
        expect(persisted).not.toContain(protectedPhone);
        expect(persisted).not.toContain(protectedAddress);
        expect(persisted).toContain("protected");

        const prompts = serializedCalls(model);
        expect(prompts).not.toContain(protectedName);
        expect(prompts).not.toContain(protectedPhone);
        expect(prompts).not.toContain(protectedAddress);
        expect(model.doGenerateCalls.length).toBeGreaterThan(0);
        expect(model.doStreamCalls.length).toBeGreaterThan(0);
    }, 30_000);

    it("records a read-only question receipt across retry, task switching, and runtime rebuild", async () => {
        const beforeQuestion = await prisma.agent_task.findFirst({
            where: { sessionId: AGENT_SESSION_ID, userId: USER_ID, capabilityId: "clients.create" },
            orderBy: { createdAt: "asc" },
        });
        if (!beforeQuestion) throw new Error("Expected protected intake task");
        const beforeEvents = await prisma.agent_task_event.count({ where: { sessionId: AGENT_SESSION_ID } });
        const beforeUserMessages = await prisma.agent_message.count({ where: { sessionId: AGENT_SESSION_ID, role: "user" } });
        const streamCallsBeforeQuestion = model.doStreamCalls.length;

        const questionId = "existing-task-question";
        await chat(accessToken, questionId, "이 등록 작업은 어떻게 진행되나요?");
        const afterQuestion = await prisma.agent_task.findUnique({ where: { id: beforeQuestion.id } });
        expect(afterQuestion).toEqual(expect.objectContaining({
            revision: beforeQuestion.revision,
            lastAcceptedAt: beforeQuestion.lastAcceptedAt,
            expiresAt: beforeQuestion.expiresAt,
            draft: beforeQuestion.draft,
        }));
        expect(await prisma.agent_task_event.count({ where: { sessionId: AGENT_SESSION_ID } })).toBe(beforeEvents + 1);
        expect(await prisma.agent_message.count({ where: { sessionId: AGENT_SESSION_ID, role: "user" } })).toBe(beforeUserMessages + 1);
        expect((await prisma.agent_task_event.findFirst({ where: { sessionId: AGENT_SESSION_ID, operation: "conversation:intake" }, orderBy: { acceptedAt: "desc" } }))?.taskId).toBe(beforeQuestion.id);

        const questionCall = model.doStreamCalls.slice(streamCallsBeforeQuestion)[0];
        expect(questionCall).toBeDefined();
        const questionTools = JSON.stringify(questionCall?.tools ?? questionCall);
        expect(questionTools).toContain("clients_search");
        expect(questionTools).not.toContain("clients_create");
        expect(questionTools).not.toContain("clients_update");
        expect(questionTools).not.toContain("employees_create");
        expect(questionTools).not.toContain("messages_send");

        await chat(accessToken, questionId, "이 등록 작업은 어떻게 진행되나요?");
        expect(await prisma.agent_task_event.count({ where: { sessionId: AGENT_SESSION_ID } })).toBe(beforeEvents + 1);
        expect(await prisma.agent_message.count({ where: { sessionId: AGENT_SESSION_ID, role: "user" } })).toBe(beforeUserMessages + 1);

        const paused = await request(app.getHttpServer())
            .post(`/ai/agent/tasks/${beforeQuestion.id}/commands`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ command: "pause", clientEventId: randomUUID(), expectedRevision: beforeQuestion.revision })
            .expect(201);
        expect(paused.body.snapshot.state).toBe("paused");
        const pausedRow = await prisma.agent_task.findUnique({ where: { id: beforeQuestion.id } });
        if (!pausedRow) throw new Error("Expected paused original task");

        await chat(accessToken, "second-task", "고객 등록해줘. 이름: 두 번째 대상, 전화번호: 01024681358");
        await app.close();
        await buildApp();
        await chat(accessToken, questionId, "이 등록 작업은 어떻게 진행되나요?");

        const replayedOriginal = await prisma.agent_task.findUnique({ where: { id: beforeQuestion.id } });
        expect(replayedOriginal).toEqual(expect.objectContaining({
            status: "paused",
            revision: pausedRow.revision,
            lastAcceptedAt: pausedRow.lastAcceptedAt,
            expiresAt: pausedRow.expiresAt,
            draft: pausedRow.draft,
        }));
        expect(await prisma.agent_task_event.count({ where: { sessionId: AGENT_SESSION_ID } })).toBe(beforeEvents + 3);
        expect(await prisma.agent_message.count({ where: { sessionId: AGENT_SESSION_ID, role: "user" } })).toBe(beforeUserMessages + 2);
    }, 30_000);

    it("rejects a valid foreign tenant token for the owned conversation", async () => {
        await request(app.getHttpServer())
            .post("/ai/agent/chat")
            .set("Authorization", `Bearer ${foreignToken}`)
            .send({
                sessionId: AGENT_SESSION_ID,
                locale: "ko",
                messages: [{ id: "foreign-turn", role: "user", parts: [{ type: "text", text: "고객 등록해줘" }] }],
            })
            .expect(404);
    });
});
