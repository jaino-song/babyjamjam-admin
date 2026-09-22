import { CONVERSATION_EVAL_CASES, type ConversationScenario } from "../../../evals/conversation/cases";
import { createDeterministicClock, evaluateConversationCase } from "../../../evals/conversation/evaluation-policy";
import { createNoNetworkMockTransport } from "../../../evals/conversation/mock-transport";
import {
    createDeterministicProductRuntimeDriver,
    createProductRuntimeAdapter,
    projectScenarioForProduct,
    structuredObservationsForEvents,
} from "../../../evals/conversation/product-runtime-adapter";
import { AgentTaskConflictException } from "./agent-task.service";

describe("deterministic product runtime bridge", () => {
    it("projects turns without carrying fixture oracle expectations", () => {
        const projection = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        expect(projection).not.toHaveProperty("oracle");
        expect(projection.turns).toEqual(CONVERSATION_EVAL_CASES[0]!.turns);
        expect(Object.keys(projection).sort()).toEqual([
            "deterministicClock", "family", "fixtureVersion", "id", "partition", "syntheticTokens", "turns",
        ]);
    });

    it("drives each turn through the injected product runtime and reads counters from transport", async () => {
        const transport = createNoNetworkMockTransport();
        const seen: string[] = [];
        const adapter = createProductRuntimeAdapter({
            driver: {
                runTurn: async ({ turn, clock }) => {
                    seen.push(`${turn.id}:${clock.now}`);
                    return turn.id === "t2" ? {
                        completion: "awaiting_user",
                        assistantMessages: [{ turnId: turn.id, text: "실제 런타임 관찰" }],
                    } : undefined;
                },
                inspect: async () => ({ currentState: {
                    phase: "observed",
                    version: "v1",
                    facts: {},
                    requiredTokens: [],
                    observedAt: "2026-01-15T09:00:00.000Z",
                } }),
            },
        });
        const scenario = {
            ...CONVERSATION_EVAL_CASES[0]!,
            turns: [
                { ...CONVERSATION_EVAL_CASES[0]!.turns[0]!, id: "t1" },
                { ...CONVERSATION_EVAL_CASES[0]!.turns[1]!, id: "t2", inputEvents: [{ type: "clock_advance" as const, at: "2026-01-15T10:00:00.000Z" }] },
            ],
        };
        const observation = await adapter.run({ case: scenario, clock: createDeterministicClock(), transport });

        expect(seen).toEqual(["t1:2026-01-15T09:00:00.000Z", "t2:2026-01-15T10:00:00.000Z"]);
        expect(observation.completion).toBe("awaiting_user");
        expect(observation.currentState?.phase).toBe("observed");
        expect(observation.transport).toEqual({ networkCalls: 0, calls: 0 });
    });

    it("returns not_evaluated evidence when no product driver is connected", async () => {
        const transport = createNoNetworkMockTransport();
        const adapter = createProductRuntimeAdapter();
        const scenario = CONVERSATION_EVAL_CASES[0]!;
        const observation = await adapter.run({ case: scenario, clock: createDeterministicClock(), transport });
        const result = evaluateConversationCase(scenario, observation);

        expect(result.status).toBe("not_evaluated");
        expect(observation.transport).toEqual({ networkCalls: 0, calls: 0 });
    });

    it("fails closed when a product driver attempts network I/O", async () => {
        let calls = 0;
        const transport = {
            get calls() { return calls; },
            get networkCalls() { return calls; },
            async request<T = never>(): Promise<T> {
                calls += 1;
                return undefined as T;
            },
        };
        const adapter = createProductRuntimeAdapter({
            driver: {
                runTurn: async ({ transport: injected }) => {
                    await injected.request("https://offline.invalid");
                    return undefined;
                },
            },
        });
        const scenario = CONVERSATION_EVAL_CASES[0]!;
        const observation = await adapter.run({ case: scenario, clock: createDeterministicClock(), transport });
        expect(observation.safetyErrors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "other", message: expect.stringContaining("network calls") }),
        ]));
        expect(observation.transport).toEqual({ networkCalls: 2, calls: 2 });
    });

    it("does not infer business completion from a normal taskless stream", async () => {
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        const scenario = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        await driver.reset?.({ scenario, clock: createDeterministicClock(), transport });
        const turn = {
            id: "taskless-runtime-turn",
            userText: "고객 상태를 알려줘.",
            inputEvents: [{ type: "user_message" as const, text: "고객 상태를 알려줘." }],
        };
        const observation = await driver.runTurn({ scenario, turn, turnIndex: 0, clock: createDeterministicClock(), transport });

        expect(observation?.completion).toBeUndefined();
        expect(observation?.currentState).toEqual(expect.objectContaining({
            phase: "runtime_observed",
            facts: { taskCount: "0", stream: "completed" },
        }));
        expect(observation?.currentState).not.toEqual(expect.objectContaining({ phase: "answered" }));
    });

    it("does not label generic patch, question, empty-result, or non-reload command receipts", async () => {
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        const scenario = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        await driver.reset?.({ scenario, clock: createDeterministicClock(), transport });
        const explicit = "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678";
        const context = (id: string, text: string) => ({
            scenario,
            turn: { id, userText: text, inputEvents: [{ type: "user_message" as const, text }] },
            turnIndex: 0,
            clock: createDeterministicClock(),
            transport,
        });

        await driver.runTurn(context("semantic-turn-1", explicit));
        const patch = await driver.runTurn(context("semantic-turn-2", "이름: SYN_CHANGED"));
        const question = await driver.runTurn(context("semantic-turn-3", "필수 정보가 더 있나요?"));

        expect(patch?.structuredEvents).toEqual([]);
        expect(question?.structuredEvents).toEqual([]);

        type ProductEvent = Parameters<typeof structuredObservationsForEvents>[0][number];
        const event = (operation: string) => ({
            id: "event",
            sessionId: "session",
            userId: "user",
            branchId: "branch",
            clientEventId: "client-event",
            taskId: "task",
            operation,
            requestHash: "request-hash",
            acceptedRevision: 1,
            resultActionId: null,
            acceptedAt: new Date("2026-01-15T09:00:00.000Z"),
        } as ProductEvent);
        expect(structuredObservationsForEvents([event("choices:client-target:empty")], false, "2026-01-15T09:00:00.000Z")).toEqual([]);
        expect(structuredObservationsForEvents([event("command:start-update")], false, "2026-01-15T09:00:00.000Z")).toEqual([]);
    });

    it("drives the real runtime and task service, then replays the same intake without a second task", async () => {
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        await driver.reset?.({
            scenario: projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!),
            clock: createDeterministicClock(),
            transport,
        });
        const scenario = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        const turn = {
            id: "product-runtime-replay-turn",
            userText: "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678",
            inputEvents: [{ type: "user_message" as const, text: "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678" }],
        };
        const context = {
            scenario,
            turn,
            turnIndex: 0,
            clock: createDeterministicClock(),
            transport,
        };

        const firstObservation = await driver.runTurn(context);
        const first = driver.getEvidence();
        expect(first.runtimeInvocations).toBe(1);
        expect(first.modelInvocations).toBe(1);
        expect(first.taskServiceReads).toBeGreaterThan(0);
        expect(first.acceptedTaskIds).toHaveLength(1);
        expect(first.eventCount).toBe(1);
        expect(firstObservation?.currentState).toEqual(expect.objectContaining({
            phase: "collecting",
            facts: expect.objectContaining({ taskState: "collecting", taskRevision: "1" }),
        }));
        expect(firstObservation?.acceptedDraftState).toEqual(expect.objectContaining({
            status: "pending",
            fields: expect.objectContaining({ name: "confirmed", phone: "confirmed" }),
            version: "1",
        }));
        expect(firstObservation?.structuredEvents).toEqual([
            expect.objectContaining({ type: "draft_requested", value: "create" }),
        ]);
        expect(firstObservation?.assistantMessages).toEqual([
            expect.objectContaining({ turnId: turn.id, text: expect.stringContaining("결정론적 제품 런타임 응답") }),
        ]);

        // Recreate process-local runtime collaborators while retaining the
        // repository/session maps. The durable intake receipt must still
        // classify the retry as a replay and avoid a second task/event.
        driver.restart();
        const replayObservation = await driver.runTurn(context);
        const replay = driver.getEvidence();
        expect(replay.runtimeInvocations).toBe(2);
        expect(replay.modelInvocations).toBe(2);
        expect(replay.acceptedTaskIds).toEqual(first.acceptedTaskIds);
        expect(replay.eventCount).toBe(first.eventCount);
        expect(replay.replayedMessageIds).toEqual([turn.id]);
        expect(replay.runtimeRestarts).toBe(1);
        expect(replayObservation?.structuredEvents).toEqual([]);
        expect(replayObservation?.acceptedDraftState).toEqual(firstObservation?.acceptedDraftState);
        expect(transport.networkCalls).toBe(0);
    });

    it("reports stale revisions and event payload conflicts from the product task service", async () => {
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        const scenario = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        await driver.reset?.({ scenario, clock: createDeterministicClock(), transport });

        const text = "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678";
        await driver.runTurn({
            scenario,
            turn: { id: "conflict-seed-turn", userText: text, inputEvents: [{ type: "user_message", text }] },
            turnIndex: 0,
            clock: createDeterministicClock(),
            transport,
        });
        const [task] = driver.taskRepository.snapshotTasks();
        if (!task) throw new Error("The product host did not create the conflict test task");

        const patchEventId = "f3000000-0000-4000-8000-000000000001";
        const first = await driver.taskService.patch(driver.principal, task.taskId, {
            clientEventId: patchEventId,
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "SYN_PATCHED" }],
        });
        const expectConflict = async (run: () => Promise<unknown>, reason: "revision" | "event_payload") => {
            try {
                await run();
                throw new Error(`Expected an ${reason} conflict`);
            } catch (error) {
                if (!(error instanceof AgentTaskConflictException)) throw error;
                expect(error.getResponse()).toEqual(expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason }));
            }
        };

        await expectConflict(() => driver.taskService.patch(driver.principal, task.taskId, {
            clientEventId: "f3000000-0000-4000-8000-000000000002",
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "address", value: "SYN_STALE" }],
        }), "revision");
        await expectConflict(() => driver.taskService.patch(driver.principal, task.taskId, {
            clientEventId: patchEventId,
            expectedRevision: first.snapshot.revision,
            operations: [{ op: "set", field: "name", value: "SYN_OTHER" }],
        }), "event_payload");

        expect(driver.taskRepository.snapshotEvents({ ...driver.principal, sessionId: task.sessionId })).toHaveLength(2);
        expect(transport.networkCalls).toBe(0);
    });

    it("purges an expired product task from live host evidence", async () => {
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        const scenario = projectScenarioForProduct(CONVERSATION_EVAL_CASES[0]!);
        await driver.reset?.({ scenario, clock: createDeterministicClock(), transport });

        const text = "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678";
        await driver.runTurn({
            scenario,
            turn: { id: "purge-seed-turn", userText: text, inputEvents: [{ type: "user_message", text }] },
            turnIndex: 0,
            clock: createDeterministicClock(),
            transport,
        });
        const [task] = driver.taskRepository.snapshotTasks();
        if (!task) throw new Error("The product host did not create the purge test task");
        const stored = driver.taskRepository.tasks.get(task.taskId);
        if (!stored) throw new Error("The purge test task was not retained by the product repository");
        stored.expiresAt = new Date(0);

        await expect(driver.taskRepository.purgeExpired(new Date())).resolves.toBe(1);
        expect(stored.purgedAt).toEqual(expect.any(Date));
        expect(driver.getEvidence().acceptedTaskIds).toEqual([]);
        const inspection = await driver.inspect({ scenario, clock: createDeterministicClock(), transport });
        expect(inspection?.currentState).toEqual(expect.objectContaining({
            phase: "runtime_observed",
            facts: { taskCount: "0", stream: "completed" },
        }));
        expect(transport.networkCalls).toBe(0);
    });

    it("keeps semantic product observations invariant when fixture oracle text changes", async () => {
        const base = CONVERSATION_EVAL_CASES[8]!;
        const changed = {
            ...base,
            oracle: {
                ...base.oracle,
                completion: base.oracle.completion === "completed" ? "blocked" as const : "completed" as const,
                currentState: {
                    ...base.oracle.currentState,
                    phase: "oracle-perturbed",
                },
                requiredEvents: [],
            },
        };
        const run = async (scenario: ConversationScenario) => {
            const transport = createNoNetworkMockTransport();
            const driver = createDeterministicProductRuntimeDriver();
            const adapter = createProductRuntimeAdapter({ driver });
            return adapter.run({ case: scenario, clock: createDeterministicClock(), transport });
        };

        const originalObservation = await run(base);
        const changedObservation = await run(changed);
        expect(changedObservation).toEqual(originalObservation);
    });

    it("carries an explicit registration through evaluation while replaying after restart", async () => {
        const text = "고객 등록해줘. 이름: SYN_PRODUCT, 전화번호: 01012345678";
        const base = CONVERSATION_EVAL_CASES[8]!;
        const firstTurn = {
            id: "explicit-product-eval-turn",
            userText: text,
            inputEvents: [{ type: "user_message" as const, text }],
        };
        const scenario: ConversationScenario = {
            ...base,
            id: "explicit-product-eval",
            syntheticTokens: ["SYN_PRODUCT"],
            turns: [
                firstTurn,
                {
                    ...firstTurn,
                    inputEvents: [
                        { type: "reload" as const, checkpoint: "synthetic-reload" },
                        { type: "user_message" as const, text },
                    ],
                },
            ],
            oracle: {
                completion: "awaiting_user",
                currentState: {
                    phase: "collecting",
                    version: "1",
                    facts: {
                        capabilityId: "clients.create",
                        taskState: "collecting",
                        taskRevision: "1",
                        taskCount: "1",
                        activeSlot: "1",
                        target: "absent",
                        choiceSetCount: "0",
                        issueCount: "0",
                    },
                    requiredTokens: [],
                },
                requiredEvents: [{ type: "draft_requested", value: "create" }],
                acceptedDraftState: {
                    status: "pending",
                    fields: { name: "confirmed", phone: "confirmed", serviceStatus: "confirmed", voucherClient: "confirmed" },
                    version: "1",
                },
                ledger: [],
                sends: [],
                authority: [],
                allowSafetyErrors: false,
            },
            digest: "explicit-product-eval-digest",
        };
        const transport = createNoNetworkMockTransport();
        const driver = createDeterministicProductRuntimeDriver();
        const adapter = createProductRuntimeAdapter({ driver });
        const observation = await adapter.run({ case: scenario, clock: createDeterministicClock(), transport });
        const result = evaluateConversationCase(scenario, observation);

        expect(result.status).toBe("not_evaluated");
        expect(result.observed.structuredEvents).toBe(1);
        expect(result.failures.every((failure) => failure.code === "missing_observation")).toBe(true);
        expect(driver.getEvidence().eventCount).toBe(1);
        expect(driver.getEvidence().runtimeRestarts).toBe(1);
        expect(transport.networkCalls).toBe(0);
    });
});
