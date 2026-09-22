/**
 * Jev release-readiness checker (Task 9.2).
 *
 * Deterministic, offline, read-only gate evaluation for the Jev semantic
 * decision layer. It validates a versioned release profile against an
 * optional evaluation-evidence report and produces a versioned readiness
 * result. It validates and reports ONLY: it never changes settings, never
 * touches a database, never performs a network call, never merges or deploys,
 * and never flips a runtime mode. Enabling enforcement stays a separate
 * operator action — a JSON approval reference is metadata, not authority.
 *
 * Usage:
 *   ts-node scripts/agent/check-jev-readiness.ts --profile=../evals/agent/jev/release-profile-v1.json [--evidence=<report.json>]
 *
 * Inputs:
 *   --profile   (required) release profile document, schema "jev-release-profile-v1"
 *   --evidence  (optional) evaluation-evidence report, schema "jev-evidence-v1",
 *               produced by the offline evaluation tooling (jev-evaluation.ts
 *               foundation + the Task 9.1 live-run wrapper)
 *
 * Output: one JSON document on stdout:
 *   { schemaVersion, ready, profileVersion, checkedAt, reasons[] }
 * Exit code is 0 only when ready is true; a non-zero exit on a draft/off
 * profile is the designed fail-closed outcome, not a tool failure.
 *
 * Evidence contract (schema "jev-evidence-v1"): each decision kind carries
 * raw counts AND per-metric { numerator, denominator, value } triples. The
 * redundancy is deliberate — a report that claims a bare percentage without
 * its counts is not acceptable release evidence, and every reported ratio is
 * recomputed here from the counts so the two can never quietly disagree.
 *
 * The file system is read-only: only readFileSync is imported, results are
 * printed to stdout, and nothing is ever written.
 */
import { readFileSync } from "node:fs";

import {
    DECISION_KINDS,
    type DecisionKind,
} from "../../application/agent/decision/decision-contracts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const READINESS_RESULT_SCHEMA_VERSION = "jev-readiness-result-v1";
export const RELEASE_PROFILE_SCHEMA_VERSION = "jev-release-profile-v1";
export const EVIDENCE_REPORT_SCHEMA_VERSION = "jev-evidence-v1";

/** Closed rollout-scope vocabulary. A wildcard or unknown scope never passes. */
export const ALLOWED_APPROVED_SCOPES = ["branch", "internal"] as const;

/** Every metric a release profile must be evaluated against, in check order. */
export const REQUIRED_METRICS = ["coverage", "abstentionRate", "precision", "agreement"] as const;
export type RequiredMetric = (typeof REQUIRED_METRICS)[number];

/**
 * Reserved approval-reference prefixes. A reference starting with any of
 * these (case-insensitive, after trimming) is a placeholder, never an
 * approval. Enforcement requested while the reference is a placeholder
 * blocks.
 */
export const PLACEHOLDER_APPROVAL_PREFIXES = ["pending:", "not-approved:", "placeholder", "tbd"] as const;

/** Machine-token reasons. The detail field carries the human explanation. */
export const READINESS_REASONS = {
    profileInvalid: "profile-invalid",
    evidenceMissing: "evidence-missing",
    evidenceInvalid: "evidence-invalid",
    evidenceModelMismatch: "evidence-model-mismatch",
    evidenceQuestionVersionMismatch: "evidence-question-version-mismatch",
    evidenceDatasetDigestMismatch: "evidence-dataset-digest-mismatch",
    evidenceKindMismatch: "evidence-kind-mismatch",
    metricDenominatorMissing: "metric-denominator-missing",
    metricDenominatorZero: "metric-denominator-zero",
    metricValueDisagreement: "metric-value-disagreement",
    metricCountsDisagreement: "metric-counts-disagreement",
    rawCountsInconsistent: "raw-counts-inconsistent",
    coverageBelowFloor: "coverage-below-floor",
    agreementBelowFloor: "agreement-below-floor",
    abstentionAboveCeiling: "abstention-above-ceiling",
    holdoutSplitMissing: "holdout-split-missing",
    humanReferenceMissing: "human-reference-missing",
    scopeNotAllowlist: "scope-not-allowlist",
    enforcementWithoutApproval: "enforcement-without-approval",
} as const;

export type ReadinessReasonToken = (typeof READINESS_REASONS)[keyof typeof READINESS_REASONS];

const DECISION_KIND_VALUES: readonly string[] = Object.values(DECISION_KINDS);

/** Pinned ids carry an explicit version ("jev-1.13.0"); moving aliases do not. */
const PINNED_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*-[0-9]+\.[0-9]+(\.[0-9]+)?$/i;
const DATASET_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** Reported ratios must match numerator/denominator within float tolerance. */
const RATIO_TOLERANCE = 1e-9;

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export interface ReadinessReason {
    readonly token: ReadinessReasonToken;
    readonly detail: string;
}

