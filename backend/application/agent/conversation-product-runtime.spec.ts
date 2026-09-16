import { CONVERSATION_EVAL_CASES } from "../../../evals/conversation/cases";
import { createDeterministicClock, evaluateConversationCase } from "../../../evals/conversation/evaluation-policy";
import { createNoNetworkMockTransport } from "../../../evals/conversation/mock-transport";
import {
    createDeterministicProductRuntimeDriver,
    createProductRuntimeAdapter,
    projectScenarioForProduct,
} from "../../../evals/conversation/product-runtime-adapter";

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
            userText: "이름: SYN_PRODUCT, 전화번호: 01012345678",
            inputEvents: [{ type: "user_message" as const, text: "이름: SYN_PRODUCT, 전화번호: 01012345678" }],
        };
        const context = {
            scenario,
            turn,
            turnIndex: 0,
            clock: createDeterministicClock(),
            transport,
        };

        await driver.runTurn(context);
        const first = driver.getEvidence();
        expect(first.runtimeInvocations).toBe(1);
        expect(first.modelInvocations).toBe(1);
        expect(first.taskServiceReads).toBeGreaterThan(0);
        expect(first.acceptedTaskIds).toHaveLength(1);
        expect(first.eventCount).toBe(1);

        await driver.runTurn(context);
        const replay = driver.getEvidence();
        expect(replay.runtimeInvocations).toBe(2);
        expect(replay.modelInvocations).toBe(2);
        expect(replay.acceptedTaskIds).toEqual(first.acceptedTaskIds);
        expect(replay.eventCount).toBe(first.eventCount);
        expect(replay.replayedMessageIds).toEqual([turn.id]);
        expect(transport.networkCalls).toBe(0);
    });
});
