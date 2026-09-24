/**
 * Offline evaluation tooling for the Jev semantic decision layer.
 *
 * This module is network-free by construction: it touches only the Node
 * standard library (fs, path, crypto) and the provider-neutral decision
 * contracts. It never reads credentials and never performs provider calls —
 * it is the deterministic foundation Task 9.1 will later connect to live
 * evaluation runs.
 *
 * Exports:
 *  - parseJevCorpus: strict corpus validation + stable dataset digest
 *  - detectScenarioLeakage: scenario families shared across splits
 *  - computeEvaluationReport: deterministic precision/coverage/abstention
 *    metrics with a 95% Wilson interval and optional baseline comparison
 *
 * The CLI (`ts-node scripts/agent/jev-evaluation.ts --input=...`) validates a
 * corpus or computes a report from a prediction file and exits non-zero on
 * invalid corpora, scenario leakage, or missing predictions.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
    CANDIDATE_OUTCOMES,
    CLIENT_INTENTS,
    DECISION_KINDS,
    DECISION_STATUSES,
    type DecisionKind,
    type DecisionStatus,
} from "../../application/agent/decision/decision-contracts";
import { DECISION_QUESTION_VERSION } from "../../application/agent/decision/decision-questions";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const JEV_SPLITS = ["calibration", "holdout"] as const;
export type JevSplit = (typeof JEV_SPLITS)[number];

export const JEV_LANGUAGES = ["ko", "en", "mixed"] as const;
export type JevLanguage = (typeof JEV_LANGUAGES)[number];

export const JEV_LABEL_PROVENANCES = [
    "synthetic-authored",
    "human-reviewed",
    "incumbent-baseline",
] as const;
export type JevLabelProvenance = (typeof JEV_LABEL_PROVENANCES)[number];

/**
 * Evaluation labels for the clarification decision. The runtime contract
 * models clarification as independent judgments; the corpus evaluates the
 * resulting binary outcome.
 */
export const CLARIFICATION_EVALUATION_LABELS = [
    "clarification-required",
    "clarification-not-required",
] as const;

export const CANDIDATE_EVALUATION_LABELS = Object.values(CANDIDATE_OUTCOMES);

const DECISION_KIND_VALUES: readonly string[] = Object.values(DECISION_KINDS);

/** All decision statuses a supplied prediction may carry. */
const PREDICTION_STATUS_VALUES: readonly DecisionStatus[] = Object.values(DECISION_STATUSES);

/**
 * `not-evaluated` is a trace-level status: a prediction file entry claiming it
 * is a caller bug, so it is rejected rather than silently folded into another
 * bucket.
 */
const NON_EVALUATED_STATUS: DecisionStatus = DECISION_STATUSES.notEvaluated;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type JevEvaluationErrorCode =
    | "invalid-corpus"
    | "empty-corpus"
    | "invalid-predictions";

/**
 * Typed error carrying the machine-readable failure class and — when the
 * failure belongs to one case/prediction — its exact case id.
 */
export class JevEvaluationError extends Error {
    readonly code: JevEvaluationErrorCode;
    readonly caseId: string | null;

    constructor(code: JevEvaluationErrorCode, message: string, caseId: string | null = null) {
        super(message);
        this.name = "JevEvaluationError";
        this.code = code;
        this.caseId = caseId;
    }
}

function corpusError(message: string, caseId: string | null): JevEvaluationError {
    return new JevEvaluationError("invalid-corpus", message, caseId);
}

function predictionError(message: string, caseId: string | null): JevEvaluationError {
    return new JevEvaluationError("invalid-predictions", message, caseId);
}

// ---------------------------------------------------------------------------
// Corpus model
// ---------------------------------------------------------------------------

/**
 * Optional per-case clarification state for `evaluate-clarification` cases,
 * mirroring the shape `TypeSafeJevDecisionService.evaluateClarification`
 * sends as `state.missingFields` / `state.targetConfirmed`
 * (infrastructure/agent/typesafe-jev-decision.service.ts:434-438). Absent on
 * a case means today's evaluation-harness default: no missing fields, no
 * confirmed target (see `DEFAULT_CLARIFICATION_STATE` below).
 */
export interface JevClarificationState {
    readonly missingFields: readonly string[];
    readonly targetConfirmed: boolean;
}

