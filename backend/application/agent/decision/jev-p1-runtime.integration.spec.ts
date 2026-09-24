import { z } from "zod";

import { AgentEntitySelectPartSchema, evaluateClientReadiness, type AgentTask, type BjjUIMessage } from "@babyjamjam/shared";
import { DeterministicAgentLanguageModel } from "infrastructure/agent/deterministic-agent-language-model";

import { AgentRuntimeService } from "../agent-runtime.service";
import { CapabilityRouterService } from "../capability-router.service";
import type { DecisionTurnContext } from "./agent-decision.service";
import { createDecisionTraceCollector } from "./decision-trace";
import { DECISION_KINDS, DECISION_MODES, type DecisionMode, type DecisionPolicyResult } from "./decision-contracts";
import type { ClarificationAdvice } from "./decision-policy";

/**
 * Runtime ↔ decision-layer integration wiring (P1 clarification).
 *
 * These tests exercise the full runtime turn with the evaluate-clarification
 * kind off, in shadow, and in enforce: fact derivation from committed task
 * state, the two enforcement seams (task write-tool exposure and model
 * mutation intake), the no-loop signal, and precedence of every existing
 * gate. The decision façade is mocked at its public boundary
 * (DecisionPolicyResult values) so the tests pin runtime behavior, not
 * façade policy internals.
 *
 * Candidate ranking is deliberately NOT wired (not_built): the persisted
 * choice mapping carries option ids and client ids but no structural facts
 * (service type, dates), so a candidate shortlist cannot be built from
 * existing data without a new client read. The final test proves the
 * chooser, option order, and revision binding are unchanged and that no
 * candidate surface exists at the runtime boundary.
 */

const PRINCIPAL = { userId: "user-p1", branchId: "branch-p1", globalRole: "admin", branchRole: "admin" };
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174002";
const TASK_ID = "123e4567-e89b-42d3-a456-426614174001";
/** A confirmed update target: a resolved reference, distinct from `target: null`. */
const CONFIRMED_TARGET = { targetRef: "123e4567-e89b-42d3-a456-426614174099", version: "a".repeat(64) };

const RECOMMEND_TRUE: DecisionPolicyResult<ClarificationAdvice> = {
    status: "accepted",
    selection: { recommendClarification: true },
    baselineSelection: null,
    reason: null,
    profileVersion: "profile-v1",
};

/** Advice explicitly judges no clarification is needed this turn. */
const ADVICE_NO_CLARIFICATION: DecisionPolicyResult<ClarificationAdvice> = {
    status: "accepted",
    selection: { recommendClarification: false },
    baselineSelection: null,
    reason: null,
    profileVersion: "profile-v1",
};

const ADVICE_UNAVAILABLE: DecisionPolicyResult<ClarificationAdvice> = {
    status: "abstain",
    selection: null,
    baselineSelection: null,
    reason: "low-confidence",
    profileVersion: "profile-v1",
};

const ALL_OFF: RuntimeHarnessOptions["modes"] = {
    routeDomains: DECISION_MODES.off,
    classifyClientIntent: DECISION_MODES.off,
    evaluateClarification: DECISION_MODES.off,
};

const CLARIFICATION_ENFORCE: RuntimeHarnessOptions["modes"] = {
    routeDomains: DECISION_MODES.off,
    classifyClientIntent: DECISION_MODES.off,
    evaluateClarification: DECISION_MODES.enforce,
};

/**
 * Every write field confirmed, with `name`/`phone` holding real values —
 * under the `task.required`-derived `missingFields` (BJJ-344 part 2), a
 * create task's only required fields are `name` and a valid 11-digit
 * `phone`; a null `phone` would itself be `phone_required` and defeat the
 * "no missing fields" scenarios below, unlike the old fieldStatus semantics
 * where merely being a confirmed key (even null) counted as present.
 */
const FULLY_CONFIRMED_VALUES = {
    name: "김민지",
    address: null,
    phone: "01011112222",
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: null,
    voucherClient: false,
    birthday: null,
    dueDate: null,
    birthDate: null,
    serviceStatus: "pre_booking" as const,
    breastPump: false,
    areaId: null,
};

function clientWriteCapability(name: "clients.create" | "clients.update") {
    return {
        meta: {
            name,
            domain: "clients",
            version: "1.0.0",
            description: name === "clients.create" ? "Create client" : "Update client",
            risk: "reversible-write" as const,
            requiredRoles: ["admin"],
            renderer: "action-proposal" as const,
            flagKey: `agent.capability.${name}`,
            sideEffect: true,
            approvalPolicy: "structured" as const,
            idempotencyPolicy: "action-id" as const,
        },
        inputSchema: z.object({}),
        outputSchema: z.object({ status: z.string() }),
        execute: jest.fn().mockResolvedValue({ status: "proposed" }),
    };
}

