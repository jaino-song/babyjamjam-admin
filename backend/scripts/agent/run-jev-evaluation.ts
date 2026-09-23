/**
 * Jev evaluation runner: connects the offline evaluation tooling (Task 3.2)
 * and the production decision adapter to a single report-producing CLI.
 *
 * Usage:
 *   ts-node scripts/agent/run-jev-evaluation.ts --mode=fixture|live \
 *     --input=<corpus.json> --output=<report.json> \
 *     [--model=<pinned-id>] [--max-cases=<n>] [--consent=live-provider-call] \
 *     [--evidence-out=<evidence.json> --attestation=<attestation.json>]
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
 * Evidence bridge: passing --evidence-out together with --attestation makes
 * the CLI additionally emit a readiness-evidence document with schema
 * "jev-evidence-v1" (the contract check-jev-readiness.ts validates). The
 * conversion is offline — no provider call and no network access — and maps
 * per-kind raw counts and metric numerator/denominator triples from the
 * report's computed metrics only; it never invents a value. The facts a
 * synthetic corpus cannot provide (that the holdout split was genuinely held
 * out, the human-reviewed reference size, and the per-kind human-reference
 * comparison counts) come exclusively from the operator-authored attestation
 * file (schema "jev-attestation-v1", author + date fields included). A
 * missing, incomplete, or mismatched attestation is a precise non-zero
 * refusal; the evidence document carries no credentials, no raw text, and no
 * per-case data, and the evaluation report itself is unchanged. Fixture-mode
 * evidence contains no evaluated cases, so its zero metric denominators can
 * never pass the readiness gate — it satisfies the document format only.
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
    EVIDENCE_REPORT_SCHEMA_VERSION,
    type RequiredMetric,
} from "./check-jev-readiness";
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
export const LIVE_DEADLINE_MS = 5000;

/**
 * Pure per-case deadline computation, isolated so a test can assert the
 * live-mode deadline is actually bounded to `now + LIVE_DEADLINE_MS` (a
 * finite, near-term wall-clock budget) rather than an effectively-infinite
 * value — a mutation on the call site below would otherwise pass every
 * existing test undetected.
 */
export function computeLiveDeadline(now: number): number {
    return now + LIVE_DEADLINE_MS;
}
/** Fixed choice-set revision token for rank-candidates evaluation requests. */
const EVAL_CHOICE_SET_REVISION = "jev-eval-v1";
/** Deterministic placeholder candidate for rank-candidates evaluation. */
const EVAL_PLACEHOLDER_CANDIDATE = "candidate-1";
/** Binarization threshold for the clarification outcome (evaluation convention). */
export const CLARIFICATION_BINARIZATION_THRESHOLD = 0.5;
/** Schema version of the operator-authored attestation consumed by the evidence bridge. */
export const ATTESTATION_SCHEMA_VERSION = "jev-attestation-v1";

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
// Evidence bridge types (report + operator attestation → jev-evidence-v1)
// ---------------------------------------------------------------------------

/** One holdout/human-reference presence attestation. */
export interface JevAttestationSplit {
    readonly present: boolean;
    readonly caseCount: number;
}

/** Operator-attested human-reference comparison counts for one decision kind. */
export interface JevAttestationComparison {
    readonly comparableCount: number;
    readonly agreedCount: number;
}

/**
 * The operator-authored facts the tooling cannot derive from a synthetic
 * corpus: that the holdout split was genuinely held out, the size of the
 * human-reviewed reference set, and the per-kind human-reference comparison
 * counts — signed by an author and a date. Never produced by the tooling.
 */
export interface JevAttestation {
    readonly schemaVersion: typeof ATTESTATION_SCHEMA_VERSION;
    readonly attestedBy: string;
    /** ISO date (YYYY-MM-DD) of the attestation. */
    readonly attestedAt: string;
    readonly modelId: string;
    readonly holdoutSplit: JevAttestationSplit;
    readonly humanReference: JevAttestationSplit;
    readonly humanReferenceComparisons: Readonly<Record<DecisionKind, JevAttestationComparison>>;
    readonly notes: string | null;
}

