/**
 * Jev evaluation runner: connects the offline evaluation tooling (Task 3.2)
 * and the production decision adapter to a single report-producing CLI.
 *
 * Usage:
 *   ts-node scripts/agent/run-jev-evaluation.ts --mode=fixture|live \
 *     --input=<corpus.json> --output=<report.json> \
 *     [--model=<pinned-id>] [--max-cases=<n>] [--consent=live-provider-call]
 *
 * Modes
 *  - fixture (default): network-free. Parses and validates a corpus, checks
 *    the committed judge rubric, computes the reference-label report through
 *    the jev-evaluation exports, and writes a versioned report envelope. No
 *    provider client is ever constructed and no fetch of any kind happens.
 *  - live: runs each synthetic corpus case through the production adapter
 *    (TypeSafeJevDecisionService) against the pinned model. Refuses to start
 *    unless ALL of the following hold (the first missing condition is named):
 *      1. explicit operator opt-in: --consent=live-provider-call
 *      2. TYPESAFE_API_KEY is set in the environment
 *      3. the corpus is synthetic-only (labelProvenance "synthetic-authored"
 *         for every case) and --input resolves inside evals/agent/jev/
 *      4. the model is the pinned id jev-1.13.0; moving aliases are rejected
 *
 * Consent boundary: --consent=live-provider-call authorizes exactly one
 * external action — TypeSafe system-one calls for this corpus evaluation
 * against the pinned model. It is never reused for any unrelated external
 * business action, and no other consent (ambient env flags, other suites)
 * satisfies it.
 *
 * Report safety: the envelope is versioned, contains no credentials and no
 * raw provider payloads; texts appear only from the synthetic corpus (live
 * mode refuses non-synthetic corpora outright); labels and statuses are
 * machine tokens. Reports are safe to retain as artifacts. Judge scores are
 * advisory by rubric and are stored in a separate per-case `scores` field,
 * structurally apart from the `reference` labels and the summary metrics.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { Fetch } from "@typesafe-ai/sdk";
import type { ConfigService } from "@nestjs/config";

import {
    DECISION_KINDS,
    DECISION_STATUSES,
    type ClarificationJudgments,
    type DecisionEvidence,
    type DecisionKind,
    type DecisionStatus,
} from "../../application/agent/decision/decision-contracts";
import { DECISION_QUESTION_VERSION } from "../../application/agent/decision/decision-questions";
import {
    PINNED_MODEL_ID,
    TypeSafeJevDecisionService,
} from "../../infrastructure/agent/typesafe-jev-decision.service";
import {
    computeEvaluationReport,
    parseJevCorpus,
    detectScenarioLeakage,
    type JevCase,
    type JevCorpus,
    type JevLevelMetrics,
    type JevMetricsRow,
    type JevPrediction,
} from "./jev-evaluation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPORT_SCHEMA_VERSION = 1;
export const LIVE_CONSENT_FLAG = "--consent=live-provider-call";
export const LIVE_CONSENT_VALUE = "live-provider-call";
export const EVAL_DIR_RELATIVE = "evals/agent/jev";
export const RUBRIC_FILENAME = "judge-rubric-v1.json";
/** Per-case wall-clock budget handed to the production adapter. */
const LIVE_DEADLINE_MS = 5000;
/** Fixed choice-set revision token for rank-candidates evaluation requests. */
const EVAL_CHOICE_SET_REVISION = "jev-eval-v1";
/** Deterministic placeholder candidate for rank-candidates evaluation. */
const EVAL_PLACEHOLDER_CANDIDATE = "candidate-1";
/** Binarization threshold for the clarification outcome (evaluation convention). */
export const CLARIFICATION_BINARIZATION_THRESHOLD = 0.5;

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const EVAL_DIR = join(REPO_ROOT, "evals", "agent", "jev");
const RUBRIC_PATH = join(EVAL_DIR, RUBRIC_FILENAME);

const KIND_VALUES = Object.values(DECISION_KINDS);

