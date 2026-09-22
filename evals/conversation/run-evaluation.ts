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
import { PRODUCT_DISPOSABLE_E2E_FLAG } from "./product-disposable-e2e";

export interface ConversationEvaluationRunOptions {
    cases?: readonly ConversationScenario[];
    adapter: ConversationRuntimeAdapter;
    transport: ConversationTransport;
}

export interface ConversationEvaluationCliOptions {
    product: boolean;
    productChild: boolean;
    productDisposableE2e: boolean;
}

/** Keep the CLI contract explicit so the guarded database lane cannot be
 * selected accidentally by a bare or malformed product invocation. */
export function parseConversationEvaluationArgs(args: readonly string[]): ConversationEvaluationCliOptions {
    const product = args.includes("--product");
    const productChild = args.includes("--product-child");
    const productDisposableE2e = args.includes(PRODUCT_DISPOSABLE_E2E_FLAG);
    if (productDisposableE2e && !product) {
        throw new Error(`${PRODUCT_DISPOSABLE_E2E_FLAG} requires --product`);
    }
    return { product, productChild, productDisposableE2e };
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

export type ConversationCaseDisposition = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export type ConversationFailureCause =
    | "product-defect"
    | "unimplemented-feature/connection"
    | "mock-response/fixture-gap"
    | "observation/evidence-gap";

export interface ConversationCaseClassification {
    disposition: ConversationCaseDisposition;
    causes: readonly ConversationFailureCause[];
}

/**
 * Keep the evaluator's pass/fail result separate from the resume diagnosis.
 * A known fixture or instrumentation gap never becomes a pass, and a supplied
 * mismatch remains FAIL even when a later product owner is also missing.
 */
export function classifyConversationCase(
    result: ConversationEvaluationResult,
    adapter: ConversationRuntimeAdapter,
    scenario?: ConversationScenario,
): ConversationCaseClassification {
    const missingObservation = result.failures.some((failure) => failure.code === "missing_observation");
    const safetyFailure = result.failures.some((failure) => [
        "false_completion", "unapproved_write", "no_consent_send", "uncertain_retry", "safety_error", "transport_error",
    ].includes(failure.code));
    const causes = new Set<ConversationFailureCause>();

    if (safetyFailure) causes.add("product-defect");
    if (missingObservation) causes.add("observation/evidence-gap");

    const lifecycleEvidenceRequired = Boolean(scenario && (
        scenario.oracle.ledger.length > 0 || scenario.oracle.sends.length > 0 || scenario.oracle.authority.length > 0
    ));
    const structuralMismatch = result.failures.some((failure) => [
        "current_state_mismatch", "structured_event_missing", "draft_state_mismatch",
    ].includes(failure.code));
    const productFixtureGap = adapter.mode === "product" && (
        (result.observed.structuredEvents === 0 && structuralMismatch)
        || scenario?.family === "required-minimal-registration"
    );
    if (adapter.mode === "product") {
        if (lifecycleEvidenceRequired && missingObservation) causes.add("unimplemented-feature/connection");
        // The deterministic product model emits a fixed response and does not
        // synthesize tool/read events. Structural mismatches from that run are
        // a fixture/adapter limitation, not a claim that product logic passed.
        if (productFixtureGap) {
            causes.add("mock-response/fixture-gap");
        }
    }
    if (structuralMismatch && !productFixtureGap) causes.add("product-defect");
    const nonStructuralMismatch = result.failures.some((failure) => ![
        "missing_observation", "current_state_mismatch", "structured_event_missing", "draft_state_mismatch",
    ].includes(failure.code));
    if (nonStructuralMismatch) causes.add("product-defect");

    let disposition: ConversationCaseDisposition;
    if (result.status === "passed") disposition = "PASS";
    else if (result.status === "failed") disposition = "FAIL";
    else {
        const anyObservedEvidence = result.observed.completion !== undefined
            || result.observed.structuredEvents > 0
            || result.observed.ledgerEntries > 0
            || result.observed.sends > 0
            || result.observed.authorityOutcomes > 0;
        disposition = anyObservedEvidence ? "BLOCKED" : "NOT_RUN";
    }
    return { disposition, causes: [...causes].sort() };
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

    const scenarioById = new Map(CONVERSATION_EVAL_CASES.map((scenario) => [scenario.id, scenario]));
    const classifications = summary.results.map((result) => ({
        result,
        classification: classifyConversationCase(result, adapter, scenarioById.get(result.caseId)),
    }));
    const dispositionCounts = classifications.reduce<Record<ConversationCaseDisposition, number>>((counts, item) => {
        counts[item.classification.disposition] += 1;
        return counts;
    }, { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0 });
    const causeCounts = classifications.reduce<Record<ConversationFailureCause, number>>((counts, item) => {
        for (const cause of item.classification.causes) counts[cause] += 1;
        return counts;
    }, {
        "product-defect": 0,
        "unimplemented-feature/connection": 0,
        "mock-response/fixture-gap": 0,
        "observation/evidence-gap": 0,
    });
    lines.push(
        `case dispositions: PASS ${dispositionCounts.PASS}, FAIL ${dispositionCounts.FAIL}, BLOCKED ${dispositionCounts.BLOCKED}, NOT_RUN ${dispositionCounts.NOT_RUN}`,
        `case causes: product-defect ${causeCounts["product-defect"]}, unimplemented-feature/connection ${causeCounts["unimplemented-feature/connection"]}, mock-response/fixture-gap ${causeCounts["mock-response/fixture-gap"]}, observation/evidence-gap ${causeCounts["observation/evidence-gap"]}`,
        "case-by-case diagnosis:",
    );
    for (const { result, classification } of classifications) {
        const failureCodes = [...new Set(result.failures.map((failure) => failure.code))].sort();
        lines.push(`- ${result.caseId} (${result.family}): ${classification.disposition}; causes=${classification.causes.join(",") || "none"}; failures=${failureCodes.join(",") || "none"}`);
    }
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
        register: (options: { transpileOnly: boolean; project: string; compilerOptions: Record<string, unknown> }) => void;
    };
    // ts-node's CLI service is type-checking the entrypoint. Replace only its
    // extension hook before loading backend classes so unresolved project
    // aliases cannot turn a product observation into a compiler failure.
    delete require.extensions[".ts"];
    tsNodeApi.register({
        transpileOnly: true,
        project: resolve(backendRoot, "tsconfig.json"),
        compilerOptions: {
            module: "CommonJS",
            moduleResolution: "Node",
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

export async function runDeterministicProductDisposableE2e(): Promise<string> {
    configureBackendModuleAliases();
    const { formatProductDisposableE2eReport, runProductDisposableE2eEvaluation } = await import("./product-disposable-e2e");
    return formatProductDisposableE2eReport(await runProductDisposableE2eEvaluation());
}

function runProductCliChild(productDisposableE2e: boolean): number {
    const backendRoot = resolve(__dirname, "../../backend");
    const tsNodeCli = require.resolve("ts-node/dist/bin.js", { paths: [backendRoot] });
    const result = spawnSync(process.execPath, [
        tsNodeCli,
        "--transpile-only",
        "--project",
        "tsconfig.json",
        "--compiler-options",
        '{"module":"CommonJS","moduleResolution":"Node","target":"ES2021","experimentalDecorators":true,"emitDecoratorMetadata":true,"esModuleInterop":true}',
        __filename,
        "--product",
        ...(productDisposableE2e ? [PRODUCT_DISPOSABLE_E2E_FLAG] : []),
        "--product-child",
    ], { cwd: backendRoot, env: process.env, stdio: "inherit" });
    return result.status ?? 1;
}

async function main(): Promise<void> {
    const options = parseConversationEvaluationArgs(process.argv.slice(2));
    if (options.product && !options.productChild) {
        process.exitCode = runProductCliChild(options.productDisposableE2e);
        return;
    }
    if (options.product && options.productDisposableE2e) {
        const report = await runDeterministicProductDisposableE2e();
        process.stdout.write(`${report}\n`);
        process.exitCode = report.endsWith("status: passed") ? 0 : 1;
        return;
    }
    if (options.product) {
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