/**
 * Metric triple exactly as the readiness checker validates it: integer
 * numerator/denominator plus the ratio value. When the denominator is zero
 * the report computed no value, so `value` is honestly absent — the checker
 * blocks a zero denominator by design.
 */
export interface JevEvidenceMetricTriple {
    readonly numerator: number;
    readonly denominator: number;
    readonly value?: number;
}

export interface JevEvidenceKindEntry {
    readonly decisionKind: DecisionKind;
    readonly rawCounts: {
        readonly labeledCount: number;
        readonly evaluatedCount: number;
        readonly acceptedCount: number;
        readonly abstainedCount: number;
        readonly unavailableCount: number;
        readonly missingPredictionCount: number;
        readonly correctCount: number;
        readonly humanReferenceComparisons: {
            readonly comparableCount: number;
            readonly agreedCount: number;
        };
    };
    readonly metrics: Readonly<Record<RequiredMetric, JevEvidenceMetricTriple>>;
    readonly holdoutSplit: JevAttestationSplit;
    readonly humanReference: JevAttestationSplit;
}

/** The readiness-evidence document: exactly the contract check-jev-readiness.ts parses. */
export interface JevEvidenceDocument {
    readonly schemaVersion: typeof EVIDENCE_REPORT_SCHEMA_VERSION;
    readonly modelId: string;
    readonly questionVersion: string;
    readonly datasetDigest: string;
    readonly notes: string;
    readonly kinds: readonly JevEvidenceKindEntry[];
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
    /** Write a jev-evidence-v1 readiness-evidence document to this path. Requires attestation. */
    readonly evidenceOut?: string;
    /** Operator-authored attestation file consumed only by the evidence bridge. */
    readonly attestation?: string;
    /** Environment consulted for TYPESAFE_API_KEY / TYPESAFE_BASE_URL. */
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Test seam: transport override handed to the production adapter. */
    readonly fetchImpl?: Fetch;
    /** Test seam: clock for report timestamps (generatedAt) only. Live-mode
     *  per-case deadlines always derive from the real wall clock
     *  (Date.now()), the same clock the production adapter checks them
     *  against. */
    readonly now?: () => Date;
}

export type JevRunResult =
    | {
        readonly ok: true;
        readonly exitCode: 0;
        readonly reportPath: string;
        readonly report: JevRunReport;
        /** Evidence document path when --evidence-out was requested, else null. */
        readonly evidencePath: string | null;
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
// Evidence bridge: attestation loading + report → jev-evidence-v1 conversion
// ---------------------------------------------------------------------------

function attestationInvalid(message: string): JevRunRefusal {
    return refusal("attestation-invalid", message);
}

function requireAttestationNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw attestationInvalid(`Attestation field "${field}" must be a non-empty string`);
    }
    return value;
}

function requireAttestationNonNegativeInt(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw attestationInvalid(`Attestation field "${field}" must be a non-negative integer`);
    }
    return value;
}

/** Rejects unknown keys; missing keys are reported by the caller's checks. */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            throw attestationInvalid(`Unknown ${what} key "${key}"`);
        }
    }
}

function requireAttestationSplit(value: unknown, field: string): JevAttestationSplit {
    if (!isPlainObject(value)) {
        throw attestationInvalid(`Attestation field "${field}" must be a JSON object`);
    }
    rejectUnknownKeys(value, ["caseCount", "present"], field);
    if (!("present" in value)) {
        throw attestationInvalid(`Attestation ${field} is missing required key "present"`);
    }
    if (!("caseCount" in value)) {
        throw attestationInvalid(`Attestation ${field} is missing required key "caseCount"`);
    }
    const present = value["present"];
    if (typeof present !== "boolean") {
        throw attestationInvalid(`Attestation field "${field}.present" must be a boolean`);
    }
    const caseCount = requireAttestationNonNegativeInt(value["caseCount"], `${field}.caseCount`);
    // A presence claim and its count must agree: "present with zero cases"
    // and "absent but counted" are both incoherent attestations.
    if (present && caseCount === 0) {
        throw attestationInvalid(
            `Attestation field "${field}" declares present: true but caseCount 0; a present split `
            + "must carry a positive case count",
        );
    }
    if (!present && caseCount !== 0) {
        throw attestationInvalid(
            `Attestation field "${field}" declares present: false but caseCount ${caseCount}; `
            + "an absent split must carry caseCount 0",
        );
    }
    return { caseCount, present };
}

