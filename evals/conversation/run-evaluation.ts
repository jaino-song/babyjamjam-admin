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
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";

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

/** Failed supplied evidence is a command failure; missing future evidence is
 * explicitly reported as not_evaluated and remains a nonfailure exit. */
export function conversationEvaluationExitCode(status: ConversationEvaluationSummary["status"]): 0 | 1 {
    return status === "failed" ? 1 : 0;
}

export function formatConversationEvaluationReport(input: ConversationEvaluationReportInput): string {
    const { summary, adapter, transport } = input;
    const observedStructuredEvents = summary.results.reduce((total, result) => total + result.observed.structuredEvents, 0);
    const failures = summary.results.flatMap((result) => result.failures);
    const missingEvidenceFailures = failures.filter((failure) => failure.code === "missing_observation").length;
    const suppliedMismatchFailures = failures.filter((failure) => failure.code !== "missing_observation" && failure.code !== "safety_error").length;
    const safetyFailures = failures.filter((failure) => failure.code === "safety_error").length;
    const lines = [
        adapter.mode === "product" ? "Deterministic product runtime evaluation" : "Deterministic harness validation",
        `adapter mode: ${adapter.mode}`,
        ...(adapter.mode === "product"
            ? [
                "evidence source: injected AgentRuntimeService + AgentTaskService with deterministic in-memory state/events",
                "projection fields (only when supported by observed evidence): completion, currentState, acceptedDraftState, structuredEvents, assistantMessages, transport",
                "unavailable fields: actionExecutionLedger and sends (later execution owners); authorityOutcomes (current host authority instrumentation unavailable)",
                "state evidence: task snapshots and accepted event receipts; protected values, random IDs, and wall-clock timestamps are omitted",
                `observed structured events: ${observedStructuredEvents}`,
                "fixture/input limitation: four registration fixtures use unlabelled synthetic-token prose; strict deterministic intake accepts explicit labels such as '이름:'",
                "read limitation: the injected deterministic model has no read-tool results, so read scenarios cannot supply read outcome evidence",
                "later product limitation: action/provider lifecycle outcomes await their product owners and instrumentation",
            ]
            : ["real product/model quality not evaluated"]),
        `fixture version: ${CONVERSATION_FIXTURE_VERSION}`,
        `deterministic clock: ${CONVERSATION_DETERMINISTIC_CLOCK}`,
        `cases: ${summary.counts.total} (development ${CONVERSATION_DEVELOPMENT_CASES.length}, holdout ${CONVERSATION_HOLDOUT_CASES.length})`,
        `results: passed ${summary.counts.passed}, failed ${summary.counts.failed}, not_evaluated ${summary.counts.notEvaluated}`,
        `evaluation evidence: supplied mismatches ${suppliedMismatchFailures}, missing observations ${missingEvidenceFailures}, safety failures ${safetyFailures}`,
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

/**
 * Register the backend's existing path aliases only for the explicit product
 * mode. The normal no-argument harness stays dependency-free; the product
 * bridge loads the real runtime classes after this one-time local alias setup.
 */
function configureBackendModuleAliases(): void {
    const backendRoot = resolve(__dirname, "../../backend");
    const moduleRequire = createRequire(__filename);
    const current = process.env["NODE_PATH"]?.trim();
    process.env["NODE_PATH"] = current ? `${backendRoot}${delimiter}${current}` : backendRoot;
    // Node's supported NODE_PATH lookup handles the backend's existing
    // application/domain/infrastructure/interface/module aliases. Keep the
    // evaluator isolated to this invocation instead of monkey-patching the
    // private Module._resolveFilename hook.
    const moduleApi = moduleRequire("node:module") as { _initPaths?: () => void };
    moduleApi._initPaths?.();
    // The repository intentionally does not depend on tsconfig-paths. Register
    // a narrow transpile-only hook for backend classes loaded by this CLI after
    // the alias resolver is installed; the normal harness remains untouched.
    const tsNodeApi = moduleRequire(moduleRequire.resolve("ts-node", { paths: [backendRoot] })) as {
        register: (options: { transpileOnly: boolean; compilerOptions: Record<string, unknown> }) => void;
    };
    // ts-node's CLI service is type-checking the entrypoint. Replace only its
    // extension hook before loading backend classes so unresolved project
    // aliases cannot turn a product observation into a compiler failure.
    delete require.extensions[".ts"];
    tsNodeApi.register({
        transpileOnly: true,
        compilerOptions: {
            module: "CommonJS",
            target: "ES2021",
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            baseUrl: backendRoot,
        },
    });
}

async function runDeterministicProductEvaluation(): Promise<ConversationEvaluationReportInput> {
    configureBackendModuleAliases();
    const { createDeterministicProductRuntimeDriver, createProductRuntimeAdapter } = await import("./product-runtime-adapter");
    const transport = createNoNetworkMockTransport();
    const driver = createDeterministicProductRuntimeDriver();
    const adapter = createProductRuntimeAdapter({ driver });
    const summary = await runConversationEvaluation({ adapter, transport });
    return { summary, adapter, transport };
}

export async function runDeterministicProduct(): Promise<string> {
    const input = await runDeterministicProductEvaluation();
    return formatConversationEvaluationReport(input);
}

function runProductCliChild(): number {
    const backendRoot = resolve(__dirname, "../../backend");
    const tsNodeCli = require.resolve("ts-node/dist/bin.js", { paths: [backendRoot] });
    const result = spawnSync(process.execPath, [
        tsNodeCli,
        "--transpile-only",
        "--compiler-options",
        '{"module":"CommonJS"}',
        __filename,
        "--product",
        "--product-child",
    ], { cwd: backendRoot, env: process.env, stdio: "inherit" });
    return result.status ?? 1;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const productMode = args.includes("--product");
    if (productMode && !args.includes("--product-child")) {
        process.exitCode = runProductCliChild();
        return;
    }
    if (productMode) {
        const input = await runDeterministicProductEvaluation();
        process.stdout.write(`${formatConversationEvaluationReport(input)}\n`);
        process.exitCode = conversationEvaluationExitCode(input.summary.status);
        return;
    }
    const report = await runDeterministicHarness();
    process.stdout.write(`${report}\n`);
}

if (require.main === module) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
