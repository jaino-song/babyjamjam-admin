/**
 * Run from the repository root with the backend ts-node compiler mode:
 * pnpm --filter ./backend exec ts-node --compiler-options '{"module":"CommonJS"}' ../evals/conversation/run-evaluation.ts
 */
import {
    CONVERSATION_ASSERTION_DIGEST,
    CONVERSATION_DETERMINISTIC_CLOCK,
    CONVERSATION_DEVELOPMENT_CASES,
    CONVERSATION_EVAL_CASES,
    CONVERSATION_EVAL_DIGEST,
    CONVERSATION_FIXTURE_VERSION,
    CONVERSATION_HOLDOUT_CASES,
    type ConversationScenario,
} from "./cases";
import {
    assertConversationFixtureIntegrity,
    createDeterministicClock,
    evaluateConversationCase,
    summarizeConversationEvaluation,
    type ConversationEvaluationResult,
    type ConversationEvaluationSummary,
    type ConversationRuntimeAdapter,
    type ConversationTransport,
} from "./evaluation-policy";
import { createHarnessValidationAdapter, createNoNetworkMockTransport } from "./mock-transport";

export interface ConversationEvaluationRunOptions {
    cases?: readonly ConversationScenario[];
    adapter: ConversationRuntimeAdapter;
    transport: ConversationTransport;
}

export async function runConversationEvaluation(
    options: ConversationEvaluationRunOptions,
): Promise<ConversationEvaluationSummary> {
    const cases = options.cases ?? CONVERSATION_EVAL_CASES;
    assertConversationFixtureIntegrity(cases);
    const results: ConversationEvaluationResult[] = [];
    for (const scenario of cases) {
        const clock = createDeterministicClock(CONVERSATION_DETERMINISTIC_CLOCK);
        try {
            const observation = await options.adapter.run({ case: scenario, clock, transport: options.transport });
            results.push(evaluateConversationCase(scenario, observation, { requireNoNetwork: options.adapter.mode === "harness" }));
        } catch (error) {
            results.push({
                caseId: scenario.id,
                partition: scenario.partition,
                family: scenario.family,
                status: "failed",
                failures: [{ code: "safety_error", message: error instanceof Error ? error.message : String(error) }],
                safetyErrors: [{ code: "other", message: error instanceof Error ? error.message : String(error), observedAt: clock.now }],
                observed: { completion: undefined, ledgerEntries: 0, sends: 0, authorityOutcomes: 0, structuredEvents: 0 },
            });
        }
    }
    return summarizeConversationEvaluation(results);
}

export interface ConversationEvaluationReportInput {
    summary: ConversationEvaluationSummary;
    adapter: ConversationRuntimeAdapter;
    transport: ConversationTransport;
}

export function formatConversationEvaluationReport(input: ConversationEvaluationReportInput): string {
    const { summary, adapter, transport } = input;
    const lines = [
        "Deterministic harness validation",
        `adapter mode: ${adapter.mode}`,
        "real product/model quality not evaluated",
        `fixture version: ${CONVERSATION_FIXTURE_VERSION}`,
        `deterministic clock: ${CONVERSATION_DETERMINISTIC_CLOCK}`,
        `cases: ${summary.counts.total} (development ${CONVERSATION_DEVELOPMENT_CASES.length}, holdout ${CONVERSATION_HOLDOUT_CASES.length})`,
        `results: passed ${summary.counts.passed}, failed ${summary.counts.failed}, not_evaluated ${summary.counts.notEvaluated}`,
        `fixture digest: ${CONVERSATION_EVAL_DIGEST}`,
        `assertion digest: ${CONVERSATION_ASSERTION_DIGEST}`,
        `network calls: ${transport.networkCalls}`,
        `transport calls: ${transport.calls}`,
        `safety errors: ${summary.safetyErrors.length}`,
        `status: ${summary.status}`,
    ];
    if (summary.results.some((result) => result.status !== "passed")) {
        lines.push("failed or unevaluated cases:");
        for (const result of summary.results.filter((item) => item.status !== "passed")) {
            lines.push(`- ${result.caseId}: ${result.status}`);
        }
    }
    return lines.join("\n");
}

export async function runDeterministicHarness(): Promise<string> {
    const transport = createNoNetworkMockTransport();
    const adapter = createHarnessValidationAdapter();
    const summary = await runConversationEvaluation({ adapter, transport });
    if (summary.status !== "passed") throw new Error(formatConversationEvaluationReport({ summary, adapter, transport }));
    return formatConversationEvaluationReport({ summary, adapter, transport });
}

async function main(): Promise<void> {
    const report = await runDeterministicHarness();
    process.stdout.write(`${report}\n`);
}

if (require.main === module) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
