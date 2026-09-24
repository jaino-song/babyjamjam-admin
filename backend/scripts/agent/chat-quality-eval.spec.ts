import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    aggregateResults,
    assembleAgentTurn,
    assembleLegacyTurn,
    buildRunReport,
    computeIntersectionMeans,
    deterministicFactsFromAgentTurn,
    deterministicFactsFromLegacyTurn,
    emptyDeterministicFacts,
    evaluateChecks,
    extractManifestCapabilityNames,
    extractSseDataEvents,
    findUnknownCapabilities,
    heuristicHasQuestion,
    mapToolNameToCapability,
    parseScenarioFile,
    renderCompareMarkdown,
    renderMarkdownTranscript,
    runScenario,
    runSuite,
    selectScenarios,
    transportFailureCheckResults,
    validateLoopbackBaseUrl,
    LoopbackGuardError,
    ScenarioValidationError,
    type ComparisonInput,
    type FetchLike,
    type HttpResponseLike,
    type JudgeScore,
    type RawStreamEvent,
    type RunReport,
    type Scenario,
    type ScenarioRunResult,
} from "./chat-quality-eval";
import { buildTokenProvider, parseCliArgs, USAGE } from "./run-chat-quality-eval";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCENARIOS_PATH = resolve(REPO_ROOT, "evals", "agent", "quality", "scenarios-v1.json");
const MANIFEST_PATH = resolve(REPO_ROOT, "backend", "agent-manifest.json");

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
    return {
        id: "test-scenario",
        category: "lookup",
        turns: ["도하린 산모 정보 보여줘"],
        intent: "test intent",
        rubric: "test rubric",
        checks: {},
        ...overrides,
    };
}

const JUDGE_SCORE: JudgeScore = { intent: 2, depth: 2, grounding: 2, format: 1, rationale: "ok" };

function fakeResponse(overrides: Partial<HttpResponseLike> & { body: string }): HttpResponseLike {
    return {
        ok: overrides.ok ?? true,
        status: overrides.status ?? 200,
        headers: overrides.headers ?? { get: () => null },
        text: async () => overrides.body,
    };
}

