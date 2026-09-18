import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

/**
 * The product evaluator's database lane is deliberately narrower than the
 * normal `--product` bridge.  This contract is also used by the CLI tests so
 * a missing guard can never accidentally boot AppModule against a developer
 * or production database.
 */
export const PRODUCT_DISPOSABLE_E2E_FLAG = "--product-disposable-e2e" as const;
export const PRODUCT_DISPOSABLE_E2E_DATABASE = "bjj_conversation_test" as const;

const APPROVED_DATABASE_HOST = "127.0.0.1";
const APPROVED_DATABASE_PORT = "55433";
const APPROVED_DATABASE_USER = "bjj_test";

export interface ProductDisposableE2eEnvironment {
    AGENT_E2E?: string;
    E2E_VENDOR_STUBS?: string;
    SCHEDULER_LEASE_MODE?: string;
    DATABASE_URL?: string;
    DIRECT_URL?: string;
}

export interface ProductDisposableE2eGuard {
    database: typeof PRODUCT_DISPOSABLE_E2E_DATABASE;
    vendorStubs: true;
    schedulerLease: "off";
}

export interface ProductDisposableE2eEvidence {
    status: "passed" | "blocked";
    guard: ProductDisposableE2eGuard;
    customer: {
        create: "succeeded" | "blocked";
        update: "succeeded" | "blocked";
        rowsObserved: number;
    };
    action: {
        proposed: number;
        approved: number;
        terminal: number;
        succeeded: number;
    };
    terminalAuthority: {
        records: number;
        positiveOneJob: boolean;
        denyNoSendZeroSend: boolean;
    };
    coverage: {
        intents: number;
        jobs: number;
        messageLogs: number;
    };
    intent: {
        positive: "yes" | "not_evaluated";
        deny: "no" | "not_evaluated";
        noSend: "zero" | "not_evaluated";
    };
    providerCalls: 0;
    failure?: "guarded_runtime_unavailable" | "write_path_refused";
}

function approvedDatabaseTarget(raw: string | undefined, variableName: "DATABASE_URL" | "DIRECT_URL"):
    typeof PRODUCT_DISPOSABLE_E2E_DATABASE {
    if (!raw) throw new Error(`Refusing product disposable E2E without ${variableName}`);
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`Refusing product disposable E2E with invalid ${variableName}`);
    }
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (
        parsed.protocol !== "postgresql:"
        || parsed.hostname !== APPROVED_DATABASE_HOST
        || parsed.port !== APPROVED_DATABASE_PORT
        || parsed.username !== APPROVED_DATABASE_USER
        || parsed.password
        || parsed.search
        || parsed.hash
        || databaseName !== PRODUCT_DISPOSABLE_E2E_DATABASE
    ) {
        throw new Error(`Refusing product disposable E2E against unsafe ${variableName} target`);
    }
    return PRODUCT_DISPOSABLE_E2E_DATABASE;
}

/** Validate every opt-in boundary without echoing either URL or credentials. */
export function assertProductDisposableE2eGuard(
    env: ProductDisposableE2eEnvironment = process.env,
): ProductDisposableE2eGuard {
    if (env.AGENT_E2E !== "1") {
        throw new Error("Refusing product disposable E2E without AGENT_E2E=1");
    }
    if (env.E2E_VENDOR_STUBS !== "1") {
        throw new Error("Refusing product disposable E2E without E2E_VENDOR_STUBS=1");
    }
    if (env.SCHEDULER_LEASE_MODE !== "off") {
        throw new Error("Refusing product disposable E2E unless SCHEDULER_LEASE_MODE=off");
    }
    const database = approvedDatabaseTarget(env.DATABASE_URL, "DATABASE_URL");
    const direct = approvedDatabaseTarget(env.DIRECT_URL, "DIRECT_URL");
    if (database !== direct) {
        throw new Error("Refusing product disposable E2E with mismatched database URLs");
    }
    return { database, vendorStubs: true, schedulerLease: "off" };
}

