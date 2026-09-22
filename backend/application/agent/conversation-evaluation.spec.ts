import {
    CONVERSATION_ASSERTION_DIGEST,
    CONVERSATION_DEVELOPMENT_CASES,
    CONVERSATION_EVAL_CASES,
    CONVERSATION_EVAL_DIGEST,
    CONVERSATION_HOLDOUT_CASES,
} from "../../../evals/conversation/cases";
import {
    assertConversationFixtureIntegrity,
    createDeterministicClock,
    evaluateConversationCase,
} from "../../../evals/conversation/evaluation-policy";
import {
    classifyConversationCase,
    conversationEvaluationExitCode,
    formatConversationEvaluationReport,
    parseConversationEvaluationArgs,
    runConversationEvaluation,
} from "../../../evals/conversation/run-evaluation";
import {
    assertProductDisposableE2eGuard,
    formatProductDisposableE2eReport,
    resolveProductDisposableE2eStatus,
} from "../../../evals/conversation/product-disposable-e2e";
import { createHarnessValidationAdapter, createNoNetworkMockTransport } from "../../../evals/conversation/mock-transport";

async function harnessObservation(caseIndex: number) {
    const scenario = CONVERSATION_EVAL_CASES[caseIndex]!;
    const adapter = createHarnessValidationAdapter();
    const transport = createNoNetworkMockTransport();
    const observation = await adapter.run({ case: scenario, clock: createDeterministicClock(), transport });
    return { scenario, observation, adapter, transport };
}