function requireAttestationComparisons(
    value: unknown,
): Readonly<Record<DecisionKind, JevAttestationComparison>> {
    if (!isPlainObject(value)) {
        throw attestationInvalid('Attestation field "humanReferenceComparisons" must be a JSON object');
    }
    rejectUnknownKeys(value, KIND_VALUES as readonly string[], "attestation humanReferenceComparisons");
    const result = {} as Record<DecisionKind, JevAttestationComparison>;
    for (const kind of KIND_VALUES) {
        const entry = value[kind];
        if (!isPlainObject(entry)) {
            throw attestationInvalid(
                `Attestation humanReferenceComparisons is missing the entry for decision kind "${kind}"`,
            );
        }
        rejectUnknownKeys(entry, ["agreedCount", "comparableCount"], `humanReferenceComparisons.${kind}`);
        const comparableCount = requireAttestationNonNegativeInt(
            entry["comparableCount"],
            `humanReferenceComparisons.${kind}.comparableCount`,
        );
        const agreedCount = requireAttestationNonNegativeInt(
            entry["agreedCount"],
            `humanReferenceComparisons.${kind}.agreedCount`,
        );
        if (agreedCount > comparableCount) {
            throw attestationInvalid(
                `Attestation humanReferenceComparisons.${kind}: agreedCount (${agreedCount}) exceeds `
                + `comparableCount (${comparableCount})`,
            );
        }
        result[kind] = { comparableCount, agreedCount };
    }
    return result;
}

/**
 * Parses and validates the operator-authored attestation document. Strictly
 * fail-closed: unknown keys, missing fields, wrong types, or incoherent
 * presence/count pairs are precise non-zero refusals. This validation never
 * consults the report — report-dependent cross-checks run at conversion time.
 */
export function parseAttestation(raw: unknown): JevAttestation {
    if (!isPlainObject(raw)) {
        throw attestationInvalid("Attestation root must be a JSON object");
    }
    const allowedKeys = [
        "attestedAt",
        "attestedBy",
        "holdoutSplit",
        "humanReference",
        "humanReferenceComparisons",
        "modelId",
        "notes",
        "schemaVersion",
    ];
    rejectUnknownKeys(raw, allowedKeys, "attestation");
    for (const key of ["schemaVersion", "attestedBy", "attestedAt", "modelId", "holdoutSplit", "humanReference", "humanReferenceComparisons"]) {
        if (!(key in raw)) {
            throw attestationInvalid(`Attestation is missing required key "${key}"`);
        }
    }
    const schemaVersion = requireAttestationNonEmptyString(raw["schemaVersion"], "schemaVersion");
    if (schemaVersion !== ATTESTATION_SCHEMA_VERSION) {
        throw attestationInvalid(
            `Attestation field "schemaVersion" must be "${ATTESTATION_SCHEMA_VERSION}", got "${schemaVersion}"`,
        );
    }
    const attestedBy = requireAttestationNonEmptyString(raw["attestedBy"], "attestedBy");
    const attestedAt = requireAttestationNonEmptyString(raw["attestedAt"], "attestedAt");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attestedAt)) {
        throw attestationInvalid(`Attestation field "attestedAt" must be an ISO date (YYYY-MM-DD), got "${attestedAt}"`);
    }
    const modelId = requireAttestationNonEmptyString(raw["modelId"], "modelId");
    const holdoutSplit = requireAttestationSplit(raw["holdoutSplit"], "holdoutSplit");
    const humanReference = requireAttestationSplit(raw["humanReference"], "humanReference");
    const humanReferenceComparisons = requireAttestationComparisons(raw["humanReferenceComparisons"]);
    const notes = "notes" in raw
        ? requireAttestationNonEmptyString(raw["notes"], "notes")
        : null;
    return {
        attestedAt,
        attestedBy,
        holdoutSplit,
        humanReference,
        humanReferenceComparisons,
        modelId,
        notes,
        schemaVersion: ATTESTATION_SCHEMA_VERSION,
    };
}