function clientSearchCapability() {
    return {
        meta: {
            name: "clients.search",
            domain: "clients",
            version: "1.0.0",
            description: "Search clients",
            risk: "read" as const,
            requiredRoles: ["admin"],
            renderer: "activity" as const,
            flagKey: "agent.capability.clients.search",
            sideEffect: false,
        },
        inputSchema: z.object({}),
        outputSchema: z.object({ kind: z.literal("entity"), entity: z.object({ id: z.number(), name: z.string() }) }),
        execute: jest.fn().mockResolvedValue({ kind: "entity", entity: { id: 1, name: "홍길동" } }),
    };
}

function clientMultiSearchCapability() {
    return {
        meta: {
            name: "clients.search",
            domain: "clients",
            version: "1.0.0",
            description: "Search clients",
            risk: "read" as const,
            requiredRoles: ["admin"],
            renderer: "activity" as const,
            flagKey: "agent.capability.clients.search",
            sideEffect: false,
        },
        inputSchema: z.object({ query: z.string() }),
        outputSchema: z.object({
            kind: z.literal("choices"),
            prompt: z.string(),
            choices: z.array(z.object({ id: z.number(), name: z.string(), serviceStatus: z.string().nullable() })).min(2),
        }),
        execute: jest.fn().mockResolvedValue({
            kind: "choices",
            prompt: "어느 산모를 말씀하시는지 선택해 주세요.",
            choices: [
                { id: 301, name: "첫 번째 후보", serviceStatus: null },
                { id: 302, name: "두 번째 후보", serviceStatus: "active" },
            ],
        }),
    };
}

/**
 * A minimal, DB-free mirror of `agent-task.service.ts`'s `issues()` (create)
 * and `updateIssues()` (update) — just the synchronous parts these tests
 * exercise (no duplicate-check network call; every scenario here either
 * omits `phone` from `confirmed` or gives it a valid 11-digit value, so the
 * async duplicate-check branch never needs to fire). This keeps the fixture
 * `AgentTask` objects' `.issues` field realistic, since `deriveMissingFields`
 * (agent-runtime.service.ts, BJJ-344 part 2) reads `task.issues` directly
 * rather than a separate test-only field.
 */
function deriveTaskIssues(params: {
    capabilityId: "clients.create" | "clients.update";
    confirmed: Record<string, unknown>;
    clearedFields: readonly string[];
    target: AgentTask["target"];
}): AgentTask["issues"] {
    if (params.capabilityId === "clients.create") {
        const readiness = evaluateClientReadiness(params.confirmed as never, null);
        return readiness.issues.map((issue) => {
            const field = issue === "name_required" ? "name" as const : issue.startsWith("phone") ? "phone" as const : undefined;
            // Mirrors agent-task.service.ts's issues(): a malformed phone is
            // task.invalid (a value was given but rejected), not
            // task.required (BJJ-348).
            const code = issue === "phone_duplicate" ? "task.duplicate" as const
                : issue === "phone_duplicate_check_failed" ? "task.invalid" as const
                    : issue === "phone_duplicate_check_required" ? "task.invalid" as const
                        : issue === "phone_must_be_11_digits" ? "task.invalid" as const
                            : "task.required" as const;
            const message = code === "task.invalid" && issue === "phone_must_be_11_digits"
                ? "A valid phone number is required"
                : "Additional task information is required";
            return { code, ...(field ? { field } : {}), severity: "error" as const, message };
        });
    }
    const issues: AgentTask["issues"] = [];
    if (!params.target) {
        issues.push({ code: "task.required", severity: "error", message: "A customer target is required" });
    }
    const hasProposedChange = Object.keys(params.confirmed).length > 0 || params.clearedFields.length > 0;
    if (!hasProposedChange) {
        issues.push({ code: "task.required", severity: "error", message: "Additional task information is required" });
    }
    return issues;
}

function taskSnapshot(overrides: Partial<AgentTask> = {}): AgentTask {
    const capabilityId = (overrides.capabilityId ?? "clients.create") as "clients.create" | "clients.update";
    const confirmed = (overrides.confirmed ?? {}) as Record<string, unknown>;
    const clearedFields = overrides.clearedFields ?? [];
    const target = overrides.target !== undefined ? overrides.target : null;
    const defaultIssues = deriveTaskIssues({ capabilityId, confirmed, clearedFields, target });
    return {
        schemaVersion: 1,
        taskId: TASK_ID,
        sessionId: SESSION_ID,
        kind: capabilityId,
        capabilityId,
        revision: 1,
        state: "collecting",
        confirmed,
        tentative: {},
        clearedFields,
        provenance: { confirmed: {}, tentative: {} },
        issues: defaultIssues,
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        target,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: {
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            acceptedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-02-01T00:00:00.000Z",
        },
        currentSnapshotRef: "123e4567-e89b-42d3-a456-426614174003",
        ...overrides,
    } as AgentTask;
}

interface TurnResultOverrides {
    task?: AgentTask | null;
    mutated?: boolean;
    replayed?: boolean;
    operations?: Array<{ op: "set"; field: string; value: string }>;
    isQuestion?: boolean;
    mutationBlocked?: boolean;
}