export interface JevReadinessResult {
    readonly schemaVersion: typeof READINESS_RESULT_SCHEMA_VERSION;
    readonly ready: boolean;
    /** Declared profile version, or null when the profile itself is invalid. */
    readonly profileVersion: string | null;
    readonly checkedAt: string;
    readonly reasons: readonly ReadinessReason[];
}

// ---------------------------------------------------------------------------
// Typed input shapes (post-validation)
// ---------------------------------------------------------------------------

export interface JevReleaseThresholds {
    readonly minCoverage: number;
    readonly minAgreement: number;
    readonly maxAbstentionRate: number;
    readonly requireHoldoutSplit: boolean;
    readonly requireHumanReference: boolean;
}

export interface JevKindProfile {
    readonly decisionKind: DecisionKind;
    readonly modelId: string;
    readonly questionVersion: string;
    readonly datasetDigest: string;
    readonly thresholds: JevReleaseThresholds;
    readonly approvedScope: readonly string[];
    readonly approvalReference: string;
}

export interface JevReleaseProfile {
    readonly profileVersion: string;
    readonly enabled: boolean;
    readonly kinds: readonly JevKindProfile[];
}

export interface JevRawCounts {
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
}

export interface JevMetricTriple {
    readonly numerator: number;
    readonly denominator: number;
    readonly value: number;
}

export interface JevSplitAttestation {
    readonly present: boolean;
    readonly caseCount: number;
}

/**
 * Raw per-metric entries exactly as they appeared in the evidence document.
 * Unknown metric names fail the evidence schema; a missing or malformed
 * entry is judged semantically so the reason names the exact gap.
 */
export type JevRawMetricEntries = Readonly<Partial<Record<RequiredMetric, Readonly<Record<string, unknown>>>>>;

export interface JevKindEvidence {
    readonly decisionKind: DecisionKind;
    readonly rawCounts: JevRawCounts;
    readonly metrics: JevRawMetricEntries;
    readonly holdoutSplit: JevSplitAttestation;
    readonly humanReference: JevSplitAttestation;
}

export interface JevEvidenceReport {
    readonly modelId: string;
    readonly questionVersion: string;
    readonly datasetDigest: string;
    readonly kinds: readonly JevKindEvidence[];
}

// ---------------------------------------------------------------------------
// Validation helpers (throw ReadinessSchemaError with a first-failure message;
// the evaluator catches and converts to a reason, so it never throws)
// ---------------------------------------------------------------------------

class ReadinessSchemaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReadinessSchemaError";
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects unknown keys and missing required keys; optional keys may be absent. */
function requireExactKeys(
    value: Record<string, unknown>,
    required: readonly string[],
    optional: readonly string[],
    what: string,
): void {
    for (const key of Object.keys(value)) {
        if (!required.includes(key) && !optional.includes(key)) {
            throw new ReadinessSchemaError(`Unknown ${what} key "${key}"`);
        }
    }
    for (const key of required) {
        if (!(key in value)) {
            throw new ReadinessSchemaError(`${what} is missing required key "${key}"`);
        }
    }
}

function requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ReadinessSchemaError(`Field "${field}" must be a non-empty string`);
    }
    return value;
}

function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
        throw new ReadinessSchemaError(`Field "${field}" must be a boolean`);
    }
    return value;
}

function requireNonNegativeInt(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new ReadinessSchemaError(`Field "${field}" must be a non-negative integer`);
    }
    return value;
}

function requireUnitInterval(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new ReadinessSchemaError(`Field "${field}" must be a finite number in 0..1`);
    }
    return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw new ReadinessSchemaError(`Field "${field}" must be one of: ${allowed.join(", ")}`);
    }
    return value as T;
}

function optionalNotes(value: Record<string, unknown>): void {
    if ("notes" in value) requireNonEmptyString(value["notes"], "notes");
}

// ---------------------------------------------------------------------------
// Profile parsing (strict, fail-closed)
// ---------------------------------------------------------------------------

const PROFILE_ROOT_REQUIRED_KEYS = ["enabled", "kinds", "profileVersion", "schemaVersion"] as const;
const PROFILE_ROOT_OPTIONAL_KEYS = ["notes"] as const;
const PROFILE_KIND_REQUIRED_KEYS = [
    "approvalReference",
    "approvedScope",
    "datasetDigest",
    "decisionKind",
    "modelId",
    "questionVersion",
    "thresholds",
] as const;
const PROFILE_KIND_OPTIONAL_KEYS = ["notes"] as const;
const THRESHOLD_KEYS = [
    "maxAbstentionRate",
    "minAgreement",
    "minCoverage",
    "requireHoldoutSplit",
    "requireHumanReference",
] as const;