describe("scenario schema + manifest coverage", () => {
    it("loads and validates the real scenario file", () => {
        const raw = readJson(SCENARIOS_PATH);
        const parsed = parseScenarioFile(raw);
        expect(parsed.version).toBe("v1");
        expect(parsed.scenarios.length).toBeGreaterThanOrEqual(30);
    });

    it("rejects a scenario file with duplicate ids", () => {
        const base = scenario({ id: "dup" });
        expect(() => parseScenarioFile({ version: "v1", scenarios: [base, base] })).toThrow(ScenarioValidationError);
    });

    it("has unique scenario ids in the real file", () => {
        const parsed = parseScenarioFile(readJson(SCENARIOS_PATH));
        const ids = parsed.scenarios.map((s: Scenario) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("references only capabilities that exist in the real agent manifest", () => {
        const parsed = parseScenarioFile(readJson(SCENARIOS_PATH));
        const manifestCapabilities = extractManifestCapabilityNames(readJson(MANIFEST_PATH));
        expect(findUnknownCapabilities(parsed.scenarios, manifestCapabilities)).toEqual([]);
    });

    it("extractManifestCapabilityNames rejects a malformed manifest", () => {
        expect(() => extractManifestCapabilityNames([])).toThrow();
        expect(() => extractManifestCapabilityNames({})).toThrow();
    });

    it("findUnknownCapabilities reports a capability absent from the manifest", () => {
        const manifest = new Set(["clients.search"]);
        const scenarios = [scenario({ checks: { expectToolsAnyOf: ["clients.search", "clients.bogus"] } })];
        expect(findUnknownCapabilities(scenarios, manifest)).toEqual(["clients.bogus"]);
    });
});

describe("extractSseDataEvents", () => {
    it("parses data: lines shared by both endpoints' framing and ignores [DONE] and junk", () => {
        const body = [
            'data: {"type":"text-start","id":"1"}',
            "",
            'data: {"type":"text-delta","id":"1","delta":"hi"}',
            "not a data line",
            "data: not-json",
            "data: [DONE]",
            "",
        ].join("\n");
        const events = extractSseDataEvents(body);
        expect(events).toEqual([
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "hi" },
        ]);
    });

    it("parses event:/data: block framing (legacy) the same way", () => {
        const body = 'event: message\ndata: {"type":"chunk","content":"hello"}\n\n'
            + 'event: error\ndata: {"type":"error","error":"boom"}\n\n';
        const events = extractSseDataEvents(body);
        expect(events).toEqual([
            { type: "chunk", content: "hello" },
            { type: "error", error: "boom" },
        ]);
    });
});

describe("assembleAgentTurn", () => {
    const manifestCapabilities = new Set(["clients.search", "employees.search"]);

    it("assembles text deltas across multiple text-start/delta segments", () => {
        const events: RawStreamEvent[] = [
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "안" },
            { type: "text-delta", id: "a", delta: "녕" },
            { type: "text-end", id: "a" },
            { type: "text-start", id: "b" },
            { type: "text-delta", id: "b", delta: "하세요" },
        ];
        const turn = assembleAgentTurn(events, manifestCapabilities);
        expect(turn.finalText).toBe("안녕하세요");
    });

    it("maps tool names to capabilities via the manifest, keeping unknown names raw", () => {
        const events: RawStreamEvent[] = [
            { type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: { query: "도하린" } },
            { type: "tool-output-available", toolCallId: "c1", output: { kind: "entity" } },
            { type: "tool-input-available", toolCallId: "c2", toolName: "some_unknown_tool", input: {} },
        ];
        const turn = assembleAgentTurn(events, manifestCapabilities);
        const byId = Object.fromEntries(turn.toolCalls.map((call) => [call.toolCallId, call]));
        expect(byId["c1"]?.capability).toBe("clients.search");
        expect(byId["c1"]?.outputStatus).toBe("available");
        expect(byId["c2"]?.capability).toBe("some_unknown_tool");
    });

    it("correlates tool-output-available by toolCallId, not toolName (which it does not carry)", () => {
        const events: RawStreamEvent[] = [
            { type: "tool-input-available", toolCallId: "c1", toolName: "employees_search", input: { query: "남궁솔" } },
            { type: "tool-output-available", toolCallId: "c1", output: { kind: "none" }, preliminary: true },
            { type: "tool-output-available", toolCallId: "c1", output: { kind: "entity" } },
        ];
        const turn = assembleAgentTurn(events, manifestCapabilities);
        expect(turn.toolCalls).toHaveLength(1);
        // preliminary output is superseded — only the last output is kept.
        expect(turn.toolCalls[0]?.output).toEqual({ kind: "entity" });
    });

    it("treats tool-output-error and tool-output-denied as their own statuses", () => {
        const events: RawStreamEvent[] = [
            { type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: {} },
            { type: "tool-output-error", toolCallId: "c1", errorText: "boom" },
            { type: "tool-input-available", toolCallId: "c2", toolName: "clients_update", input: {} },
            { type: "tool-output-denied", toolCallId: "c2" },
        ];
        const turn = assembleAgentTurn(events, manifestCapabilities);
        const byId = Object.fromEntries(turn.toolCalls.map((call) => [call.toolCallId, call]));
        expect(byId["c1"]?.outputStatus).toBe("error");
        expect(turn.errors).toContain("boom");
        expect(byId["c2"]?.outputStatus).toBe("denied");
    });

    it("collects a data-action-proposal as a proposal", () => {
        const events: RawStreamEvent[] = [
            { type: "data-action-proposal", data: { actionId: "a1", capability: "clients.update" } },
        ];
        const turn = assembleAgentTurn(events, manifestCapabilities);
        expect(turn.proposals).toEqual([
            { source: "action-proposal", capability: "clients.update", taskState: null, raw: { actionId: "a1", capability: "clients.update" } },
        ]);
    });

    it("collects a data-task-snapshot in review_ready/awaiting_approval as a proposal, but not in collecting", () => {
        const reviewReady = assembleAgentTurn(
            [{ type: "data-task-snapshot", data: { taskId: "t1", state: "review_ready", capabilityId: "clients.update" } }],
            manifestCapabilities,
        );
        expect(reviewReady.proposals).toHaveLength(1);
        expect(reviewReady.proposals[0]?.source).toBe("task-snapshot");
        expect(reviewReady.proposals[0]?.taskState).toBe("review_ready");

        const awaitingApproval = assembleAgentTurn(
            [{ type: "data-task-snapshot", data: { taskId: "t1", state: "awaiting_approval" } }],
            manifestCapabilities,
        );
        expect(awaitingApproval.proposals).toHaveLength(1);

        const collecting = assembleAgentTurn(
            [{ type: "data-task-snapshot", data: { taskId: "t1", state: "collecting" } }],
            manifestCapabilities,
        );
        expect(collecting.proposals).toHaveLength(0);
        expect(collecting.taskSnapshotStates).toEqual(["collecting"]);
    });

    it("counts data-form, data-entity-choice, and data-entity-select as structured clarification signals", () => {
        const turn = assembleAgentTurn(
            [
                { type: "data-form", data: {} },
                { type: "data-entity-choice", data: {} },
                { type: "data-entity-select", data: {} },
            ],
            manifestCapabilities,
        );
        expect(turn.formRequestCount).toBe(1);
        expect(turn.entityChoiceCount).toBe(1);
        expect(turn.entitySelectCount).toBe(1);
    });

    it("flags reasoning chunks and collects both error and data-error", () => {
        const turn = assembleAgentTurn(
            [
                { type: "reasoning-start", id: "r1" },
                { type: "reasoning-delta", id: "r1", delta: "thinking" },
                { type: "error", errorText: "stream failed" },
                { type: "data-error", data: { message: "structured error" } },
            ],
            manifestCapabilities,
        );
        expect(turn.hasReasoning).toBe(true);
        expect(turn.errors).toEqual(["stream failed", "structured error"]);
    });

    it("mapToolNameToCapability keeps unmapped names raw", () => {
        expect(mapToolNameToCapability("clients_search", manifestCapabilities)).toBe("clients.search");
        expect(mapToolNameToCapability("totally_unknown", manifestCapabilities)).toBe("totally_unknown");
    });
});

describe("assembleLegacyTurn", () => {
    it("assembles chunk content, tool names, confirmation, and the done session id", () => {
        const events: RawStreamEvent[] = [
            { type: "chunk", content: "안" },
            { type: "chunk", content: "녕" },
            { type: "tool_call", toolName: "getDashboardStats", toolStatus: "executing" },
            { type: "done", sessionId: "legacy-session-1" },
        ];
        const turn = assembleLegacyTurn(events);
        expect(turn.finalText).toBe("안녕");
        expect(turn.toolNames).toEqual(["getDashboardStats"]);
        expect(turn.sessionId).toBe("legacy-session-1");
        expect(turn.legacyConfirmation).toBeNull();
    });

    it("records a confirmation chunk as legacyConfirmation and still reads the done sessionId", () => {
        const events: RawStreamEvent[] = [
            { type: "chunk", content: "산모 주소를 변경할게요." },
            {
                type: "confirmation",
                confirmationMessage: '"네"라고 답해주시면 진행할게요.',
                confirmationIntentId: "intent-1",
            },
            { type: "done", sessionId: "legacy-session-2" },
        ];
        const turn = assembleLegacyTurn(events);
        expect(turn.legacyConfirmation).toEqual({
            confirmationMessage: '"네"라고 답해주시면 진행할게요.',
            confirmationIntentId: "intent-1",
        });
        expect(turn.sessionId).toBe("legacy-session-2");
    });

    it("records an error chunk", () => {
        const turn = assembleLegacyTurn([{ type: "error", error: "대화를 처리하는 중 문제가 발생했어요." }]);
        expect(turn.errors).toEqual(["대화를 처리하는 중 문제가 발생했어요."]);
    });
});

describe("heuristicHasQuestion", () => {
    it.each([
        // --- existing cases (must keep passing) ---
        ["산모 이름이 뭔가요?", true],
        ["이 산모가 맞는 산모인가요", true],
        ["새 전화번호를 알려주세요", true],
        ["언제 끝나나요?", true],
        ["도하린 산모는 서구에 거주해요.", false],
        ["", false],
        ["   ", false],

        // --- new true cases: one per asking ending ---
        ["오늘 방문하실 예정이신가요?", true], // literal "?"
        ["언제 오실 수 있을까요", true], // 까요
        ["담당자가 누구였나요", true], // 나요
        ["이 산모가 맞는 산모인가요", true], // 인가요
        ["오늘이 상담일은가요", true], // 은가요
        ["이게 맞는 서류는가요", true], // 는가요
        ["예전에도 그랬던가요", true], // 던가요
        ["같이 확인할래요", true], // 할래요
        ["이거 먼저 먹을래요", true], // 을래요
        ["연락처를 알려주세요", true], // 주세요
        ["새 주소를 알려 주시겠어요", true], // 주시겠어요
        ["같이 확인해 주실래요", true], // 주실래요
        ["예약 시간이 맞는지요", true], // 는지요
        ["담당자가 누구인지요", true], // 인지요
        ["새 전화번호를 알려 주시겠습니까", true], // 습니까
        ["오늘 방문이 됩니까", true], // ㅂ니까 스타일 (됩니까)
        ["지금 확인 가능합니까", true], // ㅂ니까 스타일 (합니까)

        // trailing period after an asking ending must still count
        ["새 주소를 알려 주시겠어요.", true],
        ["담당자님 성함을 여쭤봐도 될까요.", true],

        // question followed by a short trailing line in the same paragraph
        ["새 전화번호가 필요해요. 알려주시겠어요?\n감사합니다!", true],
        ["오늘 방문 예정이신가요?\n확인 부탁드려요", true],

        // --- new false cases ---
        ["확인했습니다.", false],
        ["확인했으니까.", false], // bare 니까 (no ㅂ 받침 앞말) must NOT count
        ["내일 가요.", false], // bare 가요 must NOT count
        ["하래요.", false], // bare 래요 (전달/인용) must NOT count
        ["질문: \"언제 오시나요?\"\n\n네, 알겠습니다. 확인 후 안내드리겠습니다.", false], // "?" only in an earlier paragraph
        ["| 항목 | 값 |\n| --- | --- |\n| 이름 | 홍길동 |", false], // table-only answer, no question
    ])("%s -> %s", (text, expected) => {
        expect(heuristicHasQuestion(text)).toBe(expected);
    });
});

describe("evaluateChecks", () => {
    const manifestCapabilities = new Set(["clients.search", "employees.search", "clients.update"]);

    function agentFacts(events: RawStreamEvent[]) {
        return deterministicFactsFromAgentTurn(assembleAgentTurn(events, manifestCapabilities));
    }

    it("expectToolsAnyOf passes/fails based on capabilities used", () => {
        const used = agentFacts([{ type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: { query: "도하린" } }]);
        expect(evaluateChecks({ expectToolsAnyOf: ["clients.search"] }, used)).toEqual({ expectToolsAnyOf: "pass" });
        expect(evaluateChecks({ expectToolsAnyOf: ["employees.search"] }, used)).toEqual({ expectToolsAnyOf: "fail" });
    });

    it("forbidToolsAnyOf fails when a forbidden capability is used", () => {
        const used = agentFacts([{ type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: {} }]);
        expect(evaluateChecks({ forbidToolsAnyOf: ["clients.search"] }, used)).toEqual({ forbidToolsAnyOf: "fail" });
        expect(evaluateChecks({ forbidToolsAnyOf: ["employees.search"] }, used)).toEqual({ forbidToolsAnyOf: "pass" });
    });

    it("expectNoTools passes only when no tool was called", () => {
        const none = agentFacts([]);
        const used = agentFacts([{ type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: {} }]);
        expect(evaluateChecks({ expectNoTools: true }, none)).toEqual({ expectNoTools: "pass" });
        expect(evaluateChecks({ expectNoTools: true }, used)).toEqual({ expectNoTools: "fail" });
    });

    it("forbidSearchQueries fails on an exact forbidden query, passes otherwise", () => {
        const literal = agentFacts([{ type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: { query: "산모" } }]);
        const specific = agentFacts([{ type: "tool-input-available", toolCallId: "c1", toolName: "clients_search", input: { query: "도하린" } }]);
        expect(evaluateChecks({ forbidSearchQueries: ["산모"] }, literal)).toEqual({ forbidSearchQueries: "fail" });
        expect(evaluateChecks({ forbidSearchQueries: ["산모"] }, specific)).toEqual({ forbidSearchQueries: "pass" });
    });

    it("expectQuestion passes on the text heuristic or a structured clarification", () => {
        const textQuestion = agentFacts([{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "어느 산모를 말씀하시는 건가요?" }]);
        const structured = agentFacts([{ type: "data-entity-choice", data: {} }]);
        const neither = agentFacts([{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "도하린 산모는 서구에 거주해요." }]);
        expect(evaluateChecks({ expectQuestion: true }, textQuestion)).toEqual({ expectQuestion: "pass" });
        expect(evaluateChecks({ expectQuestion: true }, structured)).toEqual({ expectQuestion: "pass" });
        expect(evaluateChecks({ expectQuestion: true }, neither)).toEqual({ expectQuestion: "fail" });
    });

    it("expectProposal passes on an action-proposal or an approval-state task-snapshot", () => {
        const proposal = agentFacts([{ type: "data-action-proposal", data: { capability: "clients.update" } }]);
        const taskSnapshot = agentFacts([{ type: "data-task-snapshot", data: { state: "review_ready" } }]);
        const neither = agentFacts([]);
        expect(evaluateChecks({ expectProposal: true }, proposal)).toEqual({ expectProposal: "pass" });
        expect(evaluateChecks({ expectProposal: true }, taskSnapshot)).toEqual({ expectProposal: "pass" });
        expect(evaluateChecks({ expectProposal: true }, neither)).toEqual({ expectProposal: "fail" });
    });

    it("forbidChatConfirmation fails only when the pattern appears AND no proposal was emitted", () => {
        const patternNoProposal = agentFacts([{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "진행할까요?" }]);
        const patternWithProposal = {
            ...agentFacts([{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "진행할까요?" }]),
            proposalPresent: true,
        };
        const clean = agentFacts([{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "완료했어요." }]);
        expect(evaluateChecks({ forbidChatConfirmation: true }, patternNoProposal)).toEqual({ forbidChatConfirmation: "fail" });
        expect(evaluateChecks({ forbidChatConfirmation: true }, patternWithProposal)).toEqual({ forbidChatConfirmation: "pass" });
        expect(evaluateChecks({ forbidChatConfirmation: true }, clean)).toEqual({ forbidChatConfirmation: "pass" });
    });

    it("marks every capability-based and proposal-based check n/a for the legacy target", () => {
        const legacyFacts = deterministicFactsFromLegacyTurn(assembleLegacyTurn([{ type: "chunk", content: "완료했어요" }]));
        const checks = {
            expectToolsAnyOf: ["clients.search"],
            forbidToolsAnyOf: ["clients.search"],
            forbidSearchQueries: ["산모"],
            expectNoTools: true as const,
            expectProposal: true as const,
            forbidChatConfirmation: true as const,
        };
        expect(evaluateChecks(checks, legacyFacts)).toEqual({
            expectToolsAnyOf: "n/a",
            forbidToolsAnyOf: "n/a",
            forbidSearchQueries: "n/a",
            expectNoTools: "n/a",
            expectProposal: "n/a",
            forbidChatConfirmation: "n/a",
        });
    });

    it("expectQuestion still evaluates on the legacy target via the text heuristic", () => {
        const legacyFacts = deterministicFactsFromLegacyTurn(assembleLegacyTurn([{ type: "chunk", content: "새 번호가 무엇인가요?" }]));
        expect(evaluateChecks({ expectQuestion: true }, legacyFacts)).toEqual({ expectQuestion: "pass" });
    });

    it("transportFailureCheckResults marks every declared check as fail, never n/a", () => {
        const checks = { expectToolsAnyOf: ["clients.search"], expectQuestion: true as const };
        expect(transportFailureCheckResults(checks)).toEqual({ expectToolsAnyOf: "fail", expectQuestion: "fail" });
    });

    it("emptyDeterministicFacts gives an agent target an empty (non-null) capability list", () => {
        expect(emptyDeterministicFacts("agent").capabilitiesUsed).toEqual([]);
        expect(emptyDeterministicFacts("legacy").capabilitiesUsed).toBeNull();
    });
});

describe("scenario/suite orchestration with a stubbed transport and judge", () => {
    const manifestCapabilities = new Set(["clients.search"]);
    const noopSleep = async () => undefined;

    function agentSseBody(text: string, headerSessionId = "session-1"): { body: string; headers: { get(name: string): string | null } } {
        const body = [
            'data: {"type":"text-start","id":"1"}',
            `data: {"type":"text-delta","id":"1","delta":${JSON.stringify(text)}}`,
            'data: {"type":"text-end","id":"1"}',
            "data: [DONE]",
        ].join("\n");
        return { body, headers: { get: (name: string) => (name.toLowerCase() === "x-agent-session-id" ? headerSessionId : null) } };
    }

    it("runs a single-turn scenario against a stubbed agent endpoint end to end", async () => {
        const fetchImpl: FetchLike = async (url) => {
            expect(url).toBe("http://127.0.0.1:3001/ai/agent/chat");
            const { body, headers } = agentSseBody("도하린 산모는 서구에 거주해요.");
            return fakeResponse({ body, headers });
        };
        const result = await runScenario({
            scenario: scenario({ checks: { expectNoTools: true } }),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "test-token",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: noopSleep,
            judgeCall: async () => JUDGE_SCORE,
        });
        expect(result.hadTransportError).toBe(false);
        expect(result.judge).toEqual(JUDGE_SCORE);
        expect(result.checkResults).toEqual({ expectNoTools: "pass" });
        expect(result.turns).toHaveLength(1);
    });

    it("carries the session id from turn to turn (agent target)", async () => {
        const seenSessionIds: Array<string | undefined> = [];
        const fetchImpl: FetchLike = async (_url, init) => {
            const parsed = JSON.parse(init.body) as { sessionId?: string };
            seenSessionIds.push(parsed.sessionId);
            const { body, headers } = agentSseBody("응답", "session-carry");
            return fakeResponse({ body, headers });
        };
        await runScenario({
            scenario: scenario({ turns: ["첫 턴", "두번째 턴"] }),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "t",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: noopSleep,
            judgeCall: async () => JUDGE_SCORE,
        });
        expect(seenSessionIds).toEqual([undefined, "session-carry"]);
    });

    it("stops the scenario and records a transport error on a non-2xx response", async () => {
        const fetchImpl: FetchLike = async () => fakeResponse({ ok: false, status: 500, body: JSON.stringify({ code: "INTERNAL_ERROR" }) });
        const result = await runScenario({
            scenario: scenario({ checks: { expectToolsAnyOf: ["clients.search"] } }),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "t",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: noopSleep,
            judgeCall: async () => JUDGE_SCORE,
        });
        expect(result.hadTransportError).toBe(true);
        expect(result.turns[0]?.transportError).toEqual({ status: 500, code: "INTERNAL_ERROR", message: "Transport error: HTTP 500" });
        expect(result.checkResults).toEqual({ expectToolsAnyOf: "fail" });
        expect(result.judge).toEqual({ intent: 0, depth: 0, grounding: 0, format: 0, rationale: expect.any(String) });
        expect(result.judgeError).toBeNull();
    });

    it("retries a 429 with the Retry-After header before succeeding", async () => {
        let calls = 0;
        const sleeps: number[] = [];
        const fetchImpl: FetchLike = async () => {
            calls += 1;
            if (calls === 1) {
                return fakeResponse({ ok: false, status: 429, body: "", headers: { get: (name) => (name === "retry-after" ? "2" : null) } });
            }
            const { body, headers } = agentSseBody("응답");
            return fakeResponse({ body, headers });
        };
        const result = await runScenario({
            scenario: scenario(),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "t",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: async (ms) => { sleeps.push(ms); },
            judgeCall: async () => JUDGE_SCORE,
        });
        expect(calls).toBe(2);
        expect(sleeps).toEqual([2000]);
        expect(result.hadTransportError).toBe(false);
    });

    it("records judgeError when every judge attempt fails, without forcing a zero score", async () => {
        const fetchImpl: FetchLike = async () => {
            const { body, headers } = agentSseBody("응답");
            return fakeResponse({ body, headers });
        };
        const result = await runScenario({
            scenario: scenario(),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "t",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: noopSleep,
            judgeCall: async () => { throw new Error("judge down"); },
        });
        expect(result.judge).toBeNull();
        expect(result.judgeError).not.toBeNull();
    });

    it("selectScenarios excludes write-category scenarios for the legacy target only", () => {
        const scenarios = [scenario({ id: "a", category: "write" }), scenario({ id: "b", category: "lookup" })];
        expect(selectScenarios(scenarios, "agent").map((s) => s.id)).toEqual(["a", "b"]);
        expect(selectScenarios(scenarios, "legacy").map((s) => s.id)).toEqual(["b"]);
    });

    it("selectScenarios filters by --only", () => {
        const scenarios = [scenario({ id: "a" }), scenario({ id: "b" }), scenario({ id: "c" })];
        expect(selectScenarios(scenarios, "agent", ["a", "c"]).map((s) => s.id)).toEqual(["a", "c"]);
    });

    it("runSuite runs every selected scenario and respects concurrency without dropping results", async () => {
        const scenarios = [scenario({ id: "a" }), scenario({ id: "b" }), scenario({ id: "c" })];
        const fetchImpl: FetchLike = async () => {
            const { body, headers } = agentSseBody("응답");
            return fakeResponse({ body, headers });
        };
        const results = await runSuite({
            scenarios,
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken: () => "t",
            manifestCapabilities,
            fetchImpl,
            sleepImpl: noopSleep,
            judgeCall: async () => JUDGE_SCORE,
            concurrency: 2,
        });
        expect(results.map((r) => r.scenarioId)).toEqual(["a", "b", "c"]);
    });
});

describe("aggregateResults", () => {
    function resultWith(overrides: Partial<ScenarioRunResult>): ScenarioRunResult {
        return {
            scenarioId: "s",
            category: "lookup",
            target: "agent",
            turns: [{ userText: "u", latencyMs: 100, assistantText: "a", transportError: null, agent: null, legacy: null, rateLimitRetries: 0 }],
            checkResults: { expectNoTools: "pass" },
            judge: JUDGE_SCORE,
            judgeError: null,
            hadTransportError: false,
            ...overrides,
        };
    }

    it("computes overall and per-category judge means, excluding judgeError scenarios", () => {
        const results: ScenarioRunResult[] = [
            resultWith({ scenarioId: "a", category: "lookup", judge: { intent: 2, depth: 2, grounding: 2, format: 1, rationale: "x" } }),
            resultWith({ scenarioId: "b", category: "lookup", judge: { intent: 0, depth: 0, grounding: 0, format: 0, rationale: "x" } }),
            resultWith({ scenarioId: "c", category: "vague", judge: null, judgeError: "boom" }),
        ];
        const aggregate = aggregateResults(results);
        expect(aggregate.overall.intent).toBe(1); // mean of 2 and 0; the judgeError scenario is excluded
        expect(aggregate.byCategory["lookup"]?.intent).toBe(1);
        expect(aggregate.byCategory["vague"]?.intent).toBeNull();
        expect(aggregate.judgeErrorCount).toBe(1);
        expect(aggregate.judgedScenarioCount).toBe(2);
        expect(aggregate.totalScenarioCount).toBe(3);
    });

    it("includes a transport-error scenario's forced zero judge score in the means (never excluded)", () => {
        const results: ScenarioRunResult[] = [
            resultWith({ scenarioId: "a", judge: { intent: 2, depth: 2, grounding: 2, format: 1, rationale: "x" } }),
            resultWith({
                scenarioId: "b",
                hadTransportError: true,
                checkResults: { expectNoTools: "fail" },
                judge: { intent: 0, depth: 0, grounding: 0, format: 0, rationale: "transport" },
            }),
        ];
        const aggregate = aggregateResults(results);
        expect(aggregate.overall.intent).toBe(1);
        expect(aggregate.transportErrorCount).toBe(1);
        expect(aggregate.judgedScenarioCount).toBe(2);
    });

    it("computes the deterministic pass rate over pass+fail, excluding n/a", () => {
        const results: ScenarioRunResult[] = [
            resultWith({ checkResults: { expectNoTools: "pass", expectQuestion: "n/a" } }),
            resultWith({ checkResults: { expectNoTools: "fail" } }),
        ];
        const aggregate = aggregateResults(results);
        expect(aggregate.deterministicPassRate).toBe(0.5);
        expect(aggregate.deterministicNaCount).toBe(1);
    });

    it("computes p50/p95 turn latency over every turn across every scenario", () => {
        const results: ScenarioRunResult[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((ms) =>
            resultWith({ turns: [{ userText: "u", latencyMs: ms * 10, assistantText: "a", transportError: null, agent: null, legacy: null, rateLimitRetries: 0 }] }));
        const aggregate = aggregateResults(results);
        expect(aggregate.turnLatencyP50).toBe(50);
        expect(aggregate.turnLatencyP95).toBe(100);
    });

    it("returns null means and null pass rate for an empty result set", () => {
        const aggregate = aggregateResults([]);
        expect(aggregate.overall).toEqual({ intent: null, depth: null, grounding: null, format: null });
        expect(aggregate.deterministicPassRate).toBeNull();
        expect(aggregate.turnLatencyP50).toBeNull();
    });
});

describe("report rendering", () => {
    function makeReport(overrides: Partial<RunReport> = {}): RunReport {
        const results: ScenarioRunResult[] = [
            {
                scenarioId: "lookup-1",
                category: "lookup",
                target: "agent",
                turns: [{ userText: "도하린 산모 정보 보여줘", latencyMs: 120, assistantText: "도하린 산모는 서구에 거주해요.", transportError: null, agent: null, legacy: null, rateLimitRetries: 0 }],
                checkResults: { expectToolsAnyOf: "pass" },
                judge: JUDGE_SCORE,
                judgeError: null,
                hadTransportError: false,
            },
        ];
        return buildRunReport({
            target: "agent",
            label: "baseline",
            judgeModel: "gemini-3.5-flash",
            scenarioVersion: "v1",
            gitSha: "abc123",
            now: () => new Date("2026-09-24T00:00:00.000Z"),
            results,
            ...overrides,
        });
    }

    it("renders a markdown transcript with aggregate, per-category, and per-scenario sections", () => {
        const markdown = renderMarkdownTranscript(makeReport());
        expect(markdown).toContain("# Chat quality report — baseline (agent)");
        expect(markdown).toContain("## Aggregate");
        expect(markdown).toContain("## Per category");
        expect(markdown).toContain("### lookup-1 (lookup)");
        expect(markdown).toContain("도하린 산모는 서구에 거주해요.");
    });

    it("renders a compare table across two or more reports with per-scenario previews", () => {
        const a: ComparisonInput = { label: "agent-run", report: makeReport({ label: "agent-run" }) };
        const b: ComparisonInput = { label: "legacy-run", report: makeReport({ label: "legacy-run", target: "legacy" }) };
        const table = renderCompareMarkdown([a, b]);
        expect(table).toContain("# Chat quality comparison: agent-run vs legacy-run");
        expect(table).toContain("| lookup-1 |");
        expect(table).toContain("I2/D2/G2/F1");
    });

    it("computeIntersectionMeans only averages scenarios judged in every compared run", () => {
        const a: ComparisonInput = { label: "a", report: makeReport({ label: "a" }) };
        const bResults: ScenarioRunResult[] = [
            {
                scenarioId: "lookup-1",
                category: "lookup",
                target: "legacy",
                turns: [],
                checkResults: {},
                judge: null,
                judgeError: "boom",
                hadTransportError: false,
            },
        ];
        const b: ComparisonInput = { label: "b", report: makeReport({ label: "b", target: "legacy", results: bResults }) };
        const means = computeIntersectionMeans([a, b]);
        // "lookup-1" was judged in "a" but not in "b", so the intersection is empty.
        expect(means["a"]).toEqual({ intent: null, depth: null, grounding: null, format: null });
        expect(means["b"]).toEqual({ intent: null, depth: null, grounding: null, format: null });
    });
});

describe("validateLoopbackBaseUrl", () => {
    it("allows 127.0.0.1, localhost, and the IPv6 loopback literal", () => {
        expect(() => validateLoopbackBaseUrl("http://127.0.0.1:3001")).not.toThrow();
        expect(() => validateLoopbackBaseUrl("http://localhost:3001")).not.toThrow();
        expect(() => validateLoopbackBaseUrl("http://[::1]:3001")).not.toThrow();
    });

    it("rejects a lookalike hostname that merely contains 127.0.0.1", () => {
        expect(() => validateLoopbackBaseUrl("http://127.0.0.1.evil.com")).toThrow(LoopbackGuardError);
    });

    it("rejects embedded credentials even when the host part is evil", () => {
        expect(() => validateLoopbackBaseUrl("http://localhost@evil.com")).toThrow(LoopbackGuardError);
    });

    it("rejects a non-http(s) protocol", () => {
        expect(() => validateLoopbackBaseUrl("ftp://localhost")).toThrow(LoopbackGuardError);
    });

    it("rejects an unparsable URL", () => {
        expect(() => validateLoopbackBaseUrl("not a url")).toThrow(LoopbackGuardError);
    });
});

describe("run-chat-quality-eval CLI arg parsing", () => {
    it("parses a run invocation with defaults", () => {
        const args = parseCliArgs(["--target=agent", "--label=baseline", "--output=/tmp/out.json"]);
        expect(args).toMatchObject({ mode: "run", target: "agent", label: "baseline", output: "/tmp/out.json" });
    });

    it("parses --compare into a list of report paths", () => {
        const args = parseCliArgs(["--compare=/tmp/a.json,/tmp/b.json"]);
        expect(args).toEqual({ mode: "compare", inputs: ["/tmp/a.json", "/tmp/b.json"] });
    });

    it("--help returns the help mode without requiring other flags", () => {
        expect(parseCliArgs(["--help"])).toEqual({ mode: "help" });
    });

    it("rejects a run invocation missing --target", () => {
        expect(() => parseCliArgs(["--label=x", "--output=/tmp/out.json"])).toThrow();
    });

    it("USAGE documents the loopback guard, the judge model fallback, and the PII warning", () => {
        expect(USAGE).toContain("127.0.0.1/localhost/::1");
        expect(USAGE).toContain("gemini-2.5-flash");
        expect(USAGE).toContain("$TMPDIR");
    });

    it("USAGE documents --token-file / AGENT_EVAL_TOKEN_FILE", () => {
        expect(USAGE).toContain("--token-file");
        expect(USAGE).toContain("AGENT_EVAL_TOKEN_FILE");
    });
});

describe("buildTokenProvider (--token-file / AGENT_EVAL_TOKEN_FILE)", () => {
    it("falls back to a fixed AGENT_EVAL_TOKEN when no token file is given", async () => {
        const getToken = buildTokenProvider(undefined, { AGENT_EVAL_TOKEN: "static-token" });
        expect(await getToken()).toBe("static-token");
        expect(await getToken()).toBe("static-token");
    });

    it("throws before returning a provider when the token file is empty at startup (fail loud, E6)", () => {
        expect(() => buildTokenProvider("/tmp/token.txt", {}, () => "   ")).toThrow(/empty/);
    });

    it("throws when neither a token file nor AGENT_EVAL_TOKEN is configured", () => {
        expect(() => buildTokenProvider(undefined, {})).toThrow(/AGENT_EVAL_TOKEN/);
    });

    it("re-reads and trims the token file on every call, so two consecutive requests pick up a changed file", async () => {
        // Index 0 is consumed immediately by buildTokenProvider's own
        // fail-loud startup probe read; indices 1 and 2 are the two
        // "consecutive requests" this token provider services.
        const fileContents = ["startup-token\n", "  request-1-token  \n", "request-2-token"];
        let callIndex = 0;
        const readFile = (path: string): string => {
            expect(path).toBe("/tmp/token.txt");
            const value = fileContents[callIndex];
            callIndex += 1;
            if (value === undefined) throw new Error("unexpected extra read");
            return value;
        };
        const getToken = buildTokenProvider("/tmp/token.txt", {}, readFile);
        expect(callIndex).toBe(1); // the startup probe already ran
        const firstRequestToken = await getToken();
        const secondRequestToken = await getToken();
        expect(firstRequestToken).toBe("request-1-token");
        expect(secondRequestToken).toBe("request-2-token");
        expect(callIndex).toBe(3);
    });

    it("prefers an explicit --token-file over AGENT_EVAL_TOKEN_FILE", async () => {
        const readFile = (path: string): string => (path === "/tmp/explicit.txt" ? "explicit-token" : "env-token");
        const getToken = buildTokenProvider("/tmp/explicit.txt", { AGENT_EVAL_TOKEN_FILE: "/tmp/env.txt" }, readFile);
        expect(await getToken()).toBe("explicit-token");
    });

    it("falls back to AGENT_EVAL_TOKEN_FILE when --token-file is not given", async () => {
        const readFile = () => "from-env-file";
        const getToken = buildTokenProvider(undefined, { AGENT_EVAL_TOKEN_FILE: "/tmp/env.txt" }, readFile);
        expect(await getToken()).toBe("from-env-file");
    });
});

describe("runScenario re-resolves the token via getToken before every HTTP request", () => {
    it("sends the updated token on the second turn after the token file changes between requests", async () => {
        const manifestCapabilities = new Set(["clients.search"]);
        const tokens = ["token-v1", "token-v2"];
        let tokenCallCount = 0;
        const getToken = () => {
            const value = tokens[tokenCallCount] ?? tokens[tokens.length - 1] ?? "";
            tokenCallCount += 1;
            return value;
        };
        const seenAuthHeaders: string[] = [];
        const fetchImpl: FetchLike = async (_url, init) => {
            seenAuthHeaders.push(init.headers["authorization"] ?? "");
            const body = [
                'data: {"type":"text-start","id":"1"}',
                'data: {"type":"text-delta","id":"1","delta":"응답"}',
                "data: [DONE]",
            ].join("\n");
            return fakeResponse({ body, headers: { get: () => "session-1" } });
        };
        await runScenario({
            scenario: scenario({ turns: ["첫 턴", "두번째 턴"] }),
            target: "agent",
            baseUrl: "http://127.0.0.1:3001",
            getToken,
            manifestCapabilities,
            fetchImpl,
            sleepImpl: async () => undefined,
            judgeCall: async () => JUDGE_SCORE,
        });
        expect(seenAuthHeaders).toEqual(["Bearer token-v1", "Bearer token-v2"]);
    });
});