interface RuntimeHarnessOptions {
    modes: { routeDomains: DecisionMode; classifyClientIntent: DecisionMode; evaluateClarification: DecisionMode };
    clarificationResult?: DecisionPolicyResult<ClarificationAdvice>;
    turn?: TurnResultOverrides;
    turnTaskSequence?: AgentTask[];
    capabilities?: ReturnType<typeof clientWriteCapability | typeof clientSearchCapability | typeof clientMultiSearchCapability>[];
    modelScript?: Array<{ type: "tool-call"; toolName: string; input: Record<string, unknown> } | { type: "text"; text: string }>;
    attachDerivedChoices?: jest.Mock;
}

interface RuntimeHarness {
    runtime: AgentRuntimeService;
    decisions: {
        createTurnContext: jest.Mock;
        routeDomains: jest.Mock;
        classifyClientIntent: jest.Mock;
        evaluateClarification: jest.Mock;
        rankCandidates?: unknown;
    };
    decisionConfig: { getKindMode: jest.Mock };
    taskOrchestrator: {
        resolveTurnOwnership: jest.Mock;
        handleUserTurn: jest.Mock;
        filterWriteCapabilities: jest.Mock;
        protectedValuesForConversation: jest.Mock;
        taskModeEnabled: jest.Mock;
        applyModelMutation: jest.Mock;
    };
    traces: { start: jest.Mock; finish: jest.Mock };
    sessions: { create: jest.Mock; get: jest.Mock; appendMessages: jest.Mock; update: jest.Mock };
    turnContexts: DecisionTurnContext[];
    modelStream: jest.SpyInstance;
}

function buildHarness(options: RuntimeHarnessOptions): RuntimeHarness {
    const capabilities = options.capabilities ?? [clientWriteCapability("clients.create"), clientSearchCapability()];
    const taskMode = capabilities.some((capability) => capability.meta.name === "clients.create" || capability.meta.name === "clients.update");
    const turnContexts: DecisionTurnContext[] = [];
    const decisions = {
        createTurnContext: jest.fn().mockImplementation(async (createOptions: { signal: AbortSignal; sampleKey: string; branchId: string }) => {
            const context: DecisionTurnContext = {
                signal: createOptions.signal,
                sampleKey: createOptions.sampleKey,
                inScope: true,
                collector: createDecisionTraceCollector(),
            };
            turnContexts.push(context);
            return context;
        }),
        routeDomains: jest.fn(),
        classifyClientIntent: jest.fn(),
        evaluateClarification: jest.fn().mockImplementation(async () => options.clarificationResult ?? ADVICE_UNAVAILABLE),
    };
    const decisionConfig = {
        getKindMode: jest.fn().mockImplementation(async (kind: string) => {
            if (kind === DECISION_KINDS.routeDomains) return options.modes.routeDomains;
            if (kind === DECISION_KINDS.classifyClientIntent) return options.modes.classifyClientIntent;
            if (kind === DECISION_KINDS.evaluateClarification) return options.modes.evaluateClarification;
            return DECISION_MODES.off;
        }),
    };
    let turnCall = 0;
    const handleUserTurn = jest.fn().mockImplementation(async (turnInput: { capabilityId?: string }) => {
        const task = options.turnTaskSequence
            ? options.turnTaskSequence[Math.min(turnCall, options.turnTaskSequence.length - 1)]!
            : options.turn?.task !== undefined
                ? options.turn.task
                : turnInput.capabilityId
                    ? taskSnapshot({ capabilityId: turnInput.capabilityId as "clients.create" | "clients.update", kind: turnInput.capabilityId as "clients.create" | "clients.update" })
                    : null;
        turnCall += 1;
        return {
            eventId: "event-p1",
            requestHash: "hash-p1",
            text: "새 고객 등록해줘",
            task,
            mutated: options.turn?.mutated ?? false,
            replayed: options.turn?.replayed ?? false,
            operations: options.turn?.operations ?? [],
            isQuestion: options.turn?.isQuestion ?? false,
            ...(options.turn?.mutationBlocked ? { mutationBlocked: true } : {}),
        };
    });
    const taskOrchestrator = {
        resolveTurnOwnership: jest.fn().mockResolvedValue({
            replayed: false, activeTask: false, formBound: false, command: false, isQuestion: false,
        }),
        handleUserTurn,
        filterWriteCapabilities: jest.fn().mockImplementation(async (_principal: unknown, offered: typeof capabilities) => ({
            capabilities: taskMode ? offered.filter((capability) => capability.meta.risk === "read") : offered,
            taskMode,
        })),
        protectedValuesForConversation: jest.fn().mockResolvedValue([]),
        taskModeEnabled: jest.fn().mockResolvedValue(taskMode),
        applyModelMutation: jest.fn().mockImplementation(async (mutation: { capabilityId: string }) => ({
            task: taskSnapshot({ capabilityId: mutation.capabilityId as "clients.create" | "clients.update", kind: mutation.capabilityId as "clients.create" | "clients.update" }),
            mutated: true,
        })),
        ...(options.attachDerivedChoices ? { attachDerivedChoices: options.attachDerivedChoices } : {}),
    };
    const traces = {
        start: jest.fn().mockResolvedValue({ id: "trace-p1", startedAt: Date.now() }),
        finish: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
        create: jest.fn().mockResolvedValue({ id: SESSION_ID, selectedEntities: {}, messages: [] }),
        get: jest.fn().mockResolvedValue({ id: SESSION_ID, selectedEntities: {}, messages: [] }),
        appendMessages: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
    };
    const router = new CapabilityRouterService(
        { list: () => capabilities } as never,
        { getSnapshot: jest.fn().mockResolvedValue({}), isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(true) } as never,
        undefined,
    );
    const model = new DeterministicAgentLanguageModel(options.modelScript ?? [
        { type: "tool-call", toolName: "clients_create", input: { operations: [{ op: "clear", field: "address" }] } },
        { type: "text", text: "완료했습니다." },
    ]);
    const modelStream = jest.spyOn(model, "doStream");
    const runtime = new AgentRuntimeService(
        { list: () => capabilities } as never,
        { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
        sessions as never,
        { modelId: "deterministic-agent-v1", providerOptions: () => ({}), create: () => model } as never,
        router as never,
        traces as never,
        undefined,
        undefined,
        undefined,
        taskOrchestrator as never,
        decisions as never,
        decisionConfig as never,
    );
    return {
        runtime,
        decisions,
        decisionConfig,
        taskOrchestrator,
        traces,
        sessions,
        turnContexts,
        modelStream,
    };
}

/** The tool surface the model actually received, serialized for assertions. */
function exposedTools(harness: RuntimeHarness): string {
    return JSON.stringify(harness.modelStream.mock.calls.map(([callOptions]) => (callOptions as { tools?: unknown }).tools));
}

function clarificationFacadeInput(harness: RuntimeHarness): {
    text: string;
    knownValues: readonly string[];
    missingFields: readonly string[];
    targetConfirmed: boolean;
    baseline: null;
} {
    const call = harness.decisions.evaluateClarification.mock.calls[0] as unknown[];
    if (!call) throw new Error("evaluateClarification was not called");
    return call[1] as {
        text: string;
        knownValues: readonly string[];
        missingFields: readonly string[];
        targetConfirmed: boolean;
        baseline: null;
    };
}

function spyRecordClarificationAsked(harness: RuntimeHarness): jest.SpyInstance {
    return jest.spyOn(harness.runtime as unknown as { recordClarificationAsked: (...args: unknown[]) => void }, "recordClarificationAsked");
}

async function drainStream(stream: ReadableStream): Promise<{ chunks: unknown[]; text: string }> {
    const reader = stream.getReader();
    const chunks: unknown[] = [];
    let text = "";
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
        const chunk = read.value as { type: string; data?: { capability?: string }; textDelta?: string };
        chunks.push(chunk);
        if (chunk.type === "text-delta" && typeof chunk.textDelta === "string") text += chunk.textDelta;
    }
    return { chunks, text };
}