export function parseReleaseProfile(raw: unknown): JevReleaseProfile {
    if (!isPlainObject(raw)) {
        throw new ReadinessSchemaError("Profile root must be a JSON object");
    }
    requireExactKeys(raw, PROFILE_ROOT_REQUIRED_KEYS, PROFILE_ROOT_OPTIONAL_KEYS, "profile root");
    const schemaVersion = requireNonEmptyString(raw["schemaVersion"], "schemaVersion");
    if (schemaVersion !== RELEASE_PROFILE_SCHEMA_VERSION) {
        throw new ReadinessSchemaError(
            `Field "schemaVersion" must be "${RELEASE_PROFILE_SCHEMA_VERSION}", got "${schemaVersion}"`,
        );
    }
    const profileVersion = requireNonEmptyString(raw["profileVersion"], "profileVersion");
    const enabled = requireBoolean(raw["enabled"], "enabled");
    optionalNotes(raw);

    const rawKinds = raw["kinds"];
    if (!Array.isArray(rawKinds) || rawKinds.length === 0) {
        throw new ReadinessSchemaError('Profile field "kinds" must be a non-empty array');
    }
    const seenKinds = new Set<string>();
    const kinds = rawKinds.map((entry) => {
        const kind = parseKindProfile(entry);
        if (seenKinds.has(kind.decisionKind)) {
            throw new ReadinessSchemaError(
                `Profile declares decision kind "${kind.decisionKind}" more than once`,
            );
        }
        seenKinds.add(kind.decisionKind);
        return kind;
    });

    return { enabled, kinds, profileVersion };
}

function parseKindProfile(entry: unknown): JevKindProfile {
    if (!isPlainObject(entry)) {
        throw new ReadinessSchemaError("Each profile kind entry must be a JSON object");
    }
    requireExactKeys(entry, PROFILE_KIND_REQUIRED_KEYS, PROFILE_KIND_OPTIONAL_KEYS, "profile kind entry");
    const decisionKind = requireEnum<DecisionKind>(
        entry["decisionKind"],
        DECISION_KIND_VALUES as readonly DecisionKind[],
        "decisionKind",
    );
    const modelId = requireNonEmptyString(entry["modelId"], "modelId");
    if (!PINNED_MODEL_ID_PATTERN.test(modelId)) {
        throw new ReadinessSchemaError(
            `Field "modelId" must be a pinned versioned id (e.g. "jev-1.13.0"); a moving alias like `
            + `"${modelId}" is invalid`,
        );
    }
    const questionVersion = requireNonEmptyString(entry["questionVersion"], "questionVersion");
    const datasetDigest = requireNonEmptyString(entry["datasetDigest"], "datasetDigest");
    if (!DATASET_DIGEST_PATTERN.test(datasetDigest)) {
        throw new ReadinessSchemaError(
            'Field "datasetDigest" must be a lowercase 64-character SHA-256 hex digest',
        );
    }

    const rawThresholds = entry["thresholds"];
    if (!isPlainObject(rawThresholds)) {
        throw new ReadinessSchemaError('Field "thresholds" must be a JSON object');
    }
    requireExactKeys(rawThresholds, THRESHOLD_KEYS, [], "thresholds");
    const thresholds: JevReleaseThresholds = {
        maxAbstentionRate: requireUnitInterval(rawThresholds["maxAbstentionRate"], "thresholds.maxAbstentionRate"),
        minAgreement: requireUnitInterval(rawThresholds["minAgreement"], "thresholds.minAgreement"),
        minCoverage: requireUnitInterval(rawThresholds["minCoverage"], "thresholds.minCoverage"),
        requireHoldoutSplit: requireBoolean(
            rawThresholds["requireHoldoutSplit"],
            "thresholds.requireHoldoutSplit",
        ),
        requireHumanReference: requireBoolean(
            rawThresholds["requireHumanReference"],
            "thresholds.requireHumanReference",
        ),
    };

    const rawScope = entry["approvedScope"];
    if (!Array.isArray(rawScope) || rawScope.length === 0) {
        throw new ReadinessSchemaError('Field "approvedScope" must be a non-empty array of scope strings');
    }
    const approvedScope = rawScope.map((item, index) => requireNonEmptyString(item, `approvedScope[${index}]`));

    const approvalReference = requireNonEmptyString(entry["approvalReference"], "approvalReference");
    optionalNotes(entry);

    return {
        approvalReference,
        approvedScope,
        datasetDigest,
        decisionKind,
        modelId,
        questionVersion,
        thresholds,
    };
}

// ---------------------------------------------------------------------------
// Evidence parsing (strict schema; metric presence is judged semantically so
// a missing numerator/denominator gets its precise reason token)
// ---------------------------------------------------------------------------