export interface JevCase {
    readonly id: string;
    readonly decisionKind: DecisionKind;
    readonly split: JevSplit;
    readonly scenarioFamily: string;
    readonly language: JevLanguage;
    readonly text: string;
    readonly acceptable: readonly string[];
    readonly unacceptable: readonly string[];
    readonly labelProvenance: JevLabelProvenance;
    readonly notes: string | null;
    /** Only ever non-null for decisionKind "evaluate-clarification". */
    readonly state: JevClarificationState | null;
}

/** The evaluation harness's long-standing default when a case carries no explicit state. */
export const DEFAULT_CLARIFICATION_STATE: JevClarificationState = Object.freeze({
    missingFields: [],
    targetConfirmed: false,
});

export interface JevCorpus {
    readonly cases: readonly JevCase[];
    readonly datasetDigest: string;
    readonly questionVersion: string;
}

const CASE_REQUIRED_KEYS = [
    "acceptable",
    "decisionKind",
    "id",
    "labelProvenance",
    "language",
    "scenarioFamily",
    "split",
    "text",
] as const;

const CASE_OPTIONAL_KEYS = ["notes", "unacceptable", "state"] as const;

/** Exact key set for a case's optional `state` object. Both keys are required when `state` is present at all. */
const CLARIFICATION_STATE_KEYS = ["missingFields", "targetConfirmed"] as const;

// ---------------------------------------------------------------------------
// Generic validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string, caseId: string | null): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw corpusError(`Field "${field}" must be a non-empty string`, caseId);
    }
    return value;
}

function requireStringArray(
    value: unknown,
    field: string,
    caseId: string | null,
    allowEmpty: boolean,
): string[] {
    if (!Array.isArray(value)) {
        throw corpusError(`Field "${field}" must be an array of strings`, caseId);
    }
    if (!allowEmpty && value.length === 0) {
        throw corpusError(`Field "${field}" must not be empty`, caseId);
    }
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string" || item.length === 0) {
            throw corpusError(`Field "${field}" must contain only non-empty strings`, caseId);
        }
        if (seen.has(item)) {
            throw corpusError(`Field "${field}" contains duplicate label "${item}"`, caseId);
        }
        seen.add(item);
    }
    return [...value];
}

function requireBoolean(value: unknown, field: string, caseId: string | null): boolean {
    if (typeof value !== "boolean") {
        throw corpusError(`Field "${field}" must be a boolean`, caseId);
    }
    return value;
}

function requireEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    field: string,
    caseId: string | null,
): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw corpusError(`Field "${field}" must be one of: ${allowed.join(", ")}`, caseId);
    }
    return value as T;
}

function requireExactKeys(
    value: Record<string, unknown>,
    required: readonly string[],
    optional: readonly string[],
    what: string,
    caseId: string | null,
): void {
    for (const key of Object.keys(value)) {
        if (!required.includes(key) && !optional.includes(key)) {
            throw corpusError(`Unknown ${what} key "${key}"`, caseId);
        }
    }
    for (const key of required) {
        if (!(key in value)) {
            throw corpusError(`${what} is missing required key "${key}"`, caseId);
        }
    }
}

// ---------------------------------------------------------------------------
// Canonicalization + digest
// ---------------------------------------------------------------------------

/**
 * Recursively orders object keys so that identical content produces identical
 * JSON regardless of the key order in the source file. Array order is content
 * and is preserved.
 */
function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort();
        const result: Record<string, unknown> = {};
        for (const key of keys) result[key] = canonicalize(value[key]);
        return result;
    }
    return value;
}

/**
 * SHA-256 over the canonicalized case list with cases ordered by id, so the
 * digest depends only on content, never on file formatting or array order.
 */