/** persistCompletion (and with it the trace finalization) settles shortly after the stream closes. */
async function until(condition: () => boolean, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("condition not met before timeout");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function userMessage(id: string, text: string): BjjUIMessage {
    return { id, role: "user", parts: [{ type: "text", text }] } as BjjUIMessage;
}

async function runTurnWithText(harness: RuntimeHarness, messageId: string, text: string): Promise<{ chunks: unknown[]; text: string }> {
    const stream = await harness.runtime.stream({
        principal: PRINCIPAL,
        sessionId: SESSION_ID,
        locale: "ko",
        messages: [userMessage(messageId, text)],
    });
    return drainStream(stream.stream);
}

async function runTurn(harness: RuntimeHarness, messageId: string): Promise<{ chunks: unknown[]; text: string }> {
    return runTurnWithText(harness, messageId, "새 고객 등록해줘");
}

describe("Jev runtime integration (P1 clarification)", () => {
    it("off/shadow parity: identical exposure, task state, mutation acceptance, and outcome; shadow only observes", async () => {
        const off = buildHarness({ modes: ALL_OFF });
        const offResult = await runTurn(off, "message-p1-off");
        await until(() => off.traces.finish.mock.calls.length > 0);

        const shadow = buildHarness({ modes: { ...ALL_OFF, evaluateClarification: DECISION_MODES.shadow }, clarificationResult: RECOMMEND_TRUE });
        // The real façade records the observation into the turn collector;
        // the mock mirrors that so the trace path is exercised end to end.
        shadow.decisions.evaluateClarification.mockImplementation(async (context: DecisionTurnContext) => {
            context.collector.record({
                kind: "semantic-decision-v1",
                decisionKind: DECISION_KINDS.evaluateClarification,
                mode: DECISION_MODES.shadow,
                model: "jev-1.13.0",
                profileVersion: "profile-v1",
                questionVersion: "v1",
                labels: [],
                scores: [],
                latencyMs: 1,
                outcome: "accepted",
                reason: null,
                disagreement: null,
                usage: null,
                missing: false,
                droppedReason: null,
            });
            return RECOMMEND_TRUE;
        });
        const shadowResult = await runTurn(shadow, "message-p1-shadow");
        await until(() => shadow.traces.finish.mock.calls.length > 0);

        // Off makes no façade call; shadow consults it exactly once with the
        // derived facts.
        expect(off.decisions.evaluateClarification).not.toHaveBeenCalled();
        expect(shadow.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(clarificationFacadeInput(shadow)).toEqual(expect.objectContaining({
            text: "새 고객 등록해줘",
            targetConfirmed: false,
            baseline: null,
            missingFields: expect.arrayContaining(["name", "phone"]),
        }));

        // Identical mutation acceptance: the same single model-origin
        // mutation, with no refusal flag, on both turns.
        expect(off.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
        expect(shadow.taskOrchestrator.applyModelMutation.mock.calls).toEqual(off.taskOrchestrator.applyModelMutation.mock.calls);

        // Identical tool exposure, task snapshot state, and visible outcome.
        expect(exposedTools(shadow)).toBe(exposedTools(off));
        expect(exposedTools(shadow)).toContain("clients_create");
        expect(shadowResult.text).toBe(offResult.text);
        const snapshotChunks = (result: { chunks: unknown[] }) => result.chunks.filter((chunk) => (chunk as { type: string }).type === "data-task-snapshot");
        expect(snapshotChunks(shadowResult).length).toBe(snapshotChunks(offResult).length);
        expect(snapshotChunks(shadowResult).length).toBeGreaterThan(0);

        // Shadow recorded exactly one clarification observation; off none.
        const offEvents = (off.traces.finish.mock.calls[0]?.[5] ?? []) as Array<{ decisionKind: string }>;
        const shadowEvents = (shadow.traces.finish.mock.calls[0]?.[5] ?? []) as Array<{ decisionKind: string }>;
        expect(offEvents).toHaveLength(0);
        expect(shadowEvents).toHaveLength(1);
        expect(shadowEvents[0]).toMatchObject({ decisionKind: DECISION_KINDS.evaluateClarification, mode: DECISION_MODES.shadow });
    });

    it("enforce suppression: an unconfirmed write target hides the conversational task write tool and refuses a model-origin mutation; reads remain (AC-18, BJJ-348)", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: RECOMMEND_TRUE,
            capabilities: [clientWriteCapability("clients.update"), clientSearchCapability()],
            // Update task with no confirmed target: the record is unknown, so
            // deterministic recovery owns the turn (BJJ-348 — only an
            // unconfirmed target suppresses model mutation, not a missing
            // value).
            turn: {
                task: taskSnapshot({ capabilityId: "clients.update", kind: "clients.update", target: null, confirmed: {} }),
            },
            modelScript: [
                { type: "tool-call", toolName: "clients_update", input: { operations: [{ op: "clear", field: "address" }] } },
                { type: "text", text: "어느 고객인지 확인이 필요합니다." },
            ],
        });
        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            sessionId: SESSION_ID,
            locale: "ko",
            messages: [userMessage("message-p1-suppressed", "고객 정보를 수정해줘")],
        });
        await drainStream(result.stream);

        // The model attempted the conversational write tool; it was not
        // exposed and no model-origin mutation reached the orchestrator.
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
        const tools = exposedTools(harness);
        expect(tools).not.toContain("clients_create");
        expect(tools).not.toContain("clients_update");
        // Read capabilities remain on the model surface.
        expect(tools).toContain("clients_search");
    });

    it("explicit input retained: accepted explicit operations keep the write tool and mutation path despite recommending advice", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: RECOMMEND_TRUE,
            turn: {
                task: taskSnapshot({ confirmed: { name: "김민지" } }),
                mutated: true,
                operations: [{ op: "set", field: "name", value: "김민지" }],
            },
        });
        await runTurn(harness, "message-p1-explicit");

        // The advice ran and the task still has missing fields.
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(clarificationFacadeInput(harness).missingFields).toEqual(expect.arrayContaining(["phone"]));
        // Yet this turn's accepted explicit input keeps today's path: the
        // write tool is exposed and the mutation call carries no refusal.
        expect(exposedTools(harness)).toContain("clients_create");
        expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
        const mutationArg = (harness.taskOrchestrator.applyModelMutation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect("allowMutation" in mutationArg).toBe(false);
    });

    // BJJ-344 part 2: missingFields now derives from the task's own
    // `task.required` issues (agent-runtime.service.ts's
    // `deriveMissingFields`) instead of "every field not yet
    // confirmed/tentative".
    // BJJ-348: `decideClarification`'s deterministic-recovery rule no longer
    // reads `missingFields` at all — only an unconfirmed write target
    // (`targetMissing`) suppresses model mutation. A missing VALUE is sent
    // to the provider as state but never hides the write tool; the model may
    // extract the value from free text, and every write still ends at the
    // mandatory approval card. These cases pin the corrected behavior end to
    // end through `decideClarification`'s real rule.
    it("update with a confirmed target and a given change value: clients_update stays exposed and the mutation applies", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: ADVICE_NO_CLARIFICATION,
            capabilities: [clientWriteCapability("clients.update"), clientSearchCapability()],
            turn: {
                task: taskSnapshot({
                    capabilityId: "clients.update",
                    kind: "clients.update",
                    target: CONFIRMED_TARGET,
                    confirmed: { address: "서울시 강남구" },
                }),
            },
            modelScript: [
                // "address" is a reference field (requires a server-resolved
                // valueRef, not a raw model value); "clear" needs neither, so
                // it exercises the tool call without tripping that schema
                // branch. The turn's proposed change already lives in the
                // task's own `confirmed.address` set up below.
                { type: "tool-call", toolName: "clients_update", input: { operations: [{ op: "clear", field: "birthday" }] } },
                { type: "text", text: "업데이트했습니다." },
            ],
        });
        // Update-matching text ("수정"): selectedClientWriteCapability
        // (agent-runtime.service.ts) must route to clients.update, not the
        // shared runTurn helper's create-matching default text — this
        // harness only offers clients.update as a write capability.
        await runTurnWithText(harness, "message-p1-update-ready", "고객 정보를 수정해줘");

        // Target confirmed + a proposed change already given this turn:
        // deriveMissingFields finds no un-scoped or field-scoped
        // task.required issue, so missingFields is empty.
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(clarificationFacadeInput(harness)).toEqual(expect.objectContaining({
            targetConfirmed: true,
            missingFields: [],
        }));
        expect(exposedTools(harness)).toContain("clients_update");
        expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
    });

    it("create missing name/phone: the model may still supply them via free text this turn, exposed and applied (BJJ-348)", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: ADVICE_NO_CLARIFICATION,
            // Default turn task: clients.create with confirmed: {} — neither
            // name nor phone is given yet, so evaluateClientReadiness's
            // name_required/phone_required issues surface as missingFields.
            // clients.create never has a target, so targetMissing is always
            // false and a missing VALUE never suppresses on its own.
            modelScript: [
                // "name"/"phone" are reference fields (require a
                // server-resolved valueRef, not a raw model value); "clear"
                // needs neither, so it exercises the tool call without
                // tripping that schema branch, exactly like the update
                // fixtures below.
                { type: "tool-call", toolName: "clients_create", input: { operations: [{ op: "clear", field: "address" }] } },
                { type: "text", text: "등록했습니다." },
            ],
        });
        await runTurnWithText(harness, "message-p1-create-missing", "김민지 010-1111-2222로 등록해줘");

        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(clarificationFacadeInput(harness).missingFields).toEqual(expect.arrayContaining(["name", "phone"]));
        expect(exposedTools(harness)).toContain("clients_create");
        expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
        const mutationArg = (harness.taskOrchestrator.applyModelMutation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect("allowMutation" in mutationArg).toBe(false);
    });

    it("update with a confirmed target but no committed change yet: the model may still supply the value via free text, exposed and applied (BJJ-348)", async () => {
        for (const clarificationResult of [ADVICE_NO_CLARIFICATION, ADVICE_UNAVAILABLE]) {
            const harness = buildHarness({
                modes: CLARIFICATION_ENFORCE,
                clarificationResult,
                capabilities: [clientWriteCapability("clients.update"), clientSearchCapability()],
                turn: {
                    task: taskSnapshot({
                        capabilityId: "clients.update",
                        kind: "clients.update",
                        target: CONFIRMED_TARGET,
                        confirmed: {},
                    }),
                },
                modelScript: [
                    { type: "tool-call", toolName: "clients_update", input: { operations: [{ op: "clear", field: "birthday" }] } },
                    { type: "text", text: "생일 정보를 지웠습니다." },
                ],
            });
            const messageId = `message-p1-update-freeform-${clarificationResult === ADVICE_UNAVAILABLE ? "advice-null" : "advice-no-req"}`;
            await runTurnWithText(harness, messageId, "생일 정보 지워서 수정해줘");

            // Target confirmed but zero committed changes yet: updateIssues'
            // own un-scoped task.required issue still fires, so
            // missingFields is non-empty (the exact BJJ-348 repro) — but a
            // missing VALUE never suppresses model mutation on its own.
            // Only an unconfirmed TARGET does, and targetMissing is false
            // here because the target is confirmed.
            expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
            const facts = clarificationFacadeInput(harness);
            expect(facts.targetConfirmed).toBe(true);
            expect(facts.missingFields.length).toBeGreaterThan(0);
            expect(exposedTools(harness)).toContain("clients_update");
            expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
            const mutationArg = (harness.taskOrchestrator.applyModelMutation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
            expect("allowMutation" in mutationArg).toBe(false);
        }
    });

    it("update with NO confirmed target: clients_update stays hidden — an unknown record still owns the turn (AC-18, BJJ-348)", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: ADVICE_NO_CLARIFICATION,
            capabilities: [clientWriteCapability("clients.update"), clientSearchCapability()],
            turn: {
                task: taskSnapshot({
                    capabilityId: "clients.update",
                    kind: "clients.update",
                    target: null,
                    confirmed: {},
                }),
            },
        });
        await runTurnWithText(harness, "message-p1-update-no-target", "고객 정보를 수정해줘");

        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        const facts = clarificationFacadeInput(harness);
        expect(facts.targetConfirmed).toBe(false);
        expect(harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
        const tools = exposedTools(harness);
        expect(tools).not.toContain("clients_update");
        expect(tools).toContain("clients_search");
    });

    it("unavailable advice: null advice changes nothing on clean facts", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: ADVICE_UNAVAILABLE,
            turn: { task: taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES }) },
        });
        const recordSpy = spyRecordClarificationAsked(harness);
        await runTurn(harness, "message-p1-unavailable");

        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        // The safe snapshot fact source derived zero missing fields.
        expect(clarificationFacadeInput(harness).missingFields).toEqual([]);
        // No clarification is recorded and nothing is suppressed.
        expect(recordSpy).not.toHaveBeenCalled();
        expect(exposedTools(harness)).toContain("clients_create");
        expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
        const mutationArg = (harness.taskOrchestrator.applyModelMutation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect("allowMutation" in mutationArg).toBe(false);
    });

    it("no-loop: the same revision does not record a second clarification; a new revision re-allows advice", async () => {
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: RECOMMEND_TRUE,
            turnTaskSequence: [
                taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES, revision: 1 }),
                taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES, revision: 1 }),
                taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES, revision: 2 }),
            ],
        });
        const recordSpy = spyRecordClarificationAsked(harness);

        // Turn 1 at revision 1: advice applied, clarification recorded.
        await runTurn(harness, "message-p1-loop-1");
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenNthCalledWith(1, SESSION_ID, TASK_ID, 1);

        // Turn 2 at the same revision 1: already-asked, no repeat record.
        await runTurn(harness, "message-p1-loop-2");
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(2);
        expect(recordSpy).toHaveBeenCalledTimes(1);

        // Turn 3 at revision 2: advice re-allowed and recorded again.
        await runTurn(harness, "message-p1-loop-3");
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(3);
        expect(recordSpy).toHaveBeenCalledTimes(2);
        expect(recordSpy).toHaveBeenNthCalledWith(2, SESSION_ID, TASK_ID, 2);
    });

    it("precedence preserved: question and replay turns behave exactly as in off while a plain unconfirmed-target turn is suppressed", async () => {
        const runScenario = async (modes: RuntimeHarnessOptions["modes"], turn: TurnResultOverrides, messageId: string) => {
            const harness = buildHarness({ modes, turn, clarificationResult: RECOMMEND_TRUE });
            const drained = await runTurn(harness, messageId);
            await until(() => harness.traces.finish.mock.calls.length > 0);
            return { harness, drained };
        };

        // (a) Pure question turn: read-only through the existing gate in both
        // modes — identical model surface, outcome, and no mutation.
        const questionOff = await runScenario(ALL_OFF, { task: taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES }), isQuestion: true }, "m-question-off");
        const questionEnforce = await runScenario(CLARIFICATION_ENFORCE, { task: taskSnapshot({ confirmed: FULLY_CONFIRMED_VALUES }), isQuestion: true }, "m-question-enforce");
        expect(exposedTools(questionEnforce.harness)).toBe(exposedTools(questionOff.harness));
        expect(exposedTools(questionEnforce.harness)).not.toContain("clients_create");
        expect(exposedTools(questionEnforce.harness)).toContain("clients_search");
        expect(questionOff.harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
        expect(questionEnforce.harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
        expect(questionEnforce.drained.text).toBe(questionOff.drained.text);

        // (b) Replayed turn: answer/read-only and the caller message is not
        // duplicated — identical in both modes.
        const replayOff = await runScenario(ALL_OFF, { task: taskSnapshot({ revision: 5 }), replayed: true }, "m-replay-off");
        const replayEnforce = await runScenario(CLARIFICATION_ENFORCE, { task: taskSnapshot({ revision: 5 }), replayed: true }, "m-replay-enforce");
        expect(exposedTools(replayEnforce.harness)).toBe(exposedTools(replayOff.harness));
        for (const scenario of [replayOff, replayEnforce]) {
            const persisted = (scenario.harness.sessions.appendMessages.mock.calls[0] as unknown[])[2] as Array<{ role: string }>;
            expect(persisted).toHaveLength(1);
            expect(persisted[0]?.role).toBe("assistant");
        }

        // (c) Plain unconfirmed-target update turn with no explicit input:
        // off exposes and accepts the model mutation (with the existing
        // correction-evidence argument), enforce suppresses both. Under
        // BJJ-348 an unconfirmed write target is the only thing that still
        // triggers deterministic recovery — a missing VALUE (the old
        // scenario here: create with name/phone unset) no longer does, so
        // this scenario switches to the one case that still differs between
        // the modes.
        const unconfirmedTargetCapabilities = [clientWriteCapability("clients.update"), clientSearchCapability()];
        const unconfirmedTargetTurn: TurnResultOverrides = {
            task: taskSnapshot({ capabilityId: "clients.update", kind: "clients.update", target: null, confirmed: {} }),
        };
        const unconfirmedTargetModelScript: RuntimeHarnessOptions["modelScript"] = [
            { type: "tool-call", toolName: "clients_update", input: { operations: [{ op: "clear", field: "address" }] } },
            { type: "text", text: "수정했습니다." },
        ];
        const cleanOffHarness = buildHarness({
            modes: ALL_OFF,
            turn: unconfirmedTargetTurn,
            clarificationResult: RECOMMEND_TRUE,
            capabilities: unconfirmedTargetCapabilities,
            modelScript: unconfirmedTargetModelScript,
        });
        await runTurnWithText(cleanOffHarness, "m-clean-off", "고객 정보를 수정해줘");
        const cleanEnforceHarness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            turn: unconfirmedTargetTurn,
            clarificationResult: RECOMMEND_TRUE,
            capabilities: unconfirmedTargetCapabilities,
            modelScript: unconfirmedTargetModelScript,
        });
        await runTurnWithText(cleanEnforceHarness, "m-clean-enforce", "고객 정보를 수정해줘");

        expect(exposedTools(cleanOffHarness)).toContain("clients_update");
        expect(cleanOffHarness.taskOrchestrator.applyModelMutation).toHaveBeenCalledTimes(1);
        expect((cleanOffHarness.taskOrchestrator.applyModelMutation.mock.calls[0] as unknown[])[0]).toMatchObject({ userCorrectionEvidence: [] });
        expect(exposedTools(cleanEnforceHarness)).not.toContain("clients_update");
        expect(cleanEnforceHarness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
    });

    it("candidates not built: chooser, option order, and revision binding unchanged; no candidate surface exists", async () => {
        const choiceSetRef = "123e4567-e89b-42d3-a456-426614174010";
        const optionIdA = "123e4567-e89b-42d3-a456-426614174011";
        const optionIdB = "123e4567-e89b-42d3-a456-426614174012";
        const attached = taskSnapshot({
            revision: 2,
            state: "confirming_target",
            choiceSets: [{
                choiceSetRef,
                options: [
                    { optionId: optionIdA, label: "첫 번째 후보" },
                    { optionId: optionIdB, label: "두 번째 후보" },
                ],
            }],
            orderedChoiceRefs: [choiceSetRef],
        });
        const attachDerivedChoices = jest.fn().mockResolvedValue({ snapshot: attached });
        const harness = buildHarness({
            modes: CLARIFICATION_ENFORCE,
            clarificationResult: RECOMMEND_TRUE,
            turn: { task: taskSnapshot() },
            capabilities: [clientWriteCapability("clients.create"), clientMultiSearchCapability()],
            modelScript: [
                { type: "tool-call", toolName: "clients_search", input: { query: "후보" } },
                { type: "text", text: "선택지를 표시했습니다." },
            ],
            attachDerivedChoices,
        });
        const drained = await runTurn(harness, "message-p1-chooser");

        // The clarification façade ran, yet no candidate ranking surface
        // exists at the runtime boundary at all (not_built).
        expect(harness.decisions.evaluateClarification).toHaveBeenCalledTimes(1);
        expect(harness.decisions.rankCandidates).toBeUndefined();

        // The lookup results reach the attachment in lookup order.
        expect(attachDerivedChoices).toHaveBeenCalledTimes(1);
        const attachResults = (attachDerivedChoices.mock.calls[0] as unknown[])[3] as Array<{ clientId: number }>;
        expect(attachResults.map((entry) => entry.clientId)).toEqual([301, 302]);

        // The visible chooser keeps the persisted option order and the same
        // choice-set revision binding; nothing is auto-selected.
        const selectionChunk = drained.chunks.find((chunk) => (chunk as { type: string }).type === "data-entity-select");
        expect(selectionChunk).toBeDefined();
        expect(AgentEntitySelectPartSchema.parse((selectionChunk as { data: unknown }).data)).toEqual({
            taskId: attached.taskId,
            choiceSetRef,
            optionIds: [optionIdA, optionIdB],
        });
        const snapshotChunks = drained.chunks.filter((chunk) => (chunk as { type: string }).type === "data-task-snapshot");
        expect(snapshotChunks.length).toBeGreaterThan(0);
        // Nothing was auto-selected: the task target reference is untouched
        // and the emitted part is an offer over every persisted option.
        expect(attached.target).toBeNull();

        // Lookup labels stay out of the model surface.
        expect(JSON.stringify(harness.modelStream.mock.calls)).not.toContain("첫 번째 후보");
        expect(JSON.stringify(harness.modelStream.mock.calls)).not.toContain("두 번째 후보");
    });
});