const REQUEST_CONVENTIONS: Readonly<Record<DecisionKind, string>> = Object.freeze({
    [DECISION_KINDS.routeDomains]:
        "permittedDomains = the corpus's declared domain vocabulary; selection = argmax yesProbability, ties keep declaration order",
    [DECISION_KINDS.classifyClientIntent]:
        "request carries the corpus text only; selection = the returned intent label",
    [DECISION_KINDS.evaluateClarification]:
        "request carries the corpus text with missingFields=[] and targetConfirmed=false; selection = clarificationRequired >= 0.5 (documented evaluation binarization, not a production policy)",
    [DECISION_KINDS.rankCandidates]:
        "request carries a single deterministic placeholder candidate (label candidate-1, no facts) with choiceSetRevision jev-eval-v1; selection = the returned outcome token — measures the synthetic scenario only, never production candidate ranking",
});

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/** Kind-specific model scores, kept structurally apart from reference labels. */
export type JevCaseScores =
    | {
        readonly type: "route-domains";
        readonly domainScores: ReadonlyArray<{ readonly domain: string; readonly yesProbability: number }>;
    }
    | {
        readonly type: "classify-client-intent";
        readonly intent: string | null;
        readonly probabilities: Readonly<Record<string, number>>;
        readonly confidence: number | null;
    }
    | {
        readonly type: "evaluate-clarification";
        readonly judgments: ClarificationJudgments | null;
    }
    | {
        readonly type: "rank-candidates";
        readonly outcome: string | null;
        readonly suggestion: string | null;
        readonly probabilities: Readonly<Record<string, number>>;
    };

export interface JevCaseReportEntry {
    readonly id: string;
    readonly decisionKind: DecisionKind;
    readonly split: string;
    readonly language: string;
    readonly scenarioFamily: string;
    /** Texts appear only from the synthetic corpus (live refuses other corpora). */
    readonly text: string;
    readonly notes: string | null;
    /** Reference labels: the only release-gating ground truth (AC-16). */
    readonly reference: {
        readonly labelProvenance: string;
        readonly acceptable: readonly string[];
        readonly unacceptable: readonly string[];
    };
    readonly prediction: {
        readonly status: DecisionStatus;
        readonly selection: string | null;
        readonly failureReason: string | null;
        readonly latencyMs: number;
    } | null;
    /** Advisory model/judge scores; never merged into reference or metrics. */
    readonly scores: JevCaseScores | null;
}

export interface JevLiveSection {
    readonly executed: true;
    readonly model: string;
    readonly perKindCalls: Readonly<Record<DecisionKind, number>>;
    readonly perKindAccepted: Readonly<Record<DecisionKind, number>>;
    readonly perKindUnavailable: Readonly<Record<DecisionKind, number>>;
    readonly failures: ReadonlyArray<{
        readonly caseId: string;
        readonly decisionKind: DecisionKind;
        readonly failureReason: string;
    }>;
    readonly requestConventions: Readonly<Record<DecisionKind, string>>;
}

export interface JevRunReport {
    readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
    readonly mode: "fixture" | "live";
    readonly model: string | null;
    readonly datasetDigest: string;
    readonly datasetCaseCount: number;
    readonly generatedAt: string;
    readonly rubricVersion: string;
    readonly maxCases: number | null;
    readonly evaluatedCaseCount: number;
    readonly summary: {
        readonly questionVersion: string;
        readonly overall: JevLevelMetrics;
        readonly byKind: Readonly<Record<DecisionKind, JevMetricsRow>>;
        readonly corpus: {
            readonly caseCount: number;
            readonly byKind: Readonly<Record<string, number>>;
            readonly bySplit: Readonly<Record<string, number>>;
            readonly byProvenance: Readonly<Record<string, number>>;
            readonly scenarioLeakage: readonly string[];
        };
    };
    readonly cases: readonly JevCaseReportEntry[];
    readonly live: JevLiveSection | null;
}

// ---------------------------------------------------------------------------
// Run options / results
// ---------------------------------------------------------------------------

export interface JevRunOptions {
    readonly mode: "fixture" | "live";
    readonly input: string;
    readonly output: string;
    readonly model?: string;
    readonly maxCases?: number;
    readonly consent?: string;
    /** Environment consulted for TYPESAFE_API_KEY / TYPESAFE_BASE_URL. */
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Test seam: transport override handed to the production adapter. */
    readonly fetchImpl?: Fetch;
    /** Test seam: clock for generatedAt and per-case deadlines. */
    readonly now?: () => Date;
}