export function computeDatasetDigest(cases: readonly JevCase[]): string {
    const ordered = [...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const canonical = JSON.stringify(ordered.map((item) => canonicalize(item)));
    return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// parseJevCorpus
// ---------------------------------------------------------------------------

const CORPUS_ROOT_KEYS = ["cases", "domains"] as const;

/**
 * Strictly validates a raw decoded corpus document and returns the typed
 * corpus with its stable dataset digest. Throws a JevEvaluationError naming
 * the first invalid case. The domain list declares the closed route-domains
 * label vocabulary for this corpus (the runtime supplies domains per request;
 * the corpus fixes the set it evaluates against).
 */
export function parseJevCorpus(raw: unknown): JevCorpus {
    if (!isPlainObject(raw)) {
        throw corpusError("Corpus root must be a JSON object", null);
    }
    requireExactKeys(raw, CORPUS_ROOT_KEYS, [], "corpus root", null);

    const rawDomains = raw["domains"];
    if (!Array.isArray(rawDomains) || rawDomains.length === 0) {
        throw corpusError("Corpus field \"domains\" must be a non-empty array", null);
    }
    const domainSet = new Set<string>();
    for (const domain of rawDomains) {
        if (typeof domain !== "string" || domain.trim().length === 0) {
            throw corpusError("Corpus field \"domains\" must contain only non-empty strings", null);
        }
        if (domainSet.has(domain)) {
            throw corpusError(`Corpus field \"domains\" contains duplicate domain "${domain}"`, null);
        }
        domainSet.add(domain);
    }

    const rawCases = raw["cases"];
    if (!Array.isArray(rawCases)) {
        throw corpusError("Corpus field \"cases\" must be an array", null);
    }
    if (rawCases.length === 0) {
        throw corpusError("Corpus must contain at least one labeled case", null);
    }

    const seenIds = new Set<string>();
    const cases: JevCase[] = rawCases.map((entry, index) => parseCase(entry, index, domainSet, seenIds));

    return {
        cases,
        datasetDigest: computeDatasetDigest(cases),
        questionVersion: DECISION_QUESTION_VERSION,
    };
}

function parseCase(
    entry: unknown,
    index: number,
    domains: ReadonlySet<string>,
    seenIds: Set<string>,
): JevCase {
    if (!isPlainObject(entry)) {
        throw corpusError(`Case at index ${index} must be a JSON object`, null);
    }
    // Name the case in key-level errors whenever an id string is present.
    const caseId = typeof entry["id"] === "string" ? entry["id"] : null;
    requireExactKeys(entry, CASE_REQUIRED_KEYS, CASE_OPTIONAL_KEYS, "case", caseId);

    const id = requireNonEmptyString(entry["id"], "id", caseId);
    if (seenIds.has(id)) {
        throw corpusError(`Duplicate case id "${id}"`, id);
    }
    seenIds.add(id);

    const decisionKind = requireEnum<DecisionKind>(
        entry["decisionKind"],
        DECISION_KIND_VALUES as readonly DecisionKind[],
        "decisionKind",
        id,
    );
    const split = requireEnum(entry["split"], JEV_SPLITS, "split", id);
    const language = requireEnum(entry["language"], JEV_LANGUAGES, "language", id);
    const labelProvenance = requireEnum(
        entry["labelProvenance"],
        JEV_LABEL_PROVENANCES,
        "labelProvenance",
        id,
    );
    const scenarioFamily = requireNonEmptyString(entry["scenarioFamily"], "scenarioFamily", id);
    const text = requireNonEmptyString(entry["text"], "text", id);
    const acceptable = requireStringArray(entry["acceptable"], "acceptable", id, false);
    const unacceptable = "unacceptable" in entry
        ? requireStringArray(entry["unacceptable"], "unacceptable", id, true)
        : [];

    for (const label of unacceptable) {
        if (acceptable.includes(label)) {
            throw corpusError(
                `Label "${label}" appears in both acceptable and unacceptable`,
                id,
            );
        }
    }

    const validLabels = labelVocabulary(decisionKind, domains);
    for (const label of [...acceptable, ...unacceptable]) {
        if (!validLabels.has(label)) {
            throw corpusError(
                `Label "${label}" is not valid for decision kind "${decisionKind}" `
                + `(valid labels: ${[...validLabels].join(", ")})`,
                id,
            );
        }
    }

    const notes = "notes" in entry
        ? requireNonEmptyString(entry["notes"], "notes", id)
        : null;

    const state = "state" in entry
        ? parseCaseState(entry["state"], decisionKind, id)
        : null;

    return {
        id,
        decisionKind,
        split,
        scenarioFamily,
        language,
        text,
        acceptable,
        unacceptable,
        state,
        labelProvenance,
        notes,
    };
}

/**
 * Validates a case's optional `state` object. `state` is only meaningful for
 * `evaluate-clarification` cases (it mirrors the request shape
 * `evaluateClarification` sends the model); any other decision kind carrying
 * a `state` key is a corpus authoring error, not a differently-shaped case.
 */
function parseCaseState(
    value: unknown,
    decisionKind: DecisionKind,
    caseId: string | null,
): JevClarificationState {
    if (decisionKind !== DECISION_KINDS.evaluateClarification) {
        throw corpusError(
            `Field "state" is only valid for decisionKind "${DECISION_KINDS.evaluateClarification}", `
            + `got "${decisionKind}"`,
            caseId,
        );
    }
    if (!isPlainObject(value)) {
        throw corpusError('Field "state" must be a JSON object', caseId);
    }
    requireExactKeys(value, CLARIFICATION_STATE_KEYS, [], "state", caseId);
    const missingFields = requireStringArray(value["missingFields"], "state.missingFields", caseId, true);
    const targetConfirmed = requireBoolean(value["targetConfirmed"], "state.targetConfirmed", caseId);
    return { missingFields, targetConfirmed };
}

/**
 * Closed label vocabulary per decision kind. route-domains is open at runtime
 * (the server supplies the permitted domains per request), so the corpus's
 * declared domain list is the vocabulary.
 */
function labelVocabulary(kind: DecisionKind, domains: ReadonlySet<string>): ReadonlySet<string> {
    switch (kind) {
        case DECISION_KINDS.routeDomains:
            return domains;
        case DECISION_KINDS.classifyClientIntent:
            return new Set<string>(Object.values(CLIENT_INTENTS));
        case DECISION_KINDS.evaluateClarification:
            return new Set<string>(CLARIFICATION_EVALUATION_LABELS);
        case DECISION_KINDS.rankCandidates:
            return new Set<string>(CANDIDATE_EVALUATION_LABELS);
    }
}

// ---------------------------------------------------------------------------
// Leakage detection
// ---------------------------------------------------------------------------

/**
 * Scenario families present in both the calibration and the holdout split.
 * A non-empty result means the split boundary leaks scenario content and the
 * holdout numbers would not measure generalization.
 */
export function detectScenarioLeakage(corpus: JevCorpus): string[] {
    const calibration = new Set<string>();
    const holdout = new Set<string>();
    for (const item of corpus.cases) {
        (item.split === "calibration" ? calibration : holdout).add(item.scenarioFamily);
    }
    return [...calibration].filter((family) => holdout.has(family)).sort();
}

// ---------------------------------------------------------------------------
// Evaluation metrics
// ---------------------------------------------------------------------------

export interface JevPrediction {
    readonly caseId: string;
    readonly status: DecisionStatus;
    /**
     * The selected label; mirrors DecisionPolicyResult: set only when
     * status === "accepted", otherwise null.
     */
    readonly selection: string | null;
}

const PREDICTION_KEYS: readonly string[] = ["caseId", "selection", "status"];

const PREDICTIONS_FILE_KEYS: readonly string[] = ["questionVersion", "predictions"];

/**
 * Per decision-kind metrics.
 *
 * Partition: labeled = evaluated + missing, and evaluated = accepted +
 * abstained + unavailable. `precision` is correct / accepted and is null when
 * accepted === 0 — a report must never claim perfect precision without an
 * accepted denominator.
 */
export interface JevKindMetrics {
    readonly decisionKind: DecisionKind;
    readonly labeledCount: number;
    readonly evaluatedCount: number;
    readonly acceptedCount: number;
    readonly abstainedCount: number;
    readonly unavailableCount: number;
    readonly missingPredictionCount: number;
    readonly correctCount: number;
    /** correct / accepted; null when acceptedCount === 0. Never defaults to 1.0. */
    readonly precision: number | null;
    /** acceptedCount / labeledCount; null when labeledCount === 0. */
    readonly coverage: number | null;
    /** abstainedCount / evaluatedCount; null when evaluatedCount === 0. */
    readonly abstentionRate: number | null;
    /** 95% Wilson score interval for precision; null when acceptedCount === 0. */
    readonly precisionWilson95: JevWilsonInterval | null;
}

export interface JevWilsonInterval {
    readonly lower: number;
    readonly upper: number;
}

/**
 * Selection agreement between the Jev system and a baseline system.
 *
 * NOTE: agreement is NOT accuracy. It counts how often two systems made the
 * identical selection; it says nothing about whether either selection is
 * correct against the corpus labels.
 */
export interface JevBaselineComparison {
    readonly comparableCount: number;
    readonly agreedCount: number;
    readonly disagreedCount: number;
}

/** Metrics for one aggregation level (a decision kind, or the overall corpus). */
export interface JevLevelMetrics extends Omit<JevKindMetrics, "decisionKind"> {
    readonly baselineComparison: JevBaselineComparison | null;
}

export interface JevMetricsRow extends JevLevelMetrics {
    readonly decisionKind: DecisionKind;
}

export interface EvaluationReport {
    readonly questionVersion: string;
    readonly datasetDigest: string;
    readonly overall: JevLevelMetrics;
    readonly byKind: Readonly<Record<DecisionKind, JevMetricsRow>>;
}

const WILSON_Z_95 = 1.959963984540054; // two-sided 95% standard normal quantile

/**
 * Wilson score interval for a binomial proportion. Returns null when there is
 * no accepted denominator — an empty interval would imply knowledge the data
 * does not contain.
 */
export function wilsonInterval95(successes: number, trials: number): JevWilsonInterval | null {
    if (trials <= 0) return null;
    const p = successes / trials;
    const z2 = WILSON_Z_95 * WILSON_Z_95;
    const denom = 1 + z2 / trials;
    const center = (p + z2 / (2 * trials)) / denom;
    const spread = (WILSON_Z_95 / denom)
        * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
    return {
        lower: Math.max(0, center - spread),
        upper: Math.min(1, center + spread),
    };
}

/**
 * Deterministic evaluation report over a parsed corpus. Rejects an empty
 * corpus, malformed or unknown-id predictions, and duplicate predictions.
 */
export function computeEvaluationReport(
    corpus: JevCorpus,
    predictions: readonly JevPrediction[],
    baselinePredictions?: readonly JevPrediction[],
): EvaluationReport {
    if (corpus.cases.length === 0) {
        throw new JevEvaluationError("empty-corpus", "Corpus must contain at least one labeled case");
    }
    const jevByCase = indexPredictions(predictions, corpus);
    const baselineByCase = baselinePredictions === undefined
        ? null
        : indexPredictions(baselinePredictions, corpus);

    const kinds = Object.values(DECISION_KINDS);
    const byKind = {} as Record<DecisionKind, JevMetricsRow>;
    for (const kind of kinds) {
        byKind[kind] = {
            decisionKind: kind,
            ...measure(
                corpus.cases.filter((item) => item.decisionKind === kind),
                jevByCase,
                baselineByCase,
            ),
        };
    }
    const overall = measure(corpus.cases, jevByCase, baselineByCase);

    return {
        questionVersion: corpus.questionVersion,
        datasetDigest: corpus.datasetDigest,
        overall,
        byKind,
    };
}

function measure(
    cases: readonly JevCase[],
    jevByCase: ReadonlyMap<string, JevPrediction>,
    baselineByCase: ReadonlyMap<string, JevPrediction> | null,
): JevLevelMetrics {
    let evaluated = 0;
    let accepted = 0;
    let abstained = 0;
    let unavailable = 0;
    let missing = 0;
    let correct = 0;
    let comparable = 0;
    let agreed = 0;

    for (const item of cases) {
        const prediction = jevByCase.get(item.id);
        if (prediction === undefined) {
            missing += 1;
            continue;
        }
        evaluated += 1;
        if (prediction.status === DECISION_STATUSES.accepted) {
            accepted += 1;
            if (prediction.selection !== null && item.acceptable.includes(prediction.selection)) {
                correct += 1;
            }
        } else if (prediction.status === DECISION_STATUSES.abstain) {
            abstained += 1;
        } else if (prediction.status === DECISION_STATUSES.unavailable) {
            unavailable += 1;
        }
        if (baselineByCase !== null) {
            const baseline = baselineByCase.get(item.id);
            if (baseline !== undefined) {
                comparable += 1;
                if (baseline.selection === prediction.selection) agreed += 1;
            }
        }
    }

    return {
        labeledCount: cases.length,
        evaluatedCount: evaluated,
        acceptedCount: accepted,
        abstainedCount: abstained,
        unavailableCount: unavailable,
        missingPredictionCount: missing,
        correctCount: correct,
        precision: accepted === 0 ? null : correct / accepted,
        coverage: cases.length === 0 ? null : accepted / cases.length,
        abstentionRate: evaluated === 0 ? null : abstained / evaluated,
        precisionWilson95: accepted === 0 ? null : wilsonInterval95(correct, accepted),
        baselineComparison: baselineByCase === null
            ? null
            : { comparableCount: comparable, agreedCount: agreed, disagreedCount: comparable - agreed },
    };
}

function indexPredictions(
    predictions: readonly JevPrediction[],
    corpus: JevCorpus,
): ReadonlyMap<string, JevPrediction> {
    if (!Array.isArray(predictions)) {
        throw predictionError("Predictions must be an array", null);
    }
    const knownIds = new Set(corpus.cases.map((item) => item.id));
    const byCase = new Map<string, JevPrediction>();
    for (const prediction of predictions) {
        if (!isPlainObject(prediction)) {
            throw predictionError("Each prediction must be a JSON object", null);
        }
        for (const key of Object.keys(prediction)) {
            if (!PREDICTION_KEYS.includes(key)) {
                throw predictionError(`Unknown prediction key "${key}"`, null);
            }
        }
        const caseId = prediction["caseId"];
        if (typeof caseId !== "string" || caseId.length === 0) {
            throw predictionError("Prediction field \"caseId\" must be a non-empty string", null);
        }
        if (byCase.has(caseId)) {
            throw predictionError(`Duplicate prediction for case "${caseId}"`, caseId);
        }
        if (!knownIds.has(caseId)) {
            throw predictionError(`Prediction references unknown case "${caseId}"`, caseId);
        }
        const status = prediction["status"];
        if (typeof status !== "string" || !PREDICTION_STATUS_VALUES.includes(status as DecisionStatus)) {
            throw predictionError(
                `Prediction for case "${caseId}" has status "${String(status)}"; must be one of: `
                + PREDICTION_STATUS_VALUES.join(", "),
                caseId,
            );
        }
        if (status === NON_EVALUATED_STATUS) {
            throw predictionError(
                `Prediction for case "${caseId}" carries trace-only status "${NON_EVALUATED_STATUS}"`,
                caseId,
            );
        }
        const selection = prediction["selection"];
        if (selection !== null && typeof selection !== "string") {
            throw predictionError(
                `Prediction for case "${caseId}" field "selection" must be a string or null`,
                caseId,
            );
        }
        if (status === DECISION_STATUSES.accepted && selection === null) {
            throw predictionError(
                `Prediction for case "${caseId}" is accepted but has no selection`,
                caseId,
            );
        }
        if (status !== DECISION_STATUSES.accepted && selection !== null) {
            throw predictionError(
                `Prediction for case "${caseId}" has status "${status}" but carries a selection; `
                + "a selection is only valid with status \"accepted\"",
                caseId,
            );
        }
        byCase.set(caseId, {
            caseId,
            status: status as DecisionStatus,
            selection: selection as string | null,
        });
    }
    return byCase;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
    readonly input: string;
    readonly predictions: string | null;
    readonly out: string | null;
}

const USAGE = [
    "Usage: ts-node scripts/agent/jev-evaluation.ts --input=<corpus.json> [--predictions=<file>] [--out=<file>]",
    "",
    "Offline evaluation tooling for the Jev semantic decision layer.",
    "Without --predictions the corpus is validated and the dataset digest plus",
    "scenario-leakage findings are printed. With --predictions the evaluation",
    "report JSON is printed (or written to --out). The --predictions file must be",
    "a JSON object with a required \"questionVersion\" field (must equal the",
    "corpus's questionVersion) and a required \"predictions\" array; a file that",
    "cannot say which question version it was produced against is refused.",
    "Exits non-zero on an invalid corpus, scenario leakage, or missing predictions.",
].join("\n");

function parseCliArgs(argv: readonly string[]): CliOptions {
    let input: string | null = null;
    let predictions: string | null = null;
    let out: string | null = null;
    for (const arg of argv) {
        const match = /^(--input|--predictions|--out)=(.+)$/.exec(arg);
        if (match === null) {
            throw new Error(`Unrecognized argument "${arg}"\n\n${USAGE}`);
        }
        const flag = match[1] ?? "";
        const value = match[2] ?? "";
        if (flag === "--input") {
            if (input !== null) throw new Error("--input supplied more than once");
            input = value;
        } else if (flag === "--predictions") {
            if (predictions !== null) throw new Error("--predictions supplied more than once");
            predictions = value;
        } else {
            if (out !== null) throw new Error("--out supplied more than once");
            out = value;
        }
    }
    if (input === null) throw new Error(`--input is required\n\n${USAGE}`);
    return { input, predictions, out };
}

function readJsonFile(path: string, description: string): unknown {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`Failed to read ${description} at "${path}": ${(error as Error).message}`);
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch (error) {
        throw new Error(`${description} at "${path}" is not valid JSON: ${(error as Error).message}`);
    }
}

/**
 * Parses and validates a `--predictions` CLI input file. The file must
 * declare which question version it was produced against: a predictions
 * file that cannot say which questions produced it is refused rather than
 * silently relabeled as current (computeEvaluationReport stamps every
 * report with the corpus's questionVersion regardless of the predictions'
 * real provenance, so this is the only place that provenance can be
 * checked).
 */
export function parsePredictionsFile(raw: unknown, corpus: JevCorpus): JevPrediction[] {
    if (!isPlainObject(raw)) {
        throw new JevEvaluationError("invalid-predictions", "Predictions file root must be a JSON object");
    }
    for (const key of Object.keys(raw)) {
        if (!PREDICTIONS_FILE_KEYS.includes(key)) {
            throw new JevEvaluationError("invalid-predictions", `Unknown predictions file key "${key}"`);
        }
    }
    for (const key of PREDICTIONS_FILE_KEYS) {
        if (!(key in raw)) {
            throw new JevEvaluationError(
                "invalid-predictions",
                `Predictions file is missing required key "${key}"`,
            );
        }
    }
    const questionVersion = raw["questionVersion"];
    if (typeof questionVersion !== "string" || questionVersion.trim().length === 0) {
        throw new JevEvaluationError(
            "invalid-predictions",
            'Predictions file field "questionVersion" must be a non-empty string',
        );
    }
    if (questionVersion !== corpus.questionVersion) {
        throw new JevEvaluationError(
            "invalid-predictions",
            `Predictions file questionVersion "${questionVersion}" does not match the corpus questionVersion `
            + `"${corpus.questionVersion}"; the predictions must be regenerated at the current question version`,
        );
    }
    const predictions = raw["predictions"];
    if (!Array.isArray(predictions)) {
        throw new JevEvaluationError(
            "invalid-predictions",
            'Predictions file field "predictions" must be an array',
        );
    }
    return predictions as JevPrediction[];
}

function runCli(argv: readonly string[]): void {
    const options = parseCliArgs(argv);

    const parsedCorpus = parseJevCorpus(readJsonFile(options.input, "corpus file"));
    const leakage = detectScenarioLeakage(parsedCorpus);

    if (options.predictions === null) {
        const splitCounts: Record<string, number> = {};
        const kindCounts: Record<string, number> = {};
        for (const item of parsedCorpus.cases) {
            splitCounts[item.split] = (splitCounts[item.split] ?? 0) + 1;
            kindCounts[item.decisionKind] = (kindCounts[item.decisionKind] ?? 0) + 1;
        }
        const summary = {
            questionVersion: parsedCorpus.questionVersion,
            datasetDigest: parsedCorpus.datasetDigest,
            caseCount: parsedCorpus.cases.length,
            splitCounts,
            kindCounts,
            scenarioLeakage: leakage,
        };
        console.log(JSON.stringify(summary, null, 2));
        if (leakage.length > 0) {
            console.error(`Scenario leakage detected across splits: ${leakage.join(", ")}`);
            process.exitCode = 1;
        }
        return;
    }

    const predictionsRaw = readJsonFile(options.predictions, "predictions file");
    const predictions = parsePredictionsFile(predictionsRaw, parsedCorpus);

    const report = computeEvaluationReport(parsedCorpus, predictions);
    const reportJson = JSON.stringify(report, null, 2);
    if (options.out !== null) {
        writeFileSync(options.out, `${reportJson}\n`, "utf8");
        console.log(`Evaluation report written to ${options.out}`);
    } else {
        console.log(reportJson);
    }

    if (leakage.length > 0) {
        console.error(`Scenario leakage detected across splits: ${leakage.join(", ")}`);
        process.exitCode = 1;
        return;
    }
    if (report.overall.missingPredictionCount > 0) {
        console.error(
            `Missing predictions for ${report.overall.missingPredictionCount} labeled case(s); `
            + "a report with missing labels is not a valid release input",
        );
        process.exitCode = 1;
    }
}

if (require.main === module) {
    try {
        runCli(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