const EVIDENCE_ROOT_REQUIRED_KEYS = [
    "datasetDigest",
    "kinds",
    "modelId",
    "questionVersion",
    "schemaVersion",
] as const;
const EVIDENCE_ROOT_OPTIONAL_KEYS = ["notes"] as const;
const EVIDENCE_KIND_REQUIRED_KEYS = [
    "decisionKind",
    "holdoutSplit",
    "humanReference",
    "metrics",
    "rawCounts",
] as const;
const EVIDENCE_KIND_OPTIONAL_KEYS = ["notes"] as const;
const RAW_COUNT_KEYS = [
    "acceptedCount",
    "abstainedCount",
    "correctCount",
    "evaluatedCount",
    "humanReferenceComparisons",
    "labeledCount",
    "missingPredictionCount",
    "unavailableCount",
] as const;
const SPLIT_ATTESTATION_KEYS = ["caseCount", "present"] as const;

export function parseEvidenceReport(raw: unknown): JevEvidenceReport {
    if (!isPlainObject(raw)) {
        throw new ReadinessSchemaError("Evidence root must be a JSON object");
    }
    requireExactKeys(raw, EVIDENCE_ROOT_REQUIRED_KEYS, EVIDENCE_ROOT_OPTIONAL_KEYS, "evidence root");
    const schemaVersion = requireNonEmptyString(raw["schemaVersion"], "schemaVersion");
    if (schemaVersion !== EVIDENCE_REPORT_SCHEMA_VERSION) {
        throw new ReadinessSchemaError(
            `Field "schemaVersion" must be "${EVIDENCE_REPORT_SCHEMA_VERSION}", got "${schemaVersion}"`,
        );
    }
    const modelId = requireNonEmptyString(raw["modelId"], "modelId");
    const questionVersion = requireNonEmptyString(raw["questionVersion"], "questionVersion");
    const datasetDigest = requireNonEmptyString(raw["datasetDigest"], "datasetDigest");
    optionalNotes(raw);

    const rawKinds = raw["kinds"];
    if (!Array.isArray(rawKinds) || rawKinds.length === 0) {
        throw new ReadinessSchemaError('Evidence field "kinds" must be a non-empty array');
    }
    const seenKinds = new Set<string>();
    const kinds = rawKinds.map((entry) => {
        const kind = parseKindEvidence(entry);
        if (seenKinds.has(kind.decisionKind)) {
            throw new ReadinessSchemaError(
                `Evidence declares decision kind "${kind.decisionKind}" more than once`,
            );
        }
        seenKinds.add(kind.decisionKind);
        return kind;
    });

    return { datasetDigest, kinds, modelId, questionVersion };
}

function parseKindEvidence(entry: unknown): JevKindEvidence {
    if (!isPlainObject(entry)) {
        throw new ReadinessSchemaError("Each evidence kind entry must be a JSON object");
    }
    requireExactKeys(entry, EVIDENCE_KIND_REQUIRED_KEYS, EVIDENCE_KIND_OPTIONAL_KEYS, "evidence kind entry");
    const decisionKind = requireEnum<DecisionKind>(
        entry["decisionKind"],
        DECISION_KIND_VALUES as readonly DecisionKind[],
        "decisionKind",
    );
    const rawCounts = parseRawCounts(entry["rawCounts"]);
    const metrics = parseMetricEntries(entry["metrics"]);
    const holdoutSplit = parseSplitAttestation(entry["holdoutSplit"], "holdoutSplit");
    const humanReference = parseSplitAttestation(entry["humanReference"], "humanReference");
    optionalNotes(entry);

    return { decisionKind, holdoutSplit, humanReference, metrics, rawCounts };
}

function parseRawCounts(value: unknown): JevRawCounts {
    if (!isPlainObject(value)) {
        throw new ReadinessSchemaError('Evidence field "rawCounts" must be a JSON object');
    }
    requireExactKeys(value, RAW_COUNT_KEYS, [], "rawCounts");
    const rawComparisons = value["humanReferenceComparisons"];
    if (!isPlainObject(rawComparisons)) {
        throw new ReadinessSchemaError(
            'Evidence field "rawCounts.humanReferenceComparisons" must be a JSON object',
        );
    }
    requireExactKeys(
        rawComparisons,
        ["agreedCount", "comparableCount"],
        [],
        "rawCounts.humanReferenceComparisons",
    );
    return {
        abstainedCount: requireNonNegativeInt(value["abstainedCount"], "rawCounts.abstainedCount"),
        acceptedCount: requireNonNegativeInt(value["acceptedCount"], "rawCounts.acceptedCount"),
        correctCount: requireNonNegativeInt(value["correctCount"], "rawCounts.correctCount"),
        evaluatedCount: requireNonNegativeInt(value["evaluatedCount"], "rawCounts.evaluatedCount"),
        humanReferenceComparisons: {
            agreedCount: requireNonNegativeInt(
                rawComparisons["agreedCount"],
                "rawCounts.humanReferenceComparisons.agreedCount",
            ),
            comparableCount: requireNonNegativeInt(
                rawComparisons["comparableCount"],
                "rawCounts.humanReferenceComparisons.comparableCount",
            ),
        },
        labeledCount: requireNonNegativeInt(value["labeledCount"], "rawCounts.labeledCount"),
        missingPredictionCount: requireNonNegativeInt(
            value["missingPredictionCount"],
            "rawCounts.missingPredictionCount",
        ),
        unavailableCount: requireNonNegativeInt(value["unavailableCount"], "rawCounts.unavailableCount"),
    };
}

