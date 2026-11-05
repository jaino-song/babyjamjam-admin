import { createHash } from "node:crypto";
import { z } from "zod";
import { EXPORT_CLASSIFICATIONS } from "domain/eformsign-backup/export/constants";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { DESTINATION_STATES } from "./destination-transitions";
import { artifactTypeField, hex64, identifier, opaqueId, reasonCodeField, runIdField, sequenceField } from "./schema-fields";
import { WorkerError } from "./worker-error";

const nonnegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveInt = nonnegativeInt.min(1);
export const manualSafeCodeSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
const reasonsSchema = z.array(manualSafeCodeSchema).max(64).transform((values) => [...new Set(values)].sort());
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length;
const sortedIds = z.array(hex64).max(2).refine(unique).transform((values) => [...values].sort());

export const manualExecutionScopeSchema = z.strictObject({
    kind: z.literal("manual"), jobId: runIdField, attemptId: identifier,
    companyId: identifier, branchId: runIdField, selectionDigest: hex64,
}).refine((scope) => {
    const prefix = `${scope.jobId}.attempt-`;
    if (!scope.attemptId.startsWith(prefix)) return false;
    const suffix = scope.attemptId.slice(prefix.length);
    return /^[1-9][0-9]*$/.test(suffix) && Number.isSafeInteger(Number(suffix));
});
export type ManualExecutionScope = z.infer<typeof manualExecutionScopeSchema>;

export const manualSelectedCandidateSchema = z.strictObject({
    ordinal: positiveInt, documentId: opaqueId, classification: z.enum(EXPORT_CLASSIFICATIONS),
    reasons: reasonsSchema, statusType: z.string().max(16).regex(/^[A-Za-z0-9_-]*$/),
    documentKind: manualSafeCodeSchema.nullable(), metadataRevision: hex64,
    artifacts: z.array(z.strictObject({
        artifactType: artifactTypeField, artifactIdentity: hex64, sha256: hex64, byteLength: nonnegativeInt,
    })).max(2).refine((artifacts) => unique(artifacts.map((a) => a.artifactType))
        && unique(artifacts.map((a) => a.artifactIdentity)))
        .transform((artifacts) => [...artifacts].sort((a, b) => (a.artifactType === b.artifactType ? 0 : a.artifactType === "document" ? -1 : 1))),
});
export type ManualSelectedCandidate = z.infer<typeof manualSelectedCandidateSchema>;

export const manualSelectionSchema = z.strictObject({
    jobId: runIdField, companyId: identifier, branchId: runIdField,
    scopeRevision: identifier, policyRevision: identifier,
    candidates: z.array(manualSelectedCandidateSchema)
        .refine((candidates) => unique(candidates.map((c) => c.ordinal)) && unique(candidates.map((c) => c.documentId)))
        .transform((candidates) => [...candidates].sort((a, b) => a.ordinal - b.ordinal)),
});
export type ManualSelection = z.infer<typeof manualSelectionSchema>;

/** All public helpers discard validator details; an invalid value must never leak into an error. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
        const parsed = schema.safeParse(value);
        if (parsed.success) return parsed.data;
    } catch { /* Discard arbitrary accessor/validator exception messages, too. */ }
    throw new WorkerError("ledger-schema");
}
function inconsistent(): never { throw new WorkerError("ledger-inconsistent"); }
function hash(domain: string, payload: unknown): string {
    try {
        const digest = createHash("sha256").update(`eformsign-backup/${domain}/v1\n`, "utf8");
        // The shared encoder bounds an individual value. Stream the same canonical encoding so the
        // entire selection/result set has no document cap; individual events remain schema-bounded.
        function update(value: unknown): void {
            if (Array.isArray(value)) {
                digest.update("[");
                value.forEach((item, index) => { if (index) digest.update(","); update(item); });
                digest.update("]");
            } else if (value !== null && typeof value === "object") {
                digest.update("{");
                Object.keys(value).sort().forEach((key, index) => {
                    if (index) digest.update(",");
                    digest.update(`${canonicalJson(key)}:`);
                    update((value as Record<string, unknown>)[key]);
                });
                digest.update("}");
            } else digest.update(canonicalJson(value), "utf8");
        }
        update(payload);
        return digest.digest("hex");
    } catch { throw new WorkerError("ledger-schema"); }
}
export function normalizeManualSelection(value: unknown): ManualSelection { return parse(manualSelectionSchema, value); }
export function manualSelectionDigest(value: unknown): string { return hash("manual-selection", normalizeManualSelection(value)); }

export const destinationObservationSchema = z.strictObject({
    destinationIdentity: identifier.nullable(), destinationRevision: identifier.nullable(),
    state: z.enum(["verified", "partial", "blocked", "unverified", "metadata_only", "not_required"]),
    manifestStatus: z.enum(["verified", "pending", "blocked", "not_required"]),
    artifacts: z.array(z.strictObject({
        artifactIdentity: hex64, state: z.enum(DESTINATION_STATES).nullable(), reasonCode: reasonCodeField.nullable(),
    })).max(2).refine((artifacts) => unique(artifacts.map((a) => a.artifactIdentity)))
        .transform((artifacts) => [...artifacts].sort((a, b) => compare(a.artifactIdentity, b.artifactIdentity))),
    reasons: reasonsSchema,
}).refine((observation) => (observation.destinationIdentity === null) === (observation.destinationRevision === null))
    .refine((observation) => observation.state !== "verified"
        || (observation.destinationIdentity !== null && observation.manifestStatus === "verified"))
    .refine((observation) => !["metadata_only", "not_required"].includes(observation.state)
        || (observation.manifestStatus === "not_required" && observation.artifacts.length === 0));
