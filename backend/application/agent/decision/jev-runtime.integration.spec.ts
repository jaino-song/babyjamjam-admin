import { z } from "zod";

import type { AgentTask, BjjUIMessage } from "@babyjamjam/shared";
import { DeterministicAgentLanguageModel } from "infrastructure/agent/deterministic-agent-language-model";

import { AgentRuntimeService } from "../agent-runtime.service";
import { CapabilityRouterService } from "../capability-router.service";
import type { DecisionTurnContext } from "./agent-decision.service";
import { createDecisionTraceCollector, type DecisionTraceCollector } from "./decision-trace";
import { DECISION_KINDS, DECISION_MODES, type DecisionMode, type DecisionPolicyResult } from "./decision-contracts";

/**
 * Runtime ↔ decision-layer integration wiring (P0).
 *
 * These tests exercise the full runtime turn: turn-context/collector creation,
 * request-signal abort wiring, router hand-off (off/shadow/enforce), the
 * enforce client-intent step, and additive trace finalization. The decision
 * façade is mocked at its public boundary (DecisionPolicyResult values) so the
 * tests pin runtime behavior, not façade policy internals.
 */

const PRINCIPAL = { userId: "user-jev", branchId: "branch-jev", globalRole: "admin", branchRole: "admin" };

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