/** Loads and validates the attestation file for the evidence bridge. */
function loadAttestation(path: string): JevAttestation {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (error) {
        throw refusal(
            "attestation-unreadable",
            `Failed to read attestation file at "${path}": ${(error as Error).message}`,
        );
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw) as unknown;
    } catch (error) {
        throw attestationInvalid(`Attestation file at "${path}" is not valid JSON: ${(error as Error).message}`);
    }
    return parseAttestation(parsed);
}

/**
 * Converts a metric into the checker's numerator/denominator/value triple.
 * The counts are the report's real counts; the value is the report's computed
 * ratio. A zero denominator has no value — the report computed null there and
 * the readiness checker blocks zero denominators by design, so such a triple
 * can never enable anything.
 */
function evidenceMetricTriple(numerator: number, denominator: number, value: number | null): JevEvidenceMetricTriple {
    if (denominator === 0) {
        return { denominator, numerator };
    }
    if (value === null) {
        // Unreachable by the report's own math (a metric is null exactly when
        // its denominator is zero); guarded so a value is never fabricated.
        throw refusal(
            "evidence-internal",
            `Evaluation report computed no value for a metric with denominator ${denominator}`,
        );
    }
    return { denominator, numerator, value };
}

/**
 * Pure offline conversion of an evaluation report plus a validated operator
 * attestation into the jev-evidence-v1 document check-jev-readiness.ts
 * validates. Every number is mapped from the report's computed metrics or the
 * attestation — nothing is invented. Cross-checks refuse (precise, non-zero)
 * when the attestation does not describe this exact report.
 */