export type DestinationObservation = z.infer<typeof destinationObservationSchema>;

export const manualDocumentResultSchema = z.strictObject({
    receiptId: runIdField, runId: runIdField, scope: manualExecutionScopeSchema,
    documentId: opaqueId, classification: z.enum(EXPORT_CLASSIFICATIONS), expectedArtifactIdentities: sortedIds,
    observedAtSequence: sequenceField, local: destinationObservationSchema, drive: destinationObservationSchema,
    reasons: reasonsSchema,
});
export type ManualDocumentResult = z.infer<typeof manualDocumentResultSchema>;
export function normalizeManualDocumentResult(value: unknown): ManualDocumentResult { return parse(manualDocumentResultSchema, value); }
export function manualDocumentResultDigest(value: unknown): string { return hash("manual-document-result", normalizeManualDocumentResult(value)); }

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function sameManualValue(a: unknown, b: unknown): boolean {
    try { return canonicalJson(a) === canonicalJson(b); }
    catch { throw new WorkerError("ledger-schema"); }
}

/** Selection-dependent assertions, shared by ledger application and aggregate construction. */
export function validateManualDocumentResult(candidateValue: unknown, resultValue: unknown): void {
    const candidate = parse(manualSelectedCandidateSchema, candidateValue);
    const result = normalizeManualDocumentResult(resultValue);
    const expected = candidate.artifacts.map((a) => a.artifactIdentity).sort();
    if (candidate.documentId !== result.documentId || candidate.classification !== result.classification
        || !sameManualValue(expected, result.expectedArtifactIdentities)) inconsistent();
    for (const observation of [result.local, result.drive]) {
        if (observation.artifacts.some((a) => !expected.includes(a.artifactIdentity))) inconsistent();
        if (candidate.classification !== "included"
            && (observation.state === "verified" || observation.artifacts.some((a) => a.state === "verified")
                || observation.manifestStatus === "verified")) inconsistent();
        if (observation.state === "metadata_only"
            && (candidate.classification !== "excluded_by_policy" || expected.length !== 0)) inconsistent();
        if (observation.state === "verified") {
            if (candidate.artifacts.length !== 2 || candidate.artifacts.some((a) => a.byteLength <= 0)
                || observation.artifacts.length !== 2
                || observation.artifacts.some((a) => a.state !== "verified")) inconsistent();
        }
    }
    if (result.local.state === "not_required") inconsistent();
}

export const manualAggregateResultSchema = z.strictObject({
    receiptId: runIdField, runId: runIdField, scope: manualExecutionScopeSchema,
    status: z.enum(["partial", "blocked", "failed", "unverified"]), coverage: z.literal("unverified"), backupComplete: z.literal(false),
    documentResultCount: nonnegativeInt, documentResultsDigest: hex64,
    counts: z.strictObject({
        selected: nonnegativeInt, localVerified: nonnegativeInt, driveVerified: nonnegativeInt,
        metadataOnly: nonnegativeInt, attention: nonnegativeInt,
    }), reasons: reasonsSchema,
});
export type ManualAggregateResult = z.infer<typeof manualAggregateResultSchema>;
export function manualAggregateResultDigest(value: unknown): string { return hash("manual-aggregate-result", parse(manualAggregateResultSchema, value)); }

export function manualDocumentResultsDigest(values: unknown): string {
    const results = parse(z.array(manualDocumentResultSchema), values);
    if (!unique(results.map((r) => r.documentId)) || !unique(results.map((r) => r.receiptId))) inconsistent();
    const tuples = results.sort((a, b) => compare(a.documentId, b.documentId))
        .map((r) => [r.documentId, r.receiptId, manualDocumentResultDigest(r)]);
    return hash("manual-document-results", tuples);
}

const aggregateInputSchema = z.strictObject({
    receiptId: runIdField, runId: runIdField, scope: manualExecutionScopeSchema,
    selection: manualSelectionSchema, results: z.array(manualDocumentResultSchema),
    status: manualAggregateResultSchema.shape.status, reasons: reasonsSchema,
});
/** Requires explicit observations for every document, including unattempted documents. Never invents success. */
export function buildManualAggregateResult(value: unknown): ManualAggregateResult {
    const input = parse(aggregateInputSchema, value);
    const { selection, results, scope } = input;
    if (scope.jobId !== selection.jobId || scope.companyId !== selection.companyId || scope.branchId !== selection.branchId
        || scope.selectionDigest !== manualSelectionDigest(selection) || results.length !== selection.candidates.length) inconsistent();
    const documentResultsDigest = manualDocumentResultsDigest(results);
    const byDocument = new Map(results.map((r) => [r.documentId, r]));
    const counts = { selected: selection.candidates.length, localVerified: 0, driveVerified: 0, metadataOnly: 0, attention: 0 };
    for (const candidate of selection.candidates) {
        const result = byDocument.get(candidate.documentId);
        if (!result || result.runId !== input.runId || !sameManualValue(result.scope, scope)) inconsistent();
        validateManualDocumentResult(candidate, result);
        if (result.local.state === "verified") counts.localVerified++;
        if (result.drive.state === "verified") counts.driveVerified++;
        if (result.local.state === "metadata_only") counts.metadataOnly++;
        const localFulfilled = result.local.state === "verified" || result.local.state === "metadata_only";
        const driveFulfilled = ["verified", "metadata_only", "not_required"].includes(result.drive.state);
        if (!localFulfilled || !driveFulfilled) counts.attention++;
    }
    return parse(manualAggregateResultSchema, {
        receiptId: input.receiptId, runId: input.runId, scope, status: input.status,
        coverage: "unverified", backupComplete: false, documentResultCount: results.length,
        documentResultsDigest, counts, reasons: input.reasons,
    });
}