/**
 * Metric names are closed (unknown metric names fail the evidence schema).
 * Entries are kept raw: a missing, non-object, or incomplete entry is
 * reported semantically as metric-denominator-missing so the reason names
 * the exact gap instead of failing the whole document.
 */
function parseMetricEntries(value: unknown): JevRawMetricEntries {
    if (!isPlainObject(value)) {
        throw new ReadinessSchemaError('Evidence field "metrics" must be a JSON object');
    }
    for (const key of Object.keys(value)) {
        if (!REQUIRED_METRICS.includes(key as RequiredMetric)) {
            throw new ReadinessSchemaError(`Unknown metrics key "${key}"`);
        }
    }
    const entries: Partial<Record<RequiredMetric, Readonly<Record<string, unknown>>>> = {};
    for (const metric of REQUIRED_METRICS) {
        const entry = value[metric];
        if (entry !== undefined) {
            entries[metric] = isPlainObject(entry) ? entry : {};
        }
    }
    return entries;
}

function parseSplitAttestation(value: unknown, field: string): JevSplitAttestation {
    if (!isPlainObject(value)) {
        throw new ReadinessSchemaError(`Evidence field "${field}" must be a JSON object`);
    }
    requireExactKeys(value, SPLIT_ATTESTATION_KEYS, [], field);
    return {
        caseCount: requireNonNegativeInt(value["caseCount"], `${field}.caseCount`),
        present: requireBoolean(value["present"], `${field}.present`),
    };
}

// ---------------------------------------------------------------------------
// Readiness evaluation
// ---------------------------------------------------------------------------

/** Maps each required metric to the raw counts that must source it. */
const METRIC_COUNT_SOURCES: Record<RequiredMetric, {
    numerator: (counts: JevRawCounts) => number;
    denominator: (counts: JevRawCounts) => number;
    denominatorLabel: string;
}> = {
    abstentionRate: {
        denominator: (counts) => counts.evaluatedCount,
        denominatorLabel: "rawCounts.evaluatedCount",
        numerator: (counts) => counts.abstainedCount,
    },
    agreement: {
        denominator: (counts) => counts.humanReferenceComparisons.comparableCount,
        denominatorLabel: "rawCounts.humanReferenceComparisons.comparableCount",
        numerator: (counts) => counts.humanReferenceComparisons.agreedCount,
    },
    coverage: {
        denominator: (counts) => counts.labeledCount,
        denominatorLabel: "rawCounts.labeledCount",
        numerator: (counts) => counts.acceptedCount,
    },
    precision: {
        denominator: (counts) => counts.acceptedCount,
        denominatorLabel: "rawCounts.acceptedCount",
        numerator: (counts) => counts.correctCount,
    },
};

/**
 * True when the approval reference is a reserved placeholder (or empty).
 * A placeholder — and any JSON reference, for that matter — is NOT an
 * operator approval; see docs/agent/jev-rollout.md.
 */