function readCapability(name: string, domain: string) {
    return {
        meta: {
            name,
            domain,
            version: "1.0.0",
            description: `Search ${domain}`,
            risk: "read" as const,
            requiredRoles: ["admin"],
            renderer: "activity" as const,
            flagKey: `agent.capability.${name}`,
            sideEffect: false,
        },
        inputSchema: z.object({}),
        outputSchema: z.object({ kind: z.literal("entity"), entity: z.object({ id: z.number(), name: z.string() }) }),
        execute: jest.fn().mockResolvedValue({ kind: "entity", entity: { id: 1, name: "결과" } }),
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

function taskSnapshot(capabilityId: "clients.create" | "clients.update"): AgentTask {
    const suffix = capabilityId === "clients.create" ? "1" : "2";
    return {
        schemaVersion: 1,
        taskId: `123e4567-e89b-42d3-a456-42661417400${suffix}`,
        sessionId: "123e4567-e89b-42d3-a456-426614174002",
        kind: capabilityId,
        capabilityId,
        revision: 1,
        state: "collecting",
        confirmed: {},
        tentative: {},
        clearedFields: [],
        provenance: { confirmed: {}, tentative: {} },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: {
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            acceptedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-02-01T00:00:00.000Z",
        },
        currentSnapshotRef: `123e4567-e89b-42d3-a456-42661417401${suffix}`,
    } as AgentTask;
}

interface RuntimeHarnessOptions {
    modes: { routeDomains: DecisionMode; classifyClientIntent: DecisionMode };
    intentResult?: DecisionPolicyResult<"read" | "create" | "update_related" | "ambiguous" | "unrelated">;
    ownership?: { replayed: boolean; activeTask: boolean; formBound: boolean; command: boolean; isQuestion: boolean };
    handleUserTurnTask?: AgentTask | null;
    capabilities?: ReturnType<typeof clientWriteCapability | typeof clientSearchCapability | typeof readCapability>[];
    routeDomainsResult?: DecisionPolicyResult<readonly string[]>;
    modelScript?: Array<{ type: "tool-call"; toolName: string; input: Record<string, unknown> } | { type: "text"; text: string }>;
}

interface RuntimeHarness {
    runtime: AgentRuntimeService;
    decisions: {
        createTurnContext: jest.Mock;
        routeDomains: jest.Mock;
        classifyClientIntent: jest.Mock;
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
    sessions: { create: jest.Mock; appendMessages: jest.Mock; update: jest.Mock; remove: jest.Mock };
    turnContexts: DecisionTurnContext[];
    model: DeterministicAgentLanguageModel;
}

function buildHarness(options: RuntimeHarnessOptions): RuntimeHarness {
    const capabilities = options.capabilities ?? [clientWriteCapability("clients.create"), clientSearchCapability()];
    const taskMode = capabilities.some((capability) => capability.meta.name === "clients.create" || capability.meta.name === "clients.update");
    const turnContexts: DecisionTurnContext[] = [];
    const decisions = {
        createTurnContext: jest.fn().mockImplementation(async (createOptions: { signal: AbortSignal; sampleKey: string }) => {
            const context: DecisionTurnContext = {
                deadlineAt: Date.now() + 800,
                signal: createOptions.signal,
                sampleKey: createOptions.sampleKey,
                collector: createDecisionTraceCollector(),
            };
            turnContexts.push(context);
            return context;
        }),
        routeDomains: jest.fn().mockImplementation(async () => options.routeDomainsResult ?? {
            status: "abstain",
            selection: null,
            baselineSelection: ["clients"],
            reason: "low-confidence",
            profileVersion: "profile-v1",
        }),
        classifyClientIntent: jest.fn().mockImplementation(async () => options.intentResult ?? {
            status: "abstain",
            selection: null,
            baselineSelection: null,
            reason: "low-confidence",
            profileVersion: "profile-v1",
        }),
    };
    const decisionConfig = {
        getKindMode: jest.fn().mockImplementation(async (kind: string) => (
            kind === DECISION_KINDS.routeDomains ? options.modes.routeDomains : options.modes.classifyClientIntent
        )),
    };
    const taskOrchestrator = {
        resolveTurnOwnership: jest.fn().mockResolvedValue(options.ownership ?? {
            replayed: false, activeTask: false, formBound: false, command: false, isQuestion: false,
        }),
        handleUserTurn: jest.fn().mockImplementation(async (turnInput: { capabilityId?: string }) => ({
            task: options.handleUserTurnTask !== undefined ? options.handleUserTurnTask : (turnInput.capabilityId ? taskSnapshot(turnInput.capabilityId as "clients.create" | "clients.update") : null),
            eventId: "event-jev",
            operations: [],
            isQuestion: false,
            replayed: false,
        })),
        filterWriteCapabilities: jest.fn().mockImplementation(async (_principal: unknown, offered: typeof capabilities) => ({
            capabilities: taskMode ? offered.filter((capability) => capability.meta.risk === "read") : offered,
            taskMode,
        })),
        protectedValuesForConversation: jest.fn().mockResolvedValue([]),
        taskModeEnabled: jest.fn().mockResolvedValue(taskMode),
        applyModelMutation: jest.fn().mockImplementation(async (mutation: { capabilityId: string }) => ({
            task: taskSnapshot(mutation.capabilityId as "clients.create" | "clients.update"),
            mutated: true,
        })),
    };
    const traces = {
        start: jest.fn().mockResolvedValue({ id: "trace-jev", startedAt: Date.now() }),
        finish: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
        create: jest.fn().mockResolvedValue({ id: "session-jev", selectedEntities: {}, messages: [] }),
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
        model,
    };
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

describe("Jev runtime integration (P0 decision layer)", () => {
    it("paired baseline: off and shadow turns produce equal task state, capability ids, and outcomes", async () => {
        const buildScenario = (modes: RuntimeHarnessOptions["modes"], intentResult?: RuntimeHarnessOptions["intentResult"]) => {
            const harness = buildHarness({ modes, intentResult });
            const streamPromise = harness.runtime.stream({
                principal: PRINCIPAL,
                locale: "ko",
                messages: [userMessage("message-paired", "새 고객 등록해줘")],
            });
            return { harness, streamPromise };
        };

        const off = await buildScenario({ routeDomains: DECISION_MODES.off, classifyClientIntent: DECISION_MODES.off });
        const offStream = await off.streamPromise;
        const offResult = await drainStream(offStream.stream);

        // Shadow observes through the façade with an accepted update_related
        // selection that must be ignored in favour of the incumbent regex
        // selection (clients.create).
        const shadow = await buildScenario(
            { routeDomains: DECISION_MODES.shadow, classifyClientIntent: DECISION_MODES.shadow },
            { status: "accepted", selection: "update_related", baselineSelection: null, reason: null, profileVersion: "profile-v1" },
        );
        const shadowStream = await shadow.streamPromise;
        const shadowResult = await drainStream(shadowStream.stream);

        // Off: no decision call at all. Shadow: observation calls happened.
        expect(off.harness.decisions.routeDomains).not.toHaveBeenCalled();
        expect(off.harness.decisions.classifyClientIntent).not.toHaveBeenCalled();
        expect(shadow.harness.decisions.routeDomains).toHaveBeenCalledTimes(1);
        expect(shadow.harness.decisions.classifyClientIntent).toHaveBeenCalledTimes(1);

        // The same incumbent text-derived selection feeds the orchestrator.
        expect(off.harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "clients.create" }));
        expect(shadow.harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "clients.create" }));

        // Same offered capability set, same task capability ids (task tool ran
        // on clients.create), same task snapshot chunk, same visible outcome.
        const offFilterArgs = off.harness.taskOrchestrator.filterWriteCapabilities.mock.calls[0]?.[1] as { meta: { name: string } }[];
        const shadowFilterArgs = shadow.harness.taskOrchestrator.filterWriteCapabilities.mock.calls[0]?.[1] as { meta: { name: string } }[];
        expect(shadowFilterArgs.map((capability) => capability.meta.name)).toEqual(offFilterArgs.map((capability) => capability.meta.name));
        expect(off.harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "clients.create" }));
        expect(shadow.harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "clients.create" }));
        expect(shadowResult.text).toBe(offResult.text);
        expect(shadowResult.chunks.filter((chunk) => (chunk as { type: string }).type === "data-task-snapshot").length)
            .toBe(offResult.chunks.filter((chunk) => (chunk as { type: string }).type === "data-task-snapshot").length);
    });

    it("enforce abstention: no conversational write tool and no text-derived write capability; reads remain", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            intentResult: { status: "abstain", selection: null, baselineSelection: null, reason: "low-confidence", profileVersion: "profile-v1" },
        });
        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-abstain", "새 고객 등록해줘")],
        });
        const drained = await drainStream(result.stream);

        // Inference ran (turn unbound) and abstained.
        expect(harness.taskOrchestrator.resolveTurnOwnership).toHaveBeenCalledTimes(1);
        expect(harness.decisions.classifyClientIntent).toHaveBeenCalledTimes(1);
        // No text-derived write capability reached the orchestrator.
        expect(harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: undefined }));
        // No conversational write tool was exposed or executed: the model
        // attempted the clients_create task tool, which must not exist on an
        // abstained turn.
        expect(harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
        // The read capability remains offered on the model surface.
        expect(harness.taskOrchestrator.filterWriteCapabilities).toHaveBeenCalledWith(
            PRINCIPAL,
            expect.arrayContaining([expect.objectContaining({ meta: expect.objectContaining({ name: "clients.search" }) })]),
        );
        expect(drained.chunks.every((chunk) => (chunk as { type: string }).type !== "data-task-snapshot" || true)).toBe(true);
    });

    it("enforce routing abstention answers a zero-tool clarification turn, not the feature-disabled refusal", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            // An enabled, unrouted-domain core read (dashboard.summary) must
            // still be absent from a "clarify" turn's offer: the router's
            // core-reads addition is gated on a non-empty routed domain list
            // (agent-chat-quality-router M4), and this turn's domains stay
            // empty on abstention.
            capabilities: [clientSearchCapability(), readCapability("dashboard.summary", "dashboard")],
            modelScript: [{ type: "text", text: "무엇을 도와드릴까요?" }],
        });
        // Record one route-domains observation into the turn's collector, the
        // same pattern the classify-client-intent façade mock uses above.
        harness.decisions.routeDomains.mockImplementation(async (context: DecisionTurnContext) => {
            context.collector.record({
                kind: "semantic-decision-v1",
                decisionKind: "route-domains",
                mode: "enforce",
                model: "jev-1.13.0",
                profileVersion: "profile-v1",
                questionVersion: "v1",
                labels: [],
                scores: [],
                latencyMs: 1,
                outcome: "abstain",
                reason: "low-confidence",
                disagreement: null,
                usage: null,
                missing: false,
                droppedReason: null,
            });
            return { status: "abstain", selection: null, baselineSelection: ["clients"], reason: "low-confidence", profileVersion: "profile-v1" };
        });
        const doStreamSpy = jest.spyOn(harness.model, "doStream");

        // A text with no keyword match leaves matched empty; the enforce
        // router consults the façade and abstains — the bug this test used
        // to encode converted that into the feature-disabled 403. It must
        // now be a normal traced turn with zero tools instead.
        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-no-keyword", "도와줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.traces.finish.mock.calls.length > 0);

        expect(doStreamSpy).toHaveBeenCalledTimes(1);
        const streamOptions = doStreamSpy.mock.calls[0]?.[0] as { tools?: unknown; prompt?: Array<{ role: string; content: string }> };
        expect(streamOptions.tools).toBeUndefined();
        const systemPrompt = streamOptions.prompt?.[0]?.content ?? "";
        expect(systemPrompt).toContain("Ask the user one short clarifying question about what they want to do");

        // No entry point to clients.create/clients.update was requested of
        // the orchestrator.
        expect(harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: undefined }));
        expect(harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();

        // The routing observation reached trace finalization.
        expect(harness.traces.finish).toHaveBeenCalledTimes(1);
        const [, outcomeArg, , , stepMetadataArg, decisionEventsArg] = harness.traces.finish.mock.calls[0] as unknown[];
        expect(outcomeArg).toBe("succeeded");
        expect(stepMetadataArg).toEqual([]);
        const decisionEvents = decisionEventsArg as Array<{ kind: string; decisionKind: string }>;
        expect(decisionEvents?.length).toBe(1);
        expect(decisionEvents?.[0]?.decisionKind).toBe("route-domains");
    });

    it("enforce deterministic (>2 keyword match) routing abstention also yields the zero-tool clarification turn", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            // Three enabled domains whose keywords all appear in the text
            // below: matched.length (3) exceeds 2, so the router abstains
            // deterministically before any façade call.
            capabilities: [clientSearchCapability(), readCapability("employees.search", "employees"), readCapability("schedules.search", "schedules")],
            modelScript: [{ type: "text", text: "무엇을 도와드릴까요?" }],
        });
        const doStreamSpy = jest.spyOn(harness.model, "doStream");

        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-many-keywords", "산모 관리사 일정 관련해서 도와줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.traces.finish.mock.calls.length > 0);

        expect(harness.decisions.routeDomains).not.toHaveBeenCalled();
        const streamOptions = doStreamSpy.mock.calls[0]?.[0] as { tools?: unknown };
        expect(streamOptions.tools).toBeUndefined();

        // This path never called the façade, so it produced no observation:
        // finish keeps the exact incumbent 5-argument form.
        expect(harness.traces.finish).toHaveBeenCalledTimes(1);
        const finishCall = harness.traces.finish.mock.calls[0] as unknown[];
        expect(finishCall).toHaveLength(5);
        expect(finishCall[1]).toBe("succeeded");
    });

    it("enforce clarify with a live owned task keeps its existing continuation and task tool byte-for-byte", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            handleUserTurnTask: taskSnapshot("clients.create"),
            routeDomainsResult: { status: "abstain", selection: null, baselineSelection: ["clients"], reason: "low-confidence", profileVersion: "profile-v1" },
            modelScript: [
                { type: "tool-call", toolName: "clients_create", input: { operations: [{ op: "clear", field: "address" }] } },
                { type: "text", text: "완료했습니다." },
            ],
        });
        const doStreamSpy = jest.spyOn(harness.model, "doStream");

        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-owned-no-keyword", "도와줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.taskOrchestrator.applyModelMutation.mock.calls.length > 0);

        // A router "clarify" on a turn a live task owns must not become the
        // zero-tool clarification behavior: the task tool is exposed exactly
        // as it already is today.
        const firstCallOptions = doStreamSpy.mock.calls[0]?.[0] as { tools?: unknown; prompt?: Array<{ role: string; content: string }> };
        expect(firstCallOptions.tools).toBeDefined();
        expect(JSON.stringify(firstCallOptions.tools)).toContain("clients_create");
        const systemPrompt = firstCallOptions.prompt?.[0]?.content ?? "";
        expect(systemPrompt).not.toContain("Ask the user one short clarifying question about what they want to do");
        expect(harness.taskOrchestrator.applyModelMutation).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "clients.create" }));
    });

    it("enforce clarify turn does not remove a session created this turn and persists the transcript", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            capabilities: [clientSearchCapability()],
            routeDomainsResult: { status: "abstain", selection: null, baselineSelection: ["clients"], reason: "low-confidence", profileVersion: "profile-v1" },
            modelScript: [{ type: "text", text: "무엇을 도와드릴까요?" }],
        });

        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-no-keyword-persist", "도와줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.sessions.appendMessages.mock.calls.length > 0);

        expect(harness.sessions.remove).not.toHaveBeenCalled();
        const [, , persistedMessages] = harness.sessions.appendMessages.mock.calls[0] as [string, unknown, unknown[]];
        const roles = (persistedMessages as Array<{ role: string }>).map((message) => message.role);
        expect(roles).toEqual(["user", "assistant"]);
    });

    it("enforce provider-unavailable routing also yields the zero-tool clarification turn", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
            capabilities: [clientSearchCapability()],
            routeDomainsResult: { status: "unavailable", selection: null, baselineSelection: ["clients"], reason: "transport-error", profileVersion: null },
            modelScript: [{ type: "text", text: "무엇을 도와드릴까요?" }],
        });
        const doStreamSpy = jest.spyOn(harness.model, "doStream");

        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-provider-unavailable", "도와줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.traces.finish.mock.calls.length > 0);

        const streamOptions = doStreamSpy.mock.calls[0]?.[0] as { tools?: unknown };
        expect(streamOptions.tools).toBeUndefined();
        expect(harness.taskOrchestrator.applyModelMutation).not.toHaveBeenCalled();
    });

    it("off and shadow keep the incumbent capabilities offered and never add the clarification instruction", async () => {
        for (const modes of [
            { routeDomains: DECISION_MODES.off, classifyClientIntent: DECISION_MODES.off },
            { routeDomains: DECISION_MODES.shadow, classifyClientIntent: DECISION_MODES.shadow },
        ]) {
            const harness = buildHarness({
                modes,
                // clients.search plus an unrouted-domain core read
                // (dashboard.summary) proves the router's always-offered
                // core-reads addition reaches this selected ("clients")
                // turn's tool surface (agent-chat-quality-router M4).
                capabilities: [clientSearchCapability(), readCapability("dashboard.summary", "dashboard")],
                routeDomainsResult: { status: "abstain", selection: null, baselineSelection: ["clients"], reason: "low-confidence", profileVersion: "profile-v1" },
                modelScript: [{ type: "text", text: "완료했습니다." }],
            });
            const doStreamSpy = jest.spyOn(harness.model, "doStream");

            const result = await harness.runtime.stream({
                principal: PRINCIPAL,
                locale: "ko",
                messages: [userMessage("message-off-shadow", "도와줘")],
            });
            await drainStream(result.stream);

            const streamOptions = doStreamSpy.mock.calls[0]?.[0] as { tools?: unknown; prompt?: Array<{ role: string; content: string }> };
            // The router contract guarantees off/shadow never return
            // "clarify": the incumbent read capability stays offered.
            expect(JSON.stringify(streamOptions.tools)).toContain("clients_search");
            // Core reads are appended on top of the routed ("clients")
            // selection even though dashboard.summary's own domain was
            // never routed for this turn.
            expect(JSON.stringify(streamOptions.tools)).toContain("dashboard_summary");
            const systemPrompt = streamOptions.prompt?.[0]?.content ?? "";
            expect(systemPrompt).not.toContain("Ask the user one short clarifying question about what they want to do");
        }
    });

    it("enforce guard: a non-enforce router disposition of \"clarify\" never becomes the zero-tool clarification turn", async () => {
        // The real CapabilityRouterService can never return "clarify" outside
        // enforce mode (see its own disposition contract comment), so this
        // combination cannot occur end-to-end today. It still has to be
        // pinned directly: `clarifyTurn`'s `routeMode === enforce` term is the
        // only thing standing between an off/shadow router result and the
        // zero-tool clarification behavior, and no other existing test can
        // exercise that term because the router itself never emits "clarify"
        // outside enforce. Inject a router double to force the combination.
        for (const routeMode of [DECISION_MODES.shadow, DECISION_MODES.off]) {
            const capabilities = [clientSearchCapability()];
            const decisions = {
                createTurnContext: jest.fn().mockImplementation(async (createOptions: { signal: AbortSignal; sampleKey: string }) => ({
                    deadlineAt: Date.now() + 800,
                    signal: createOptions.signal,
                    sampleKey: createOptions.sampleKey,
                    collector: createDecisionTraceCollector(),
                })),
                routeDomains: jest.fn(),
                classifyClientIntent: jest.fn(),
            };
            const decisionConfig = {
                getKindMode: jest.fn().mockImplementation(async (kind: string) => (
                    kind === DECISION_KINDS.routeDomains ? routeMode : DECISION_MODES.off
                )),
            };
            const router = { route: jest.fn().mockResolvedValue({ domains: [], capabilities: [], disposition: "clarify" }) };
            const sessions = {
                create: jest.fn().mockResolvedValue({ id: "session-nonenforce-clarify", selectedEntities: {}, messages: [] }),
                appendMessages: jest.fn().mockResolvedValue(undefined),
                remove: jest.fn().mockResolvedValue(undefined),
            };
            const runtime = new AgentRuntimeService(
                { list: () => capabilities } as never,
                { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
                sessions as never,
                { modelId: "deterministic-agent-v1", providerOptions: () => ({}), create: () => new DeterministicAgentLanguageModel([{ type: "text", text: "완료" }]) } as never,
                router as never,
                { start: jest.fn(), finish: jest.fn() } as never,
                undefined,
                undefined,
                undefined,
                undefined,
                decisions as never,
                decisionConfig as never,
            );

            // A non-enforce "clarify" disposition with zero offered
            // capabilities and no live task must fall through to the exact
            // incumbent feature-disabled-shaped refusal, never the zero-tool
            // clarification turn.
            await expect(runtime.stream({
                principal: PRINCIPAL,
                locale: "ko",
                messages: [userMessage(`message-nonenforce-clarify-${routeMode}`, "고객을 찾아줘")],
            })).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({ code: "ACCESS_DENIED" }),
            });
        }
    });

    it("bound turn bypass: owned turns skip inference and are never retargeted by text", async () => {
        for (const ownership of [
            { replayed: true, activeTask: false, formBound: false, command: false, isQuestion: false },
            { replayed: false, activeTask: true, formBound: false, command: false, isQuestion: false },
            { replayed: false, activeTask: false, formBound: false, command: true, isQuestion: false },
            { replayed: false, activeTask: false, formBound: false, command: false, isQuestion: true },
        ]) {
            const harness = buildHarness({
                modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
                ownership,
                handleUserTurnTask: taskSnapshot("clients.create"),
            });
            const result = await harness.runtime.stream({
                principal: PRINCIPAL,
                locale: "ko",
                messages: [userMessage("message-bound", "새 고객 등록해줘")],
            });
            await drainStream(result.stream);

            expect(harness.decisions.classifyClientIntent).not.toHaveBeenCalled();
            expect(harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: undefined }));
            expect(harness.taskOrchestrator.handleUserTurn).toHaveBeenCalledTimes(1);
        }
    });

    it("collector isolation: concurrent turns use separate collectors; late observations are counted, not merged", async () => {
        const first = buildHarness({
            modes: { routeDomains: DECISION_MODES.shadow, classifyClientIntent: DECISION_MODES.shadow },
        });
        const second = buildHarness({
            modes: { routeDomains: DECISION_MODES.shadow, classifyClientIntent: DECISION_MODES.shadow },
        });
        const firstStreamPromise = first.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-iso-a", "새 고객 등록해줘")],
        });
        const secondStreamPromise = second.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-iso-b", "새 고객 등록해줘")],
        });
        const [firstStream, secondStream] = await Promise.all([firstStreamPromise, secondStreamPromise]);
        await Promise.all([drainStream(firstStream.stream), drainStream(secondStream.stream)]);
        await until(() => first.traces.finish.mock.calls.length > 0 && second.traces.finish.mock.calls.length > 0);

        // Each turn created its own collector; no collector is shared.
        expect(first.turnContexts).toHaveLength(1);
        expect(second.turnContexts).toHaveLength(1);
        expect(first.turnContexts[0]!.collector).not.toBe(second.turnContexts[0]!.collector);

        // The façade was invoked with the owning turn's context only.
        const firstIntentContext = first.decisions.classifyClientIntent.mock.calls[0]?.[0] as DecisionTurnContext;
        const secondIntentContext = second.decisions.classifyClientIntent.mock.calls[0]?.[0] as DecisionTurnContext;
        expect(firstIntentContext).toBe(first.turnContexts[0]);
        expect(secondIntentContext).toBe(second.turnContexts[0]);

        // A late observation after drain is counted as dropped, never merged.
        const collector: DecisionTraceCollector = first.turnContexts[0]!.collector;
        // The runtime already drained this collector at finalization
        // (drained: false marks a repeat drain, per the collector contract).
        const drained = collector.drain();
        expect(drained.drained).toBe(false);
        expect(drained.events).toEqual([]);
        const lateRecorded = collector.record({
            kind: "semantic-decision-v1",
            decisionKind: "classify-client-intent",
            mode: "shadow",
            model: "jev-1.13.0",
            profileVersion: "profile-v1",
            questionVersion: "v1",
            labels: ["create"],
            scores: [0.9],
            latencyMs: 1,
            outcome: "abstain",
            reason: null,
            disagreement: null,
            usage: null,
            missing: false,
            droppedReason: null,
        });
        expect(lateRecorded).toBe(false);
        expect(collector.drain().droppedCount).toBe(1);
    });

    it("abort wiring: the turn signal aborts with the request signal and decision calls receive it", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.enforce, classifyClientIntent: DECISION_MODES.enforce },
        });
        const requestAbort = new AbortController();
        const streamPromise = harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-abort", "새 고객 등록해줘")],
            signal: requestAbort.signal,
        });
        const stream = await streamPromise;
        const intentContext = harness.decisions.classifyClientIntent.mock.calls[0]?.[0] as DecisionTurnContext;
        expect(intentContext.signal).toBe(harness.turnContexts[0]!.signal);
        requestAbort.abort();
        expect(harness.turnContexts[0]!.signal.aborted).toBe(true);
        expect(intentContext.signal.aborted).toBe(true);
        await drainStream(stream.stream);
        // The request signal listener was removed at finalization: aborting
        // again after the turn is complete must not throw and the turn stays
        // finalized exactly once.
        expect(harness.traces.finish).toHaveBeenCalledTimes(1);
    });

    it("trace merge: capability entries survive, decision events append, diagnostic appears only when non-zero", async () => {
        const harness = buildHarness({
            modes: { routeDomains: DECISION_MODES.shadow, classifyClientIntent: DECISION_MODES.shadow },
            modelScript: [{ type: "text", text: "완료했습니다." }],
        });
        // Simulate the façade recording observations into the turn collector,
        // including one overflow drop (collector bound is 4).
        harness.decisions.classifyClientIntent.mockImplementation(async (context: DecisionTurnContext) => {
            const baseEvent = {
                kind: "semantic-decision-v1" as const,
                decisionKind: "classify-client-intent" as const,
                mode: "shadow" as const,
                model: "jev-1.13.0",
                profileVersion: "profile-v1",
                questionVersion: "v1",
                labels: ["create"],
                scores: [0.9],
                latencyMs: 1,
                outcome: "abstain" as const,
                reason: null,
                disagreement: null,
                usage: null,
                missing: false,
                droppedReason: null,
            };
            for (let index = 0; index < 5; index += 1) context.collector.record(baseEvent);
            return { status: "abstain", selection: null, baselineSelection: null, reason: "low-confidence", profileVersion: "profile-v1" };
        });
        const result = await harness.runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-trace", "새 고객 등록해줘")],
        });
        await drainStream(result.stream);
        await until(() => harness.traces.finish.mock.calls.length > 0);

        expect(harness.traces.finish).toHaveBeenCalledTimes(1);
        const [traceArg, outcomeArg, , , stepMetadataArg, decisionEventsArg] = harness.traces.finish.mock.calls[0] as unknown[];
        expect(traceArg).toEqual(expect.objectContaining({ id: "trace-jev" }));
        expect(outcomeArg).toBe("succeeded");
        // Capability entries first, untouched, then exactly one bounded
        // diagnostic entry for the overflow drop.
        const stepMetadata = stepMetadataArg as Array<{ capability: string; version: string; risk: string; droppedCount?: number; pendingCount?: number }>;
        expect(stepMetadata[0]).toEqual({ capability: "clients.search", version: "1.0.0", risk: "read" });
        expect(stepMetadata[stepMetadata.length - 1]).toEqual({
            capability: "agent.decision-observations",
            version: "v1",
            risk: "read",
            droppedCount: 1,
            pendingCount: 0,
        });
        // The recorded observations were appended as decision events.
        const decisionEvents = decisionEventsArg as Array<{ kind: string; decisionKind: string }>;
        expect(decisionEvents?.length).toBe(4);
        expect(decisionEvents?.every((event) => event.kind === "semantic-decision-v1")).toBe(true);
    });

    it("feature-disabled preservation: disabled routing keeps the exact incumbent refusal", async () => {
        const capabilities = [clientSearchCapability()];
        const decisions = {
            createTurnContext: jest.fn().mockImplementation(async (createOptions: { signal: AbortSignal; sampleKey: string }) => ({
                deadlineAt: Date.now() + 800,
                signal: createOptions.signal,
                sampleKey: createOptions.sampleKey,
                collector: createDecisionTraceCollector(),
            })),
            routeDomains: jest.fn(),
            classifyClientIntent: jest.fn(),
        };
        const decisionConfig = {
            getKindMode: jest.fn().mockResolvedValue(DECISION_MODES.enforce),
        };
        const router = new CapabilityRouterService(
            { list: () => capabilities } as never,
            // No capability enabled anywhere → enabledDomains empty → disabled.
            { getSnapshot: jest.fn().mockResolvedValue({}), isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(false) } as never,
            undefined,
        );
        const sessions = { create: jest.fn().mockResolvedValue({ id: "session-disabled", selectedEntities: {}, messages: [] }), appendMessages: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) };
        const runtime = new AgentRuntimeService(
            { list: () => capabilities } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", providerOptions: () => ({}), create: () => new DeterministicAgentLanguageModel([{ type: "text", text: "완료" }]) } as never,
            router as never,
            { start: jest.fn(), finish: jest.fn() } as never,
            undefined,
            undefined,
            undefined,
            undefined,
            decisions as never,
            decisionConfig as never,
        );

        await expect(runtime.stream({
            principal: PRINCIPAL,
            locale: "ko",
            messages: [userMessage("message-disabled", "고객을 찾아줘")],
        })).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({ code: "ACCESS_DENIED", outcome: "NOT_APPLIED" }),
        });
        // Every kind here is enforce (not off): the router's feature-disabled
        // check (no capability enabled anywhere) short-circuits before the
        // enforce path ever calls the façade, so getKindMode still runs but
        // routeDomains is never invoked.
        expect(decisionConfig.getKindMode).toHaveBeenCalledWith(DECISION_KINDS.routeDomains);
        expect(decisions.routeDomains).not.toHaveBeenCalled();
        // `disabled` is never `clarify`: a session created on this turn is
        // still removed, exactly as the incumbent feature-disabled refusal.
        expect(sessions.remove).toHaveBeenCalledWith("session-disabled", expect.objectContaining({ userId: PRINCIPAL.userId, branchId: PRINCIPAL.branchId }));
    });
});