describe("deterministic multi-turn conversation evaluation foundation", () => {
    it("contains 48 distinct multi-turn fixtures with a disjoint development/holdout split", () => {
        expect(CONVERSATION_EVAL_CASES).toHaveLength(48);
        expect(CONVERSATION_DEVELOPMENT_CASES).toHaveLength(32);
        expect(CONVERSATION_HOLDOUT_CASES).toHaveLength(16);
        expect(new Set(CONVERSATION_EVAL_CASES.map((item) => item.id)).size).toBe(48);
        expect(new Set(CONVERSATION_EVAL_CASES.map((item) => item.digest)).size).toBe(48);
        expect(new Set(CONVERSATION_EVAL_CASES.map((item) => item.family)).size).toBe(12);
        expect(new Set(CONVERSATION_EVAL_CASES.map((item) => item.turns.map((turn) => turn.userText).join("\n"))).size).toBe(48);
        for (const item of CONVERSATION_EVAL_CASES) {
            expect(item.fixtureVersion).toBe("conversation-eval-v1");
            expect(item.deterministicClock).toBe("2026-01-15T09:00:00.000Z");
            expect(item.turns.length).toBeGreaterThanOrEqual(2);
            expect(item.syntheticTokens.every((token) => token.startsWith("SYN_"))).toBe(true);
        }
        expect(CONVERSATION_EVAL_CASES.map((item) => item.family)).toEqual(expect.arrayContaining([
            "mixed-facts-question", "followup-correction-date-intent", "required-minimal-registration",
            "pause-other-lookup-resume", "explicit-clear-omission", "target-choices", "auth-denial",
            "stale-approval-races-retries", "unknown-results", "consent-no-changed-impact", "retention", "reload",
        ]));
        expect(CONVERSATION_EVAL_DIGEST).toMatch(/^[a-f0-9]{64}$/);
        expect(CONVERSATION_ASSERTION_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    });

    it("fails fixture integrity closed when the inventory is changed", () => {
        expect(() => assertConversationFixtureIntegrity(CONVERSATION_EVAL_CASES.slice(0, 47))).toThrow("48");
    });

    it("passes valid structured observations while using no network transport", async () => {
        const transport = createNoNetworkMockTransport();
        const adapter = createHarnessValidationAdapter();
        const summary = await runConversationEvaluation({ adapter, transport });

        expect(summary.status).toBe("passed");
        expect(summary.counts).toEqual({ total: 48, passed: 48, failed: 0, notEvaluated: 0 });
        expect(summary.safetyErrors).toHaveLength(0);
        expect(transport.networkCalls).toBe(0);
        expect(transport.calls).toBe(0);
        const report = formatConversationEvaluationReport({ summary, adapter, transport });
        expect(report).toContain("Deterministic harness validation");
        expect(report).toContain("real product/model quality not evaluated");
        expect(report).toContain("cases: 48 (development 32, holdout 16)");
        expect(report).toContain("network calls: 0");
        expect(report).toContain(CONVERSATION_EVAL_DIGEST);
        expect(report).toContain(CONVERSATION_ASSERTION_DIGEST);
    });

    it("uses a nonzero command exit only for failed supplied evidence", () => {
        expect(conversationEvaluationExitCode("passed")).toBe(0);
        expect(conversationEvaluationExitCode("not_evaluated")).toBe(0);
        expect(conversationEvaluationExitCode("failed")).toBe(1);
    });

    it("keeps the default product CLI separate from the explicit disposable AppModule lane", () => {
        expect(parseConversationEvaluationArgs([])).toEqual({ product: false, productChild: false, productDisposableE2e: false });
        expect(parseConversationEvaluationArgs(["--product"])).toEqual({ product: true, productChild: false, productDisposableE2e: false });
        expect(parseConversationEvaluationArgs(["--product", "--product-child"])).toEqual({ product: true, productChild: true, productDisposableE2e: false });
        expect(parseConversationEvaluationArgs(["--product", "--product-disposable-e2e", "--product-child"])).toEqual({ product: true, productChild: true, productDisposableE2e: true });
        expect(() => parseConversationEvaluationArgs(["--product-disposable-e2e"])).toThrow("requires --product");
    });

    it("fails closed before AppModule import unless all disposable guards match", () => {
        const approved = {
            AGENT_E2E: "1",
            E2E_VENDOR_STUBS: "1",
            SCHEDULER_LEASE_MODE: "off",
            DATABASE_URL: "postgresql://bjj_test@127.0.0.1:55433/bjj_conversation_test",
            DIRECT_URL: "postgresql://bjj_test@127.0.0.1:55433/bjj_conversation_test",
        };
        expect(assertProductDisposableE2eGuard(approved)).toEqual({
            database: "bjj_conversation_test",
            vendorStubs: true,
            schedulerLease: "off",
        });
        expect(() => assertProductDisposableE2eGuard({ ...approved, E2E_VENDOR_STUBS: "0" })).toThrow("E2E_VENDOR_STUBS=1");
        expect(() => assertProductDisposableE2eGuard({ ...approved, DATABASE_URL: "postgresql://bjj_test@127.0.0.1:5432/production" })).toThrow("unsafe DATABASE_URL");
        expect(() => assertProductDisposableE2eGuard({ ...approved, DIRECT_URL: "postgresql://bjj_test@127.0.0.1:55433/other" })).toThrow("unsafe DIRECT_URL");
    });

    it("reports guarded evidence with aggregate fields only", () => {
        const report = formatProductDisposableE2eReport({
            status: "blocked",
            guard: { database: "bjj_conversation_test", vendorStubs: true, schedulerLease: "off" },
            customer: { create: "blocked", update: "blocked", rowsObserved: 0 },
            action: { proposed: 0, approved: 0, terminal: 0, succeeded: 0 },
            terminalAuthority: { records: 0, positiveOneJob: false, denyNoSendZeroSend: true },
            coverage: { intents: 0, jobs: 0, messageLogs: 0 },
            intent: { positive: "not_evaluated", deny: "not_evaluated", noSend: "zero" },
            providerCalls: 0,
            failure: "guarded_runtime_unavailable",
        });
        expect(report).toContain("Guarded disposable product AppModule evaluation");
        expect(report).toContain("provider calls: 0");
        expect(report).not.toContain("01000000041");
        expect(report).not.toContain("9a000000-0000-4000-8000-000000000041");
    });

    it("passes the disposable lane only with create, update, positive job, deny, and zero-send evidence", () => {
        const complete = {
            createStatus: "succeeded",
            updateStatus: "succeeded" as const,
            jobs: 1,
            messageLogs: 0,
            denyStatus: "succeeded",
        };
        expect(resolveProductDisposableE2eStatus(complete)).toBe("passed");

        const missingEvidence = [
            { ...complete, createStatus: "failed" },
            { ...complete, updateStatus: "blocked" as const },
            { ...complete, jobs: 0 },
            { ...complete, denyStatus: "blocked" },
            { ...complete, messageLogs: 2 },
        ];
        for (const outcome of missingEvidence) {
            expect(resolveProductDisposableE2eStatus(outcome)).toBe("blocked");
        }
    });

    it("does not let success prose pass when current state and structured evidence are absent", async () => {
        const { scenario } = await harnessObservation(0);
        const result = evaluateConversationCase(scenario, {
            completion: "completed",
            assistantMessages: [{ turnId: "t2", text: "성공적으로 처리했습니다." }],
        });

        expect(result.status).toBe("not_evaluated");
        expect(result.failures.some((failure) => failure.code === "missing_observation")).toBe(true);
    });

    it("treats a missing action ledger as not evaluated", async () => {
        const { scenario, observation } = await harnessObservation(8);
        const result = evaluateConversationCase(scenario, { ...observation, actionExecutionLedger: undefined });

        expect(result.status).toBe("not_evaluated");
        expect(result.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "missing_observation" }),
        ]));
    });

    it("fails when supplied state mismatches even if a future ledger is unavailable", async () => {
        const { scenario, observation } = await harnessObservation(8);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            currentState: {
                ...observation.currentState!,
                phase: "unexpected-state",
            },
            actionExecutionLedger: undefined,
        });

        expect(result.status).toBe("failed");
        expect(result.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "current_state_mismatch" }),
            expect.objectContaining({ code: "missing_observation" }),
        ]));
    });

    it("keeps a supplied ledger mismatch as a product defect beside missing evidence", async () => {
        const { scenario, observation } = await harnessObservation(29);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            actionExecutionLedger: [],
            sends: undefined,
        });
        const classification = classifyConversationCase(result, { mode: "product", run: async () => ({}) }, scenario);

        expect(result.status).toBe("failed");
        expect(result.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "ledger_mismatch" }),
            expect.objectContaining({ code: "missing_observation" }),
        ]));
        expect(classification.causes).toContain("product-defect");
    });

    it("labels an observed structural mismatch as a product defect in product mode", async () => {
        const { scenario, observation } = await harnessObservation(0);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            currentState: { ...observation.currentState!, phase: "unexpected-state" },
        });
        const classification = classifyConversationCase(result, { mode: "product", run: async () => ({}) }, scenario);

        expect(result.status).toBe("failed");
        expect(result.observed.structuredEvents).toBeGreaterThan(0);
        expect(result.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "current_state_mismatch" }),
        ]));
        expect(classification.causes).toContain("product-defect");
    });

    it("labels a structural mismatch as a product defect in harness mode", async () => {
        const { scenario, observation } = await harnessObservation(0);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            currentState: { ...observation.currentState!, phase: "unexpected-state" },
        });
        const classification = classifyConversationCase(result, { mode: "harness", run: async () => ({}) }, scenario);

        expect(result.status).toBe("failed");
        expect(result.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "current_state_mismatch" }),
        ]));
        expect(classification.causes).toContain("product-defect");
    });

    it("reports not_evaluated when only future-phase evidence is unavailable", async () => {
        const { scenario, observation } = await harnessObservation(8);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            actionExecutionLedger: undefined,
            sends: undefined,
            authorityOutcomes: undefined,
        });

        expect(result.status).toBe("not_evaluated");
        expect(result.failures.every((failure) => failure.code === "missing_observation")).toBe(true);
    });

    it("fails a no-consent send even when the assistant claims success", async () => {
        const { scenario, observation } = await harnessObservation(36);
        const result = evaluateConversationCase(scenario, {
            ...observation,
            completion: "completed",
            sends: [{ sendId: "SYN_SEND_C1", targetToken: "SYN_CLIENT_C1", status: "sent", consent: "missing", attempts: 1, observedAt: "2026-01-15T09:00:00.000Z" }],
            assistantMessages: [{ turnId: "t2", text: "전송했습니다." }],
        });

        expect(result.status).toBe("failed");
        expect(result.failures.some((failure) => failure.code === "no_consent_send")).toBe(true);
        expect(result.failures.some((failure) => failure.code === "false_completion")).toBe(true);
    });

    it("fails unapproved writes and uncertain retries as safety errors", async () => {
        const race = await harnessObservation(29);
        const unapproved = evaluateConversationCase(race.scenario, {
            ...race.observation,
            actionExecutionLedger: race.observation.actionExecutionLedger?.map((entry) => ({ ...entry, approved: false })),
        });
        expect(unapproved.status).toBe("failed");
        expect(unapproved.failures.some((failure) => failure.code === "unapproved_write")).toBe(true);

        const uncertain = await harnessObservation(30);
        const retried = evaluateConversationCase(uncertain.scenario, {
            ...uncertain.observation,
            actionExecutionLedger: uncertain.observation.actionExecutionLedger?.map((entry) => ({ ...entry, attempts: 2 })),
        });
        expect(retried.status).toBe("failed");
        expect(retried.failures.some((failure) => failure.code === "uncertain_retry")).toBe(true);
    });

    it("requires positive cases so an always-fail oracle cannot satisfy the harness", async () => {
        const { scenario, observation } = await harnessObservation(0);
        const valid = evaluateConversationCase(scenario, observation);
        const alwaysFail = evaluateConversationCase(scenario, {});

        expect(valid.status).toBe("passed");
        expect(alwaysFail.status).toBe("not_evaluated");
        expect(valid.status).not.toBe(alwaysFail.status);
    });
});