export function isPlaceholderApprovalReference(reference: string): boolean {
    const trimmed = reference.trim().toLowerCase();
    if (trimmed.length === 0) return true;
    return PLACEHOLDER_APPROVAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function reason(token: ReadinessReasonToken, detail: string): ReadinessReason {
    return { detail, token };
}

/**
 * Pure, deterministic, fail-closed readiness evaluation. Never throws and
 * never performs I/O: an invalid profile or evidence becomes a blocking
 * reason. `checkedAt` is injected so identical inputs produce identical
 * results.
 */
export function evaluateJevReadiness(
    profileRaw: unknown,
    evidenceRaw: unknown | null,
    checkedAt: Date,
): JevReadinessResult {
    const reasons: ReadinessReason[] = [];

    let profile: JevReleaseProfile | null = null;
    try {
        profile = parseReleaseProfile(profileRaw);
    } catch (error) {
        reasons.push(reason(
            READINESS_REASONS.profileInvalid,
            error instanceof Error ? error.message : String(error),
        ));
    }
    const profileVersion = profile === null ? null : profile.profileVersion;

    if (profile !== null) {
        checkProfileSemantics(profile, reasons);

        if (evidenceRaw === null || evidenceRaw === undefined) {
            reasons.push(reason(
                READINESS_REASONS.evidenceMissing,
                "No evaluation evidence was supplied; missing real evidence blocks readiness "
                + `(pass --evidence=<report.json> with schema "${EVIDENCE_REPORT_SCHEMA_VERSION}")`,
            ));
        } else {
            let evidence: JevEvidenceReport | null = null;
            try {
                evidence = parseEvidenceReport(evidenceRaw);
            } catch (error) {
                reasons.push(reason(
                    READINESS_REASONS.evidenceInvalid,
                    error instanceof Error ? error.message : String(error),
                ));
            }
            if (evidence !== null) checkEvidenceAgainstProfile(profile, evidence, reasons);
        }
    }

    return {
        checkedAt: checkedAt.toISOString(),
        profileVersion,
        ready: reasons.length === 0,
        reasons,
        schemaVersion: READINESS_RESULT_SCHEMA_VERSION,
    };
}

function checkProfileSemantics(profile: JevReleaseProfile, reasons: ReadinessReason[]): void {
    for (const kind of profile.kinds) {
        const invalidScopes = kind.approvedScope.filter(
            (scope) => !(ALLOWED_APPROVED_SCOPES as readonly string[]).includes(scope),
        );
        if (invalidScopes.length > 0) {
            reasons.push(reason(
                READINESS_REASONS.scopeNotAllowlist,
                `Decision kind "${kind.decisionKind}" approvedScope must be an explicit allowlist of `
                + `${ALLOWED_APPROVED_SCOPES.join("/")}; found ${JSON.stringify(invalidScopes)} `
                + "(wildcards and unknown scopes are never valid)",
            ));
        }
        if (profile.enabled && isPlaceholderApprovalReference(kind.approvalReference)) {
            reasons.push(reason(
                READINESS_REASONS.enforcementWithoutApproval,
                `Decision kind "${kind.decisionKind}" requests enabled enforcement while its `
                + "approvalReference is a placeholder; a real operator approval reference is required "
                + "before a profile may enable enforcement",
            ));
        }
    }
}

function checkEvidenceAgainstProfile(
    profile: JevReleaseProfile,
    evidence: JevEvidenceReport,
    reasons: ReadinessReason[],
): void {
    const evidenceKinds = new Set(evidence.kinds.map((item) => item.decisionKind));

    for (const entry of evidence.kinds) {
        if (!profile.kinds.some((kind) => kind.decisionKind === entry.decisionKind)) {
            reasons.push(reason(
                READINESS_REASONS.evidenceKindMismatch,
                `Evidence carries decision kind "${entry.decisionKind}" which the profile does not declare`,
            ));
        }
    }

    for (const kindProfile of profile.kinds) {
        const kindEvidence = evidence.kinds.find((item) => item.decisionKind === kindProfile.decisionKind);
        if (kindEvidence === undefined) continue;

        // Compatibility: model id, question version, and dataset digest must
        // match the profile exactly; a mismatch names the field and blocks
        // the kind (its deeper numbers are for a different configuration and
        // are not evaluated).
        const mismatches: Array<[string, string, string]> = [];
        if (evidence.modelId !== kindProfile.modelId) {
            mismatches.push(["modelId", kindProfile.modelId, evidence.modelId]);
        }
        if (evidence.questionVersion !== kindProfile.questionVersion) {
            mismatches.push(["questionVersion", kindProfile.questionVersion, evidence.questionVersion]);
        }
        if (evidence.datasetDigest !== kindProfile.datasetDigest) {
            mismatches.push(["datasetDigest", kindProfile.datasetDigest, evidence.datasetDigest]);
        }
        for (const [field, expected, actual] of mismatches) {
            reasons.push(reason(
                field === "modelId"
                    ? READINESS_REASONS.evidenceModelMismatch
                    : field === "questionVersion"
                        ? READINESS_REASONS.evidenceQuestionVersionMismatch
                        : READINESS_REASONS.evidenceDatasetDigestMismatch,
                `Decision kind "${kindProfile.decisionKind}": evidence ${field} "${actual}" does not match `
                + `the profile's pinned ${field} "${expected}"`,
            ));
        }
        if (mismatches.length > 0) continue;

        checkKindMetricsAndGates(kindProfile, kindEvidence, reasons);
    }

    for (const kindProfile of profile.kinds) {
        if (!evidenceKinds.has(kindProfile.decisionKind)) {
            reasons.push(reason(
                READINESS_REASONS.evidenceKindMismatch,
                `Profile requires decision kind "${kindProfile.decisionKind}" but the evidence has no entry `
                + "for it",
            ));
        }
    }
}

function checkKindMetricsAndGates(
    kindProfile: JevKindProfile,
    kindEvidence: JevKindEvidence,
    reasons: ReadinessReason[],
): void {
    const kind = kindProfile.decisionKind;
    const counts = kindEvidence.rawCounts;

    // Structural count identities (the same partition the evaluation report
    // is built from): labeled = evaluated + missing, evaluated = accepted +
    // abstained + unavailable, correct ⊆ accepted, agreed ⊆ comparable.
    const partitionFailures: string[] = [];
    if (counts.evaluatedCount + counts.missingPredictionCount !== counts.labeledCount) {
        partitionFailures.push(
            `evaluatedCount (${counts.evaluatedCount}) + missingPredictionCount `
            + `(${counts.missingPredictionCount}) != labeledCount (${counts.labeledCount})`,
        );
    }
    if (counts.acceptedCount + counts.abstainedCount + counts.unavailableCount !== counts.evaluatedCount) {
        partitionFailures.push(
            `acceptedCount (${counts.acceptedCount}) + abstainedCount (${counts.abstainedCount}) `
            + `+ unavailableCount (${counts.unavailableCount}) != evaluatedCount (${counts.evaluatedCount})`,
        );
    }
    if (counts.correctCount > counts.acceptedCount) {
        partitionFailures.push(
            `correctCount (${counts.correctCount}) > acceptedCount (${counts.acceptedCount})`,
        );
    }
    if (counts.humanReferenceComparisons.agreedCount > counts.humanReferenceComparisons.comparableCount) {
        partitionFailures.push(
            `humanReferenceComparisons.agreedCount (${counts.humanReferenceComparisons.agreedCount}) > `
            + `comparableCount (${counts.humanReferenceComparisons.comparableCount})`,
        );
    }
    for (const failure of partitionFailures) {
        reasons.push(reason(READINESS_REASONS.rawCountsInconsistent, `Decision kind "${kind}": ${failure}`));
    }

    for (const metric of REQUIRED_METRICS) {
        checkMetricTriple(kind, metric, kindEvidence, reasons);
    }

    const coverage = validReportedTriple(kindEvidence.metrics["coverage"]);
    if (coverage !== null && coverage.value < kindProfile.thresholds.minCoverage) {
        reasons.push(reason(
            READINESS_REASONS.coverageBelowFloor,
            `Decision kind "${kind}": coverage ${formatRatio(coverage)} is below the profile floor `
            + `${kindProfile.thresholds.minCoverage}`,
        ));
    }
    const abstention = validReportedTriple(kindEvidence.metrics["abstentionRate"]);
    if (abstention !== null && abstention.value > kindProfile.thresholds.maxAbstentionRate) {
        reasons.push(reason(
            READINESS_REASONS.abstentionAboveCeiling,
            `Decision kind "${kind}": abstentionRate ${formatRatio(abstention)} is above the profile ceiling `
            + `${kindProfile.thresholds.maxAbstentionRate}`,
        ));
    }
    const agreement = validReportedTriple(kindEvidence.metrics["agreement"]);
    if (agreement !== null && agreement.value < kindProfile.thresholds.minAgreement) {
        reasons.push(reason(
            READINESS_REASONS.agreementBelowFloor,
            `Decision kind "${kind}": agreement ${formatRatio(agreement)} is below the profile floor `
            + `${kindProfile.thresholds.minAgreement}`,
        ));
    }

    if (!kindEvidence.holdoutSplit.present || kindEvidence.holdoutSplit.caseCount === 0) {
        reasons.push(reason(
            READINESS_REASONS.holdoutSplitMissing,
            `Decision kind "${kind}": the evidence attests no held-out split cases; the profile requires a `
            + "held-out split",
        ));
    }
    if (!kindEvidence.humanReference.present || kindEvidence.humanReference.caseCount === 0) {
        reasons.push(reason(
            READINESS_REASONS.humanReferenceMissing,
            `Decision kind "${kind}": the evidence attests no human-reviewed reference cases; the profile `
            + "requires a human reference",
        ));
    }
}

function checkMetricTriple(
    kind: DecisionKind,
    metric: RequiredMetric,
    kindEvidence: JevKindEvidence,
    reasons: ReadinessReason[],
): void {
    const entry = kindEvidence.metrics[metric];
    if (entry === undefined) {
        reasons.push(reason(
            READINESS_REASONS.metricDenominatorMissing,
            `Decision kind "${kind}": required metric "${metric}" is absent; every required metric must `
            + "carry numerator and denominator (no bare percentages)",
        ));
        return;
    }
    const numerator = entry["numerator"];
    const denominator = entry["denominator"];
    if (!isNonNegativeInt(numerator) || !isNonNegativeInt(denominator)) {
        reasons.push(reason(
            READINESS_REASONS.metricDenominatorMissing,
            `Decision kind "${kind}": metric "${metric}" must carry integer numerator and denominator `
            + "(no bare percentages)",
        ));
        return;
    }
    const num: number = numerator;
    const den: number = denominator;
    if (den === 0) {
        reasons.push(reason(
            READINESS_REASONS.metricDenominatorZero,
            `Decision kind "${kind}": metric "${metric}" has a zero denominator; a zero denominator blocks`,
        ));
        return;
    }

    const value = entry["value"];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        reasons.push(reason(
            READINESS_REASONS.metricValueDisagreement,
            `Decision kind "${kind}": metric "${metric}" must report a finite numeric value`,
        ));
        return;
    }
    if (Math.abs(value - num / den) > RATIO_TOLERANCE) {
        reasons.push(reason(
            READINESS_REASONS.metricValueDisagreement,
            `Decision kind "${kind}": metric "${metric}" reports value ${value} but `
            + `${num}/${den} = ${num / den}`,
        ));
    }

    const source = METRIC_COUNT_SOURCES[metric];
    const expectedNum = source.numerator(kindEvidence.rawCounts);
    const expectedDen = source.denominator(kindEvidence.rawCounts);
    if (num !== expectedNum || den !== expectedDen) {
        reasons.push(reason(
            READINESS_REASONS.metricCountsDisagreement,
            `Decision kind "${kind}": metric "${metric}" claims ${num}/${den} but the raw counts give `
            + `${expectedNum}/${expectedDen} (${source.denominatorLabel})`,
        ));
    }
}