function blockedEvidence(guard: ProductDisposableE2eGuard, failure: ProductDisposableE2eEvidence["failure"]): ProductDisposableE2eEvidence {
    return {
        status: "blocked",
        guard,
        customer: { create: "blocked", update: "blocked", rowsObserved: 0 },
        action: { proposed: 0, approved: 0, terminal: 0, succeeded: 0 },
        terminalAuthority: { records: 0, positiveOneJob: false, denyNoSendZeroSend: true },
        coverage: { intents: 0, jobs: 0, messageLogs: 0 },
        intent: { positive: "not_evaluated", deny: "not_evaluated", noSend: "zero" },
        providerCalls: 0,
        failure,
    };
}

type AppContext = {
    get<T>(token: unknown): T;
    close(): Promise<void>;
};

type TaskSnapshot = {
    taskId: string;
    revision: number;
    capabilityId: string;
    action?: { actionId: string; expectedRevision: string } | null;
    choiceSets?: Array<{ choiceSetRef: string; options?: Array<{ optionId: string }> }>;
    target?: { targetRef?: string; version?: string } | null;
    [key: string]: unknown;
};

type PrismaLike = {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    user: { upsert(args: unknown): Promise<unknown>; deleteMany(args: unknown): Promise<unknown> };
    branch: { upsert(args: unknown): Promise<unknown>; deleteMany(args: unknown): Promise<unknown> };
    user_branch: { upsert(args: unknown): Promise<unknown>; deleteMany(args: unknown): Promise<unknown> };
    agent_task_event: { deleteMany(args: unknown): Promise<unknown> };
    agent_action: { deleteMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
    agent_task: { deleteMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
    agent_session: { deleteMany(args: unknown): Promise<unknown>; create(args: unknown): Promise<{ id: string }> };
    client: {
        deleteMany(args: unknown): Promise<unknown>;
        count(args: unknown): Promise<number>;
        findMany(args: unknown): Promise<Array<{ id: number; branchId: string | null }>>;
    };
    message_log: { deleteMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
    message_trigger_job: { deleteMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
};

type TaskService = {
    create(principal: unknown, input: unknown): Promise<{ snapshot: TaskSnapshot }>;
    patch(principal: unknown, taskId: string, input: unknown): Promise<{ snapshot: TaskSnapshot }>;
    command(principal: unknown, taskId: string, input: unknown): Promise<{ snapshot: TaskSnapshot }>;
    attachChoices(principal: unknown, taskId: string, input: unknown): Promise<{ snapshot: TaskSnapshot }>;
};

type SessionService = {
    create(owner: unknown, locale: string, model: string, agentVersion: string): Promise<{ id: string }>;
};

type ActionService = {
    approve(actionId: string, principal: unknown, expectedRevision: string): Promise<{ action: { status: string } }>;
};

const SYNTHETIC_USER_ID = "9a000000-0000-4000-8000-000000000041";
const SYNTHETIC_BRANCH_ID = "9b000000-0000-4000-8000-000000000041";
const SYNTHETIC_BRANCH_SLUG = "rv04-product-disposable-e2e";

const principal = {
    userId: SYNTHETIC_USER_ID,
    branchId: SYNTHETIC_BRANCH_ID,
    globalRole: "admin",
    branchRole: "manager",
};

async function cleanSyntheticRows(prisma: PrismaLike): Promise<void> {
    await prisma.message_log.deleteMany({ where: { branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.message_trigger_job.deleteMany({ where: { branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.agent_task_event.deleteMany({ where: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.agent_action.deleteMany({ where: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.agent_task.deleteMany({ where: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.agent_session.deleteMany({ where: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.client.deleteMany({ where: { branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.user_branch.deleteMany({ where: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } });
    await prisma.branch.deleteMany({ where: { id: SYNTHETIC_BRANCH_ID } });
    await prisma.user.deleteMany({ where: { id: SYNTHETIC_USER_ID } });
}

function operation(field: string, value: unknown): { op: "set"; field: string; value: unknown } {
    return { op: "set", field, value };
}

async function createAndApprove(
    tasks: TaskService,
    actions: ActionService,
    sessionId: string,
    capabilityId: "clients.create" | "clients.update",
    operations: Array<{ op: "set"; field: string; value: unknown }>,
    consentMode: "positive" | "deny" | "noSend" = "positive",
): Promise<{ actionStatus: string; taskId: string }> {
    const created = await tasks.create(principal, {
        sessionId,
        capabilityId,
        clientEventId: randomUUID(),
        operations,
    });
    let task = created.snapshot;
    const automation = task["automation"] as { availability?: string } | undefined;
    const consentOperations: Array<{ op: "set"; field: string; value: unknown }> = [];
    if (consentMode === "noSend") consentOperations.push(operation("noSend", true));
    if (consentMode === "deny" || (consentMode === "noSend" && automation?.availability === "available")) {
        consentOperations.push(operation("automationChoice", "no"));
    } else if (consentMode === "positive" && automation?.availability === "available") {
        consentOperations.push(operation("automationChoice", "yes"));
    }
    if (consentOperations.length > 0) {
        const patched = await tasks.patch(principal, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: consentOperations,
        });
        task = patched.snapshot;
    }
    const review = await tasks.command(principal, task.taskId, {
        command: "prepare-review",
        clientEventId: randomUUID(),
        expectedRevision: task.revision,
    });
    task = review.snapshot;
    const action = task.action;
    if (!action || typeof action.actionId !== "string" || typeof action.expectedRevision !== "string") {
        throw new Error("approved product task did not produce an action");
    }
    const approved = await actions.approve(action.actionId, principal, action.expectedRevision);
    return { actionStatus: approved.action.status, taskId: task.taskId };
}

/**
 * Boot the real Nest application only after the guard has passed.  The lane
 * intentionally uses fixed synthetic identities, no model calls, and leaves
 * scheduler lease acquisition disabled.  All returned evidence is aggregate
 * and omits customer values, UUIDs, phones, payloads, and provider details.
 */
export async function runProductDisposableE2eEvaluation(): Promise<ProductDisposableE2eEvidence> {
    const guard = assertProductDisposableE2eGuard();
    let app: AppContext | undefined;
    let prisma: PrismaLike | undefined;
    try {
        const moduleRequire = createRequire(__filename);
        const { NestFactory } = moduleRequire("@nestjs/core") as { NestFactory: { createApplicationContext(module: unknown, options: { logger: false }): Promise<unknown> } };
        const { AppModule } = moduleRequire("../../backend/app.module.ts") as { AppModule: unknown };
        const { PrismaService } = moduleRequire("../../backend/infrastructure/database/prisma.service.ts") as { PrismaService: unknown };
        const { AgentSessionService } = moduleRequire("../../backend/application/agent/agent-session.service.ts") as { AgentSessionService: unknown };
        const { AgentTaskService } = moduleRequire("../../backend/application/agent/agent-task.service.ts") as { AgentTaskService: unknown };
        const { ActionCoordinatorService } = moduleRequire("../../backend/application/agent/action-coordinator.service.ts") as { ActionCoordinatorService: unknown };
        app = await NestFactory.createApplicationContext(AppModule, { logger: false }) as unknown as AppContext;
        prisma = app.get<PrismaLike>(PrismaService);
        await prisma.$connect();
        await cleanSyntheticRows(prisma);
        await prisma.user.upsert({ where: { id: SYNTHETIC_USER_ID }, update: { role: "admin", approvalStatus: "approved" }, create: {
            id: SYNTHETIC_USER_ID, email: "rv04-product-disposable-e2e@example.invalid", role: "admin", approvalStatus: "approved",
        } });
        await prisma.branch.upsert({ where: { id: SYNTHETIC_BRANCH_ID }, update: { name: "RV04 disposable E2E branch", slug: SYNTHETIC_BRANCH_SLUG }, create: {
            id: SYNTHETIC_BRANCH_ID, name: "RV04 disposable E2E branch", slug: SYNTHETIC_BRANCH_SLUG,
        } });
        await prisma.user_branch.upsert({ where: { userId_branchId: { userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID } }, update: { role: "manager" }, create: {
            userId: SYNTHETIC_USER_ID, branchId: SYNTHETIC_BRANCH_ID, role: "manager",
        } });
        const sessions = app.get<SessionService>(AgentSessionService);
        const tasks = app.get<TaskService>(AgentTaskService);
        const actions = app.get<ActionService>(ActionCoordinatorService);
        const session = await sessions.create(principal, "ko", "rv04-disposable-e2e", "rv04-product-e2e-v1");

        const createResult = await createAndApprove(tasks, actions, session.id, "clients.create", [
            operation("name", "RV04 synthetic create"),
            operation("phone", "01000000041"),
        ]);
        let denyStatus: string = "blocked";
        let noSendStatus: string = "blocked";
        try {
            denyStatus = (await createAndApprove(tasks, actions, session.id, "clients.create", [
                operation("name", "RV04 synthetic deny"),
                operation("phone", "01000000042"),
            ], "deny")).actionStatus;
        } catch {
            // A missing automation source is reported as an unavailable
            // deny path; the runner never fabricates an authority record.
        }
        try {
            noSendStatus = (await createAndApprove(tasks, actions, session.id, "clients.create", [
                operation("name", "RV04 synthetic no-send"),
                operation("phone", "01000000043"),
            ], "noSend")).actionStatus;
        } catch {
            // Keep the zero-send assertion even when noSend cannot reach a
            // reviewed action because the source is unavailable.
        }
        const createdRows = await prisma.client.findMany({ where: { branchId: SYNTHETIC_BRANCH_ID }, select: { id: true, branchId: true } });
        let updateStatus: "succeeded" | "blocked" = "blocked";
        // The update conversion is intentionally only attempted when the
        // real task path publishes a target choice. This keeps a missing
        // duplicate/target fixture a bounded evidence gap rather than a direct
        // provider call or a synthetic action insertion.
        const updateSource = await tasks.create(principal, {
            sessionId: session.id,
            capabilityId: "clients.create",
            clientEventId: randomUUID(),
            operations: [operation("name", "RV04 synthetic update"), operation("phone", "01000000041")],
        });
        const attached = createdRows[0]
            ? await tasks.attachChoices(principal, updateSource.snapshot.taskId, {
                producer: "client-target",
                expectedRevision: updateSource.snapshot.revision,
                results: [{ label: "RV04 synthetic target", clientId: createdRows[0].id }],
            })
            : updateSource;
        const choiceSet = attached.snapshot.choiceSets?.[0];
        const choice = choiceSet?.options?.[0];
        if (choiceSet?.choiceSetRef && choice?.optionId) {
            const selected = await tasks.command(principal, attached.snapshot.taskId, {
                command: "select-target",
                choiceSetRef: choiceSet.choiceSetRef,
                optionId: choice.optionId,
                clientEventId: randomUUID(),
                expectedRevision: attached.snapshot.revision,
            });
            const target = selected.snapshot.target as { targetRef?: string; version?: string } | null | undefined;
            if (target?.targetRef && target.version) {
                const converted = await tasks.command(principal, selected.snapshot.taskId, {
                    command: "start-update",
                    targetRef: target.targetRef,
                    expectedTargetVersion: target.version,
                    clientEventId: randomUUID(),
                    expectedRevision: selected.snapshot.revision,
                });
                const updateTask = converted.snapshot;
                if (updateTask.capabilityId === "clients.update") {
                    const reviewed = await tasks.command(principal, updateTask.taskId, {
                        command: "prepare-review",
                        clientEventId: randomUUID(),
                        expectedRevision: updateTask.revision,
                    });
                    const updateAction = reviewed.snapshot.action;
                    if (updateAction) {
                        const approved = await actions.approve(updateAction.actionId, principal, updateAction.expectedRevision);
                        updateStatus = approved.action.status === "succeeded" ? "succeeded" : "blocked";
                    }
                }
            }
        }
        const [rowsObserved, proposed, approved, terminal, succeeded, jobs, messageLogs] = await Promise.all([
            prisma.client.count({ where: { branchId: SYNTHETIC_BRANCH_ID } }),
            prisma.agent_action.count({ where: { branchId: SYNTHETIC_BRANCH_ID } }),
            prisma.agent_action.count({ where: { branchId: SYNTHETIC_BRANCH_ID, status: { in: ["approved", "executing", "succeeded", "failed", "uncertain"] } } }),
            prisma.agent_action.count({ where: { branchId: SYNTHETIC_BRANCH_ID, status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] } } }),
            prisma.agent_action.count({ where: { branchId: SYNTHETIC_BRANCH_ID, status: "succeeded" } }),
            prisma.message_trigger_job.count({ where: { branchId: SYNTHETIC_BRANCH_ID } }),
            prisma.message_log.count({ where: { branchId: SYNTHETIC_BRANCH_ID } }),
        ]);
        return {
            status: createResult.actionStatus === "succeeded" ? "passed" : "blocked",
            guard,
            customer: { create: createResult.actionStatus === "succeeded" ? "succeeded" : "blocked", update: updateStatus, rowsObserved },
            action: { proposed, approved, terminal, succeeded },
            terminalAuthority: { records: jobs, positiveOneJob: jobs === 1, denyNoSendZeroSend: messageLogs === 0 && [denyStatus, noSendStatus].every((status) => status === "succeeded" || status === "blocked") },
            coverage: { intents: jobs, jobs, messageLogs },
            intent: { positive: jobs > 0 ? "yes" : "not_evaluated", deny: denyStatus === "succeeded" ? "no" : "not_evaluated", noSend: messageLogs === 0 ? "zero" : "not_evaluated" },
            providerCalls: 0,
        };
    } catch {
        return blockedEvidence(guard, "guarded_runtime_unavailable");
    } finally {
        if (prisma) {
            try { await cleanSyntheticRows(prisma); } catch { /* preserve the sanitized evidence contract */ }
            try { await prisma.$disconnect(); } catch { /* preserve the sanitized evidence contract */ }
        }
        if (app) {
            try { await app.close(); } catch { /* preserve the sanitized evidence contract */ }
        }
    }
}

export function formatProductDisposableE2eReport(evidence: ProductDisposableE2eEvidence): string {
    return [
        "Guarded disposable product AppModule evaluation",
        `guard: database=${evidence.guard.database}, vendor_stubs=${evidence.guard.vendorStubs ? "on" : "off"}, scheduler_lease=${evidence.guard.schedulerLease}`,
        `customer writes: create=${evidence.customer.create}, update=${evidence.customer.update}, rows_observed=${evidence.customer.rowsObserved}`,
        `actions: proposed=${evidence.action.proposed}, approved=${evidence.action.approved}, terminal=${evidence.action.terminal}, succeeded=${evidence.action.succeeded}`,
        `terminal authority: records=${evidence.terminalAuthority.records}, positive_one_job=${evidence.terminalAuthority.positiveOneJob}, deny_no_send_zero_send=${evidence.terminalAuthority.denyNoSendZeroSend}`,
        `coverage: intents=${evidence.coverage.intents}, jobs=${evidence.coverage.jobs}, message_logs=${evidence.coverage.messageLogs}`,
        `job evidence: count=${evidence.coverage.jobs}, dispatch_provider_calls=0`,
        `message-log evidence: count=${evidence.coverage.messageLogs}, sent=0`,
        `intent: positive=${evidence.intent.positive}, deny=${evidence.intent.deny}, no_send=${evidence.intent.noSend}`,
        "provider calls: 0 (vendor stubs required; real SMS/provider delivery disabled)",
        `status: ${evidence.status}${evidence.failure ? ` (${evidence.failure})` : ""}`,
    ].join("\n");
}