export type JevRunResult =
    | {
        readonly ok: true;
        readonly exitCode: 0;
        readonly reportPath: string;
        readonly report: JevRunReport;
    }
    | {
        readonly ok: false;
        readonly exitCode: 1;
        readonly errorCode: string;
        readonly message: string;
    };

/** Typed refusal with a machine-readable class and a precise operator message. */
export class JevRunRefusal extends Error {
    readonly errorCode: string;

    constructor(errorCode: string, message: string) {
        super(message);
        this.name = "JevRunRefusal";
        this.errorCode = errorCode;
    }
}

function refusal(errorCode: string, message: string): JevRunRefusal {
    return new JevRunRefusal(errorCode, message);
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

interface RawRubric {
    readonly schemaVersion?: unknown;
    readonly rubricVersion?: unknown;
    readonly binding?: unknown;
    readonly decisionKinds?: unknown;
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, what: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw refusal("rubric-invalid", `Judge rubric field ${what} must be a non-empty string`);
    }
    return value;
}

/**
 * Loads the committed judge rubric, validates the invariants the report
 * depends on (version, per-kind coverage, AC-15/AC-16 bindings), and returns
 * its version for the report envelope. Every run — fixture and live —
 * validates the rubric, so a broken rubric fails loudly before any report.
 */
function loadRubricVersion(): string {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(RUBRIC_PATH, "utf8")) as unknown;
    } catch (error) {
        throw refusal(
            "rubric-invalid",
            `Judge rubric at "${RUBRIC_PATH}" is missing or unreadable: ${(error as Error).message}`,
        );
    }
    if (!isPlainObject(raw)) {
        throw refusal("rubric-invalid", `Judge rubric at "${RUBRIC_PATH}" must be a JSON object`);
    }
    const rubric = raw as RawRubric;
    if (rubric.schemaVersion !== REPORT_SCHEMA_VERSION) {
        throw refusal(
            "rubric-invalid",
            `Judge rubric schemaVersion must be ${REPORT_SCHEMA_VERSION}, got ${String(rubric.schemaVersion)}`,
        );
    }
    const rubricVersion = requireNonEmptyString(rubric.rubricVersion, "rubricVersion");

    if (!isPlainObject(rubric.binding)) {
        throw refusal("rubric-invalid", "Judge rubric field binding must be an object");
    }
    // AC-16 and AC-15 bindings are mandatory: advisory-only judging and
    // agreement-is-not-accuracy must be stated explicitly.
    requireNonEmptyString(rubric.binding["advisoryOnly"], "binding.advisoryOnly");
    requireNonEmptyString(rubric.binding["agreementIsNotAccuracy"], "binding.agreementIsNotAccuracy");

    if (!isPlainObject(rubric.decisionKinds)) {
        throw refusal("rubric-invalid", "Judge rubric field decisionKinds must be an object");
    }
    const decisionKinds = rubric.decisionKinds;
    for (const kind of KIND_VALUES) {
        const entry = decisionKinds[kind];
        if (!isPlainObject(entry)) {
            throw refusal("rubric-invalid", `Judge rubric is missing decisionKinds.${kind}`);
        }
        if (entry["questionVersion"] !== DECISION_QUESTION_VERSION) {
            throw refusal(
                "rubric-invalid",
                `Judge rubric decisionKinds.${kind}.questionVersion must be "${DECISION_QUESTION_VERSION}", got ${String(entry["questionVersion"])}`,
            );
        }
        for (const field of ["criteria", "acceptableOutcomes"] as const) {
            const list = entry[field];
            if (
                !Array.isArray(list)
                || list.length === 0
                || !list.every((item) => typeof item === "string" && item.trim().length > 0)
            ) {
                throw refusal(
                    "rubric-invalid",
                    `Judge rubric decisionKinds.${kind}.${field} must be a non-empty array of non-empty strings`,
                );
            }
        }
        requireNonEmptyString(entry["notes"], `decisionKinds.${kind}.notes`);
    }
    return rubricVersion;
}