function validReportedTriple(entry: Readonly<Record<string, unknown>> | undefined): JevMetricTriple | null {
    if (entry === undefined) return null;
    const numerator = entry["numerator"];
    const denominator = entry["denominator"];
    const value = entry["value"];
    if (!isNonNegativeInt(numerator) || !isNonNegativeInt(denominator) || typeof value !== "number") {
        return null;
    }
    return { denominator, numerator, value };
}

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function formatRatio(triple: JevMetricTriple): string {
    return `${triple.numerator}/${triple.denominator} = ${triple.value}`;
}

// ---------------------------------------------------------------------------
// CLI (read-only: reads two files, prints JSON, sets exit code; never writes)
// ---------------------------------------------------------------------------

interface CliOptions {
    readonly profile: string;
    readonly evidence: string | null;
}

const USAGE = [
    "Usage: ts-node scripts/agent/check-jev-readiness.ts --profile=<profile.json> [--evidence=<report.json>]",
    "",
    "Offline release-readiness gate evaluation for the Jev semantic decision",
    "layer. Validates the release profile and (optionally) an evaluation",
    "evidence report and prints a versioned readiness result as JSON.",
    "Read-only: nothing is written, no settings are read, no network call is",
    "made. Exits 0 only when ready is true; a non-zero exit on a draft/off",
    "profile is the designed fail-closed outcome.",
].join("\n");