export function buildEvidenceDocument(report: JevRunReport, attestation: JevAttestation): JevEvidenceDocument {
    // The evidence must describe the run it was derived from. Fixture mode
    // runs no model (report.model is null), so the attestation's model id
    // stands in — it is the operator's declaration of what the bundle is for.
    if (report.model !== null && report.model !== attestation.modelId) {
        throw refusal(
            "attestation-mismatch",
            `Attestation modelId "${attestation.modelId}" does not match the evaluated model `
            + `"${report.model}"; the attestation must describe this exact evaluation run`,
        );
    }

    // Holdout attestation must agree with the report's own split counts.
    const reportHoldoutCount = report.summary.corpus.bySplit["holdout"] ?? 0;
    if (attestation.holdoutSplit.present && attestation.holdoutSplit.caseCount !== reportHoldoutCount) {
        throw refusal(
            "attestation-mismatch",
            `Attestation declares ${attestation.holdoutSplit.caseCount} holdout case(s) but the evaluation `
            + `report counted ${reportHoldoutCount} (split "holdout"); re-author the attestation for this `
            + "report (truncated --max-cases runs count only their selected cases)",
        );
    }
    const evidenceHoldout: JevAttestationSplit = attestation.holdoutSplit.present
        ? { caseCount: reportHoldoutCount, present: true }
        : { caseCount: 0, present: false };

    const kinds: JevEvidenceKindEntry[] = Object.values(DECISION_KINDS).map((kind) => {
        const row: JevMetricsRow = report.summary.byKind[kind];
        const comparisons: JevAttestationComparison = attestation.humanReferenceComparisons[kind];
        if (comparisons.comparableCount > row.evaluatedCount) {
            throw refusal(
                "attestation-mismatch",
                `Attestation declares ${comparisons.comparableCount} comparable human-reference `
                + `comparison(s) for decision kind "${kind}" but the report evaluated only `
                + `${row.evaluatedCount} case(s) of that kind; a case without a prediction cannot be compared`,
            );
        }
        if (comparisons.comparableCount > attestation.humanReference.caseCount) {
            throw refusal(
                "attestation-mismatch",
                `Attestation declares ${comparisons.comparableCount} comparable human-reference `
                + `comparison(s) for decision kind "${kind}" but only `
                + `${attestation.humanReference.caseCount} human-reviewed reference case(s) are attested`,
            );
        }
        const agreementValue = comparisons.comparableCount === 0
            ? null
            : comparisons.agreedCount / comparisons.comparableCount;
        return {
            decisionKind: kind,
            holdoutSplit: evidenceHoldout,
            humanReference: { ...attestation.humanReference },
            metrics: {
                abstentionRate: evidenceMetricTriple(
                    row.abstainedCount,
                    row.evaluatedCount,
                    row.abstentionRate,
                ),
                agreement: evidenceMetricTriple(
                    comparisons.agreedCount,
                    comparisons.comparableCount,
                    agreementValue,
                ),
                coverage: evidenceMetricTriple(row.acceptedCount, row.labeledCount, row.coverage),
                precision: evidenceMetricTriple(row.correctCount, row.acceptedCount, row.precision),
            },
            rawCounts: {
                acceptedCount: row.acceptedCount,
                abstainedCount: row.abstainedCount,
                correctCount: row.correctCount,
                evaluatedCount: row.evaluatedCount,
                humanReferenceComparisons: {
                    agreedCount: comparisons.agreedCount,
                    comparableCount: comparisons.comparableCount,
                },
                labeledCount: row.labeledCount,
                missingPredictionCount: row.missingPredictionCount,
                unavailableCount: row.unavailableCount,
            },
        };
    });

    // Tool-composed provenance note only: the attestation's free-form notes are
    // deliberately not copied, so the evidence document stays free of unvetted
    // operator text. It contains counts, tokens, and the attestation identity.
    const predictedCount = Object.values(report.summary.byKind)
        .reduce((sum, row) => sum + row.evaluatedCount, 0);
    const notes = `Produced offline by run-jev-evaluation.ts from the ${report.mode} evaluation report `
        + `(dataset ${report.datasetDigest}; ${report.evaluatedCaseCount} of ${report.datasetCaseCount} `
        + `corpus cases in the run, ${predictedCount} with model predictions). The holdout-split and `
        + `human-reference facts are operator attestations by ${attestation.attestedBy} dated `
        + `${attestation.attestedAt}; the tooling cannot derive them from a synthetic corpus. `
        + "Synthetic fixtures satisfy the document format only — real human-reference evidence "
        + "requires a human-reviewed evaluation set.";

    return {
        datasetDigest: report.datasetDigest,
        kinds,
        modelId: report.model ?? attestation.modelId,
        notes,
        questionVersion: report.summary.questionVersion,
        schemaVersion: EVIDENCE_REPORT_SCHEMA_VERSION,
    };
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
): Promise<LiveCaseOutcome> {
    // Deadline must be computed on the same clock the adapter checks it
    // against (Date.now()), never the test-injected report clock — the
    // adapter always compares deadlineAt to the real wall clock, so a
    // deadline derived from an injected `now` can silently expire before
    // any request is made once wall time drifts from the injected value.
    const deadlineAt = computeLiveDeadline(Date.now());
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
    // The evidence bridge is all-or-nothing: an evidence document can only be
    // derived from an operator-authored attestation, and an attestation without
    // an evidence destination has nothing to produce.
    const evidenceOut = options.evidenceOut ?? null;
    const attestationPath = options.attestation ?? null;
    if (evidenceOut !== null && attestationPath === null) {
        throw refusal(
            "evidence-out-requires-attestation",
            "--evidence-out requires --attestation=<file>; the evidence document is derived from an "
            + "operator-authored attestation, never synthesized from the report alone",
        );
    }
    if (attestationPath !== null && evidenceOut === null) {
        throw refusal(
            "attestation-requires-evidence-out",
            "--attestation requires --evidence-out=<path>; pass both flags together",
        );
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

    // Validate the attestation before any mode executes, so a bad attestation
    // can never waste a live run (and in fixture mode keeps the whole command
    // offline-fail-fast). Report-dependent cross-checks run at conversion time.
    const attestation = attestationPath === null ? null : loadAttestation(attestationPath);
    // A live run whose attestation names a different model is refused before
    // any provider call; buildEvidenceDocument re-checks against the report
    // (fixture reports carry no model, so there the attestation id stands in).
    if (attestation !== null && mode === "live" && attestation.modelId !== model) {
        throw refusal(
            "attestation-mismatch",
            `Attestation modelId "${attestation.modelId}" does not match the evaluated model `
            + `"${model}"; the attestation must describe this exact evaluation run`,
        );
    }

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
            const outcome = await runLiveCase(service, item, domains);
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

    // Evidence bridge: pure offline conversion from the built report plus the
    // already-validated attestation. The report above is unchanged; the
    // evidence document carries counts and tokens only.
    let evidencePath: string | null = null;
    if (evidenceOut !== null && attestation !== null) {
        const evidence = buildEvidenceDocument(report, attestation);
        evidencePath = resolve(evidenceOut);
        mkdirSync(dirname(evidencePath), { recursive: true });
        writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }

    const leakage = report.summary.corpus.scenarioLeakage;
    if (leakage.length > 0) {
        console.error(`Scenario leakage detected across splits: ${leakage.join(", ")}`);
    }

    return { evidencePath, exitCode: 0, ok: true, report, reportPath: outputPath };
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
    "       [--evidence-out=<evidence.json> --attestation=<attestation.json>]",
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
    "",
    "Evidence bridge: pass --evidence-out together with --attestation to also",
    'emit a readiness-evidence document (schema "jev-evidence-v1") derived',
    "offline from the report. The attestation is an operator-authored JSON",
    `file (schema "${ATTESTATION_SCHEMA_VERSION}") carrying the facts a`,
    "synthetic corpus cannot provide: the holdout split, the human-reviewed",
    "reference count, the per-kind human-reference comparison counts, and an",
    "author/date. The conversion never invents values and refuses (non-zero)",
    "on a missing, incomplete, or mismatched attestation. Fixture-mode",
    "evidence has no evaluated cases and can never pass the readiness gate;",
    "it satisfies the document format only.",
].join("\n");

interface CliArgs {
    readonly mode: "fixture" | "live";
    readonly input: string;
    readonly output: string;
    readonly model?: string;
    readonly maxCases?: number;
    readonly consent?: string;
    readonly evidenceOut?: string;
    readonly attestation?: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
    let mode: "fixture" | "live" = "fixture";
    let input: string | null = null;
    let output: string | null = null;
    let model: string | undefined;
    let maxCases: number | undefined;
    let consent: string | undefined;
    let evidenceOut: string | undefined;
    let attestation: string | undefined;

    for (const arg of argv) {
        const match = /^(--mode|--input|--output|--model|--max-cases|--consent|--evidence-out|--attestation)=(.+)$/.exec(arg);
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
            case "--evidence-out":
                if (evidenceOut !== undefined) throw new Error("--evidence-out supplied more than once");
                evidenceOut = value;
                break;
            case "--attestation":
                if (attestation !== undefined) throw new Error("--attestation supplied more than once");
                attestation = value;
                break;
        }
    }
    if (input === null) throw new Error(`--input is required\n\n${USAGE}`);
    if (output === null) throw new Error(`--output is required\n\n${USAGE}`);
    return { mode, input, output, model, maxCases, consent, evidenceOut, attestation };
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
                if (result.evidencePath !== null) {
                    console.log(
                        `Jev evidence document (${EVIDENCE_REPORT_SCHEMA_VERSION}) written to ${result.evidencePath}`,
                    );
                }
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