// ---------------------------------------------------------------------------
// Live gates
// ---------------------------------------------------------------------------

function requireLiveConsent(consent: string | undefined): void {
    if (consent !== LIVE_CONSENT_VALUE) {
        throw refusal(
            "consent-required",
            `Live mode requires explicit operator opt-in: pass ${LIVE_CONSENT_FLAG}. `
            + "This consent is scoped to the Jev corpus evaluation against the pinned model only "
            + "and is never reused for any other external action.",
        );
    }
}

function requireLiveApiKey(env: Readonly<Record<string, string | undefined>>): string {
    const value = env["TYPESAFE_API_KEY"];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw refusal(
            "missing-api-key",
            "Live mode requires TYPESAFE_API_KEY to be set in the environment; "
            + "refusing to construct a provider client without it.",
        );
    }
    return value;
}

function requirePinnedModel(model: string): string {
    if (model !== PINNED_MODEL_ID) {
        throw refusal(
            "model-not-pinned",
            `Model "${model}" is not the pinned Jev model "${PINNED_MODEL_ID}"; live evaluation rejects moving aliases. `
            + "Omit --model or pass the pinned id.",
        );
    }
    return model;
}

function requireSyntheticOnly(corpus: JevCorpus): void {
    for (const item of corpus.cases) {
        if (item.labelProvenance !== "synthetic-authored") {
            throw refusal(
                "provenance-not-synthetic",
                `Live mode requires a synthetic-only corpus: case "${item.id}" has labelProvenance `
                + `"${item.labelProvenance}" (allowed: synthetic-authored). `
                + "Human-reviewed or incumbent-baseline corpora are never sent to a provider.",
            );
        }
    }
}

function requireInputInsideEvalDir(input: string): string {
    const resolvedInput = resolve(input);
    const evalDirPrefix = EVAL_DIR.endsWith(sep) ? EVAL_DIR : EVAL_DIR + sep;
    if (resolvedInput !== EVAL_DIR && !resolvedInput.startsWith(evalDirPrefix)) {
        throw refusal(
            "input-outside-eval-dir",
            `Live mode requires --input to point inside ${EVAL_DIR_RELATIVE}/: `
            + `"${resolvedInput}" resolves outside "${EVAL_DIR}".`,
        );
    }
    return resolvedInput;
}

// ---------------------------------------------------------------------------
// Corpus / serialization helpers
// ---------------------------------------------------------------------------