function parseCliArgs(argv: readonly string[]): CliOptions {
    let profile: string | null = null;
    let evidence: string | null = null;
    for (const arg of argv) {
        const match = /^(--profile|--evidence)=(.+)$/.exec(arg);
        if (match === null) {
            throw new Error(`Unrecognized argument "${arg}"\n\n${USAGE}`);
        }
        const flag = match[1] ?? "";
        const value = match[2] ?? "";
        if (flag === "--profile") {
            if (profile !== null) throw new Error("--profile supplied more than once");
            profile = value;
        } else {
            if (evidence !== null) throw new Error("--evidence supplied more than once");
            evidence = value;
        }
    }
    if (profile === null) throw new Error(`--profile is required\n\n${USAGE}`);
    return { evidence, profile };
}

type FileRead = { readonly data: unknown } | { readonly error: string };

function readJsonFile(path: string, description: string): FileRead {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (error) {
        return { error: `Failed to read ${description} at "${path}": ${(error as Error).message}` };
    }
    try {
        return { data: JSON.parse(raw) as unknown };
    } catch (error) {
        return { error: `${description} at "${path}" is not valid JSON: ${(error as Error).message}` };
    }
}

function safeParseProfile(profileRaw: unknown): JevReleaseProfile | null {
    try {
        return parseReleaseProfile(profileRaw);
    } catch {
        return null;
    }
}

function runCli(argv: readonly string[]): void {
    const options = parseCliArgs(argv);
    const profileFile = readJsonFile(options.profile, "profile file");
    const evidenceFile = options.evidence === null
        ? null
        : readJsonFile(options.evidence, "evidence file");

    let result: JevReadinessResult;
    if ("error" in profileFile) {
        result = {
            checkedAt: new Date().toISOString(),
            profileVersion: null,
            ready: false,
            reasons: [reason(READINESS_REASONS.profileInvalid, profileFile.error)],
            schemaVersion: READINESS_RESULT_SCHEMA_VERSION,
        };
    } else if (evidenceFile !== null && "error" in evidenceFile) {
        const parsed = safeParseProfile(profileFile.data);
        result = {
            checkedAt: new Date().toISOString(),
            profileVersion: parsed === null ? null : parsed.profileVersion,
            ready: false,
            reasons: [reason(READINESS_REASONS.evidenceInvalid, evidenceFile.error)],
            schemaVersion: READINESS_RESULT_SCHEMA_VERSION,
        };
    } else {
        result = evaluateJevReadiness(profileFile.data, evidenceFile === null ? null : evidenceFile.data, new Date());
    }

    console.log(JSON.stringify(result, null, 2));
    if (result.ready) {
        console.error("Jev readiness: READY");
    } else {
        console.error(`Jev readiness: BLOCKED (${result.reasons.map((item) => item.token).join(", ")})`);
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