function readJsonFile(path: string, description: string): unknown {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (error) {
        throw refusal(
            "input-unreadable",
            `Failed to read ${description} at "${path}": ${(error as Error).message}`,
        );
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch (error) {
        throw refusal(
            "input-invalid",
            `${description} at "${path}" is not valid JSON: ${(error as Error).message}`,
        );
    }
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Live execution
// ---------------------------------------------------------------------------

interface LiveCaseOutcome {
    readonly status: DecisionStatus;
    readonly selection: string | null;
    readonly failureReason: string | null;
    readonly latencyMs: number;
    readonly scores: JevCaseScores;
}

/**
 * Maps adapter evidence to a metric prediction. The adapter emits `accepted`
 * or `unavailable` (abstain belongs to the Phase 3 policy layer); the
 * derivations below are deterministic evaluation-side conventions documented
 * in REQUEST_CONVENTIONS and the judge rubric.
 */
function outcomeFromEvidence(evidence: DecisionEvidence): LiveCaseOutcome {
    const latencyMs = evidence.latencyMs;
    const failureOutcome = (scores: JevCaseScores, reason: string): LiveCaseOutcome => ({
        status: DECISION_STATUSES.unavailable,
        selection: null,
        failureReason: reason,
        latencyMs,
        scores,
    });

    if (evidence.status !== DECISION_STATUSES.accepted) {
        return {
            status: evidence.status,
            selection: null,
            failureReason: evidence.failureReason,
            latencyMs,
            scores: scoresFromEvidence(evidence),
        };
    }

    switch (evidence.kind) {
        case DECISION_KINDS.routeDomains: {
            // Argmax over the adapter-validated per-domain probabilities;
            // strict > keeps the first maximum in permittedDomains order.
            let best: { domain: string; yesProbability: number } | null = null;
            for (const item of evidence.domains) {
                if (best === null || item.yesProbability > best.yesProbability) {
                    best = { domain: item.domain, yesProbability: item.yesProbability };
                }
            }
            return {
                status: DECISION_STATUSES.accepted,
                selection: best?.domain ?? null,
                failureReason: best === null ? "invalid-output" : null,
                latencyMs,
                scores: scoresFromEvidence(evidence),
            };
        }
        case DECISION_KINDS.classifyClientIntent:
            return {
                status: DECISION_STATUSES.accepted,
                selection: evidence.intent,
                failureReason: evidence.intent === null ? "invalid-output" : null,
                latencyMs,
                scores: scoresFromEvidence(evidence),
            };
        case DECISION_KINDS.evaluateClarification: {
            const judgments = evidence.judgments;
            const required = judgments?.clarificationRequired ?? null;
            return {
                status: DECISION_STATUSES.accepted,
                selection: required === null
                    ? null
                    : required >= CLARIFICATION_BINARIZATION_THRESHOLD
                        ? "clarification-required"
                        : "clarification-not-required",
                failureReason: required === null ? "invalid-output" : null,
                latencyMs,
                scores: scoresFromEvidence(evidence),
            };
        }
        case DECISION_KINDS.rankCandidates:
            return {
                status: DECISION_STATUSES.accepted,
                selection: evidence.outcome,
                failureReason: evidence.outcome === null ? "invalid-output" : null,
                latencyMs,
                scores: scoresFromEvidence(evidence),
            };
    }
}

function scoresFromEvidence(evidence: DecisionEvidence): JevCaseScores {
    switch (evidence.kind) {
        case DECISION_KINDS.routeDomains:
            return {
                type: DECISION_KINDS.routeDomains,
                domainScores: evidence.domains.map((item) => ({
                    domain: item.domain,
                    yesProbability: item.yesProbability,
                })),
            };
        case DECISION_KINDS.classifyClientIntent:
            return {
                type: DECISION_KINDS.classifyClientIntent,
                intent: evidence.intent,
                probabilities: evidence.probabilities,
                confidence: evidence.confidence,
            };
        case DECISION_KINDS.evaluateClarification:
            return {
                type: DECISION_KINDS.evaluateClarification,
                judgments: evidence.judgments,
            };
        case DECISION_KINDS.rankCandidates:
            return {
                type: DECISION_KINDS.rankCandidates,
                outcome: evidence.outcome,
                suggestion: evidence.suggestion,
                probabilities: evidence.probabilities,
            };
    }
}

/**
 * Runs one corpus case through the production adapter for its decision kind.
 * Request construction follows the documented per-kind conventions; a
 * non-accepted outcome with a null selection (a contract violation the
 * adapter never produces) degrades to unavailable/invalid-output so the
 * metrics never claim an answer that did not happen.
 */
async function runLiveCase(
    service: TypeSafeJevDecisionService,
    item: JevCase,
    domains: readonly string[],
    now: () => Date,
): Promise<LiveCaseOutcome> {
    const deadlineAt = now().getTime() + LIVE_DEADLINE_MS;
    const signal = new AbortController().signal;
    const base = {
        questionVersion: DECISION_QUESTION_VERSION,
        deadlineAt,
        signal,
    } as const;

    switch (item.decisionKind) {
        case DECISION_KINDS.routeDomains:
            return outcomeFromEvidence(await service.routeDomains({
                ...base,
                kind: DECISION_KINDS.routeDomains,
                redactedText: item.text,
                permittedDomains: [...domains],
            }));
        case DECISION_KINDS.classifyClientIntent:
            return outcomeFromEvidence(await service.classifyClientIntent({
                ...base,
                kind: DECISION_KINDS.classifyClientIntent,
                redactedText: item.text,
            }));
        case DECISION_KINDS.evaluateClarification:
            return outcomeFromEvidence(await service.evaluateClarification({
                ...base,
                kind: DECISION_KINDS.evaluateClarification,
                redactedText: item.text,
                missingFields: [],
                targetConfirmed: false,
            }));
        case DECISION_KINDS.rankCandidates:
            return outcomeFromEvidence(await service.rankCandidates({
                ...base,
                kind: DECISION_KINDS.rankCandidates,
                redactedText: item.text,
                choiceSetRevision: EVAL_CHOICE_SET_REVISION,
                candidates: [{ label: EVAL_PLACEHOLDER_CANDIDATE, facts: [] }],
            }));
    }
}

// ---------------------------------------------------------------------------
// Report builder (shared by both modes)
// ---------------------------------------------------------------------------

function caseReportEntry(item: JevCase, outcome: LiveCaseOutcome | null): JevCaseReportEntry {
    return {
        id: item.id,
        decisionKind: item.decisionKind,
        split: item.split,
        language: item.language,
        scenarioFamily: item.scenarioFamily,
        text: item.text,
        notes: item.notes,
        reference: {
            labelProvenance: item.labelProvenance,
            acceptable: [...item.acceptable],
            unacceptable: [...item.unacceptable],
        },
        prediction: outcome === null
            ? null
            : {
                status: outcome.status,
                selection: outcome.selection,
                failureReason: outcome.failureReason,
                latencyMs: outcome.latencyMs,
            },
        scores: outcome?.scores ?? null,
    };
}

interface BuildReportParams {
    readonly mode: "fixture" | "live";
    readonly model: string | null;
    readonly corpus: JevCorpus;
    readonly selected: readonly JevCase[];
    readonly outcomes: ReadonlyMap<string, LiveCaseOutcome | null>;
    readonly maxCases: number | null;
    readonly rubricVersion: string;
    readonly now: () => Date;
    readonly live: JevLiveSection | null;
}

function buildReport(params: BuildReportParams): JevRunReport {
    const { corpus, selected, outcomes } = params;
    // One prediction stream feeds the shared metric math for both modes:
    // fixture mode contributes no predictions (the corpus is certified, not
    // a model), live mode contributes adapter-derived predictions.
    const predictions: JevPrediction[] = selected
        .map((item): JevPrediction | null => {
            const outcome = outcomes.get(item.id) ?? null;
            if (outcome === null) return null;
            const status = outcome.failureReason === null && outcome.selection === null
                && outcome.status === DECISION_STATUSES.accepted
                ? DECISION_STATUSES.unavailable
                : outcome.status;
            return {
                caseId: item.id,
                status,
                selection: status === DECISION_STATUSES.accepted ? outcome.selection : null,
            };
        })
        .filter((item): item is JevPrediction => item !== null);

    const evaluation = computeEvaluationReport(
        { cases: selected, datasetDigest: corpus.datasetDigest, questionVersion: corpus.questionVersion },
        predictions,
    );

    const cases = selected.map((item) => caseReportEntry(item, outcomes.get(item.id) ?? null));

    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        mode: params.mode,
        model: params.model,
        datasetDigest: corpus.datasetDigest,
        datasetCaseCount: corpus.cases.length,
        generatedAt: params.now().toISOString(),
        rubricVersion: params.rubricVersion,
        maxCases: params.maxCases,
        evaluatedCaseCount: selected.length,
        summary: {
            questionVersion: evaluation.questionVersion,
            overall: evaluation.overall,
            byKind: evaluation.byKind,
            corpus: {
                caseCount: selected.length,
                byKind: countBy(selected, (item) => item.decisionKind),
                bySplit: countBy(selected, (item) => item.split),
                byProvenance: countBy(selected, (item) => item.labelProvenance),
                scenarioLeakage: detectScenarioLeakage({
                    cases: selected,
                    datasetDigest: corpus.datasetDigest,
                    questionVersion: corpus.questionVersion,
                }),
            },
        },
        cases,
        live: params.live,
    };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function executeRun(options: JevRunOptions): Promise<JevRunResult> {
    const mode = options.mode === "live" ? "live" : "fixture";
    if (mode !== options.mode) {
        throw refusal("invalid-arguments", `--mode must be "fixture" or "live", got "${String(options.mode)}"`);
    }
    const maxCases = options.maxCases ?? null;
    if (maxCases !== null && (!Number.isInteger(maxCases) || maxCases <= 0)) {
        throw refusal("invalid-arguments", `--max-cases must be a positive integer, got ${String(options.maxCases)}`);
    }
    const env = options.env ?? process.env;
    const now = options.now ?? (() => new Date());

    // Live gates run in the documented order (consent → credentials → corpus
    // scope → provenance), each naming its own condition; nothing past the
    // gates talks to a provider unless every gate held. The pinned-model
    // check applies in both modes so a moving alias can never ride along in
    // a fixture command line either.
    if (mode === "live") {
        requireLiveConsent(options.consent);
        requireLiveApiKey(env);
    }
    const model = requirePinnedModel(options.model ?? PINNED_MODEL_ID);

    const corpus = parseJevCorpus(readJsonFile(options.input, "corpus file"));

    if (mode === "live") {
        requireSyntheticOnly(corpus);
        requireInputInsideEvalDir(options.input);
    }

    const rubricVersion = loadRubricVersion();

    // Full-corpus validation first; --max-cases then bounds what this run
    // evaluates (corpus file order) without changing the dataset digest.
    const selected = maxCases !== null ? corpus.cases.slice(0, maxCases) : corpus.cases;

    let live: JevLiveSection | null = null;
    const outcomes = new Map<string, LiveCaseOutcome | null>();

    if (mode === "fixture") {
        // Network-free by construction: the adapter is never constructed,
        // so no transport (injected or global) can be reached.
        for (const item of selected) outcomes.set(item.id, null);
    } else {
        const configAdapter = {
            get: (key: string) => env[key],
        };
        const service = new TypeSafeJevDecisionService(
            configAdapter as unknown as ConfigService,
            options.fetchImpl,
        );
        // The declared routing vocabulary for route-domains requests; the
        // corpus is parsed once above and this only reads the validated list.
        const domains = readCorpusDomains(options.input);

        const perKindCalls = emptyKindCounts();
        const perKindAccepted = emptyKindCounts();
        const perKindUnavailable = emptyKindCounts();
        const failures: Array<{ caseId: string; decisionKind: DecisionKind; failureReason: string }> = [];

        for (const item of selected) {
            perKindCalls[item.decisionKind] += 1;
            const outcome = await runLiveCase(service, item, domains, now);
            outcomes.set(item.id, outcome);
            if (outcome.status === DECISION_STATUSES.accepted && outcome.failureReason === null) {
                perKindAccepted[item.decisionKind] += 1;
            } else {
                perKindUnavailable[item.decisionKind] += 1;
                failures.push({
                    caseId: item.id,
                    decisionKind: item.decisionKind,
                    failureReason: outcome.failureReason ?? outcome.status,
                });
            }
        }

        live = {
            executed: true,
            model,
            perKindCalls,
            perKindAccepted,
            perKindUnavailable,
            failures,
            requestConventions: REQUEST_CONVENTIONS,
        };
    }

    const report = buildReport({
        mode,
        model: mode === "live" ? model : null,
        corpus,
        selected,
        outcomes,
        maxCases,
        rubricVersion,
        now,
        live,
    });

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf8");

    const leakage = report.summary.corpus.scenarioLeakage;
    if (leakage.length > 0) {
        console.error(`Scenario leakage detected across splits: ${leakage.join(", ")}`);
    }

    return { ok: true, exitCode: 0, reportPath: outputPath, report };
}

function emptyKindCounts(): Record<DecisionKind, number> {
    return {
        [DECISION_KINDS.routeDomains]: 0,
        [DECISION_KINDS.classifyClientIntent]: 0,
        [DECISION_KINDS.evaluateClarification]: 0,
        [DECISION_KINDS.rankCandidates]: 0,
    };
}

/**
 * Reads the corpus's declared routing vocabulary for route-domains requests.
 * parseJevCorpus validates this list but keeps only the typed cases, so the
 * raw (already-validated) document is consulted for the domain list — the
 * parsing/validation itself is never duplicated.
 */
function readCorpusDomains(input: string): readonly string[] {
    const raw = readJsonFile(input, "corpus file");
    const rawDomains = isPlainObject(raw) ? raw["domains"] : undefined;
    if (!Array.isArray(rawDomains)) {
        throw refusal("input-invalid", `Corpus at "${input}" has no valid "domains" list`);
    }
    return rawDomains.filter((item): item is string => typeof item === "string");
}

/**
 * Runs one evaluation and writes the report. All failures — gate refusals,
 * invalid corpora, rubric violations, unexpected errors — come back as a
 * typed non-zero result; the CLI maps them to stderr + exit code 1.
 */
export async function runJevEvaluation(options: JevRunOptions): Promise<JevRunResult> {
    try {
        return await executeRun(options);
    } catch (error) {
        if (error instanceof JevRunRefusal) {
            return { ok: false, exitCode: 1, errorCode: error.errorCode, message: error.message };
        }
        return {
            ok: false,
            exitCode: 1,
            errorCode: "run-failed",
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
    "Usage: ts-node scripts/agent/run-jev-evaluation.ts --mode=fixture|live --input=<corpus.json> --output=<report.json>",
    "       [--model=<pinned-id>] [--max-cases=<n>] [--consent=live-provider-call]",
    "",
    "Mode fixture (default) is network-free: it validates the corpus and the",
    "judge rubric, computes the reference-label report, and writes the report.",
    "Mode live runs each case through the production adapter against the",
    "pinned model jev-1.13.0 and requires ALL of:",
    `  1. explicit opt-in: ${LIVE_CONSENT_FLAG}`,
    "     (consent is scoped to this Jev corpus evaluation only and is never",
    "      reused for any unrelated external business action)",
    "  2. TYPESAFE_API_KEY set in the environment",
    "  3. a synthetic-only corpus (--input inside evals/agent/jev/)",
    "  4. the pinned model id (moving aliases are rejected)",
    "Exits non-zero, naming the missing condition, when a gate fails.",
].join("\n");

interface CliArgs {
    readonly mode: "fixture" | "live";
    readonly input: string;
    readonly output: string;
    readonly model?: string;
    readonly maxCases?: number;
    readonly consent?: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
    let mode: "fixture" | "live" = "fixture";
    let input: string | null = null;
    let output: string | null = null;
    let model: string | undefined;
    let maxCases: number | undefined;
    let consent: string | undefined;

    for (const arg of argv) {
        const match = /^(--mode|--input|--output|--model|--max-cases|--consent)=(.+)$/.exec(arg);
        if (match === null) {
            throw new Error(`Unrecognized argument "${arg}"\n\n${USAGE}`);
        }
        const flag = match[1] ?? "";
        const value = match[2] ?? "";
        switch (flag) {
            case "--mode":
                if (value !== "fixture" && value !== "live") {
                    throw new Error(`--mode must be "fixture" or "live", got "${value}"\n\n${USAGE}`);
                }
                mode = value;
                break;
            case "--input":
                if (input !== null) throw new Error("--input supplied more than once");
                input = value;
                break;
            case "--output":
                if (output !== null) throw new Error("--output supplied more than once");
                output = value;
                break;
            case "--model":
                if (model !== undefined) throw new Error("--model supplied more than once");
                model = value;
                break;
            case "--max-cases": {
                if (maxCases !== undefined) throw new Error("--max-cases supplied more than once");
                const parsed = Number(value);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                    throw new Error(`--max-cases must be a positive integer, got "${value}"\n\n${USAGE}`);
                }
                maxCases = parsed;
                break;
            }
            case "--consent":
                if (consent !== undefined) throw new Error("--consent supplied more than once");
                consent = value;
                break;
        }
    }
    if (input === null) throw new Error(`--input is required\n\n${USAGE}`);
    if (output === null) throw new Error(`--output is required\n\n${USAGE}`);
    return { mode, input, output, model, maxCases, consent };
}

if (require.main === module) {
    void (async () => {
        try {
            const args = parseCliArgs(process.argv.slice(2));
            const result = await runJevEvaluation({ ...args, env: process.env });
            if (result.ok) {
                console.log(
                    `Jev ${result.report.mode} evaluation report written to ${result.reportPath} `
                    + `(datasetDigest ${result.report.datasetDigest}, cases ${result.report.evaluatedCaseCount})`,
                );
            } else {
                console.error(`[${result.errorCode}] ${result.message}`);
                process.exitCode = 1;
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    })();
}
