import { createHash } from "node:crypto";
import { z } from "zod";
import { EXPORT_CLASSIFICATIONS, EXPORT_POLICY_REVISION } from "./export/constants";
import { canonicalManualBackupScope, parseManualBackupScope, type ManualBackupScope } from "./manual-backup-scope";
import {
    canonicalBackupJson, assertBackupObject, MANUAL_BACKUP_OUTCOME_MAX_BYTES, MANUAL_BACKUP_REPORT_MAX_BYTES,
    type ManualBackupRunRecord, type ManualBackupDocumentRecord,
} from "./manual-backup-run";
import { MANUAL_BACKUP_SCOPE_REVISION } from "./manual-backup-constants";
import {
    manualSelectedCandidateSchema, manualAggregateResultSchema, manualDocumentResultSchema,
    manualDocumentResultDigest, manualAggregateResultDigest, normalizeManualSelection, type ManualSelectedCandidate,
    type ManualSelection, type ManualDocumentResult, type ManualAggregateResult,
} from "./worker/manual-protocol";
import { hex64, identifier, opaqueId } from "./worker/schema-fields";

export const MANUAL_CONTROL_CODES = ["INVALID_REQUEST", "NOT_FOUND", "IDEMPOTENCY_CONFLICT", "RUN_ACTIVE", "EMPTY_SELECTION",
    "SOURCE_CHANGED", "LEASE_LOST", "DOCUMENT_RESULTS_PENDING", "INVALID_REPORT", "SERVICE_UNAVAILABLE"] as const;
export type ManualBackupControlCode = typeof MANUAL_CONTROL_CODES[number];
export class ManualBackupControlError extends Error {
    constructor(readonly code: ManualBackupControlCode) { super(code); this.name = "ManualBackupControlError"; }
}
export function parseManualControl<T>(schema: z.ZodType<T>, input: unknown, code: ManualBackupControlCode = "INVALID_REQUEST"): T {
    try { const parsed = schema.safeParse(input); if (parsed.success) return parsed.data; } catch { /* Code only. */ }
    throw new ManualBackupControlError(code);
}
export const manualControlUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const scopeSchema = z.unknown().transform((value, ctx): ManualBackupScope => {
    const parsed = parseManualBackupScope(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({ code: "custom", message: "INVALID_REQUEST" }); return z.NEVER;
});
export const manualStaffContextSchema = z.strictObject({ branchId: manualControlUuidSchema, userId: manualControlUuidSchema });
export type ManualBackupStaffContext = z.infer<typeof manualStaffContextSchema>;
export const manualRequestBodySchema = z.strictObject({ scope: scopeSchema, requestKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/) });
const pageNumber = z.union([z.number(), z.string().regex(/^[1-9][0-9]*$/).transform(Number)]).pipe(z.number().int().min(1).max(100));
const ordinal = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const manualPageSchema = z.strictObject({ cursor: z.string().min(1).max(1024).optional(), limit: pageNumber.default(100) });
export const manualRunCursorSchema = z.strictObject({ id: manualControlUuidSchema, createdAt: z.iso.datetime({ precision: 3 }) });
export const manualDocumentCursorSchema = z.strictObject({ runId: manualControlUuidSchema, afterOrdinal: ordinal });
export const manualClaimBodySchema = z.strictObject({ companyId: identifier });
const lease = { companyId: identifier, leaseToken: manualControlUuidSchema };
export const manualLeaseBodySchema = z.strictObject(lease);
export const manualCandidatePageSchema = z.strictObject({ ...lease, afterOrdinal: ordinal.default(0), limit: pageNumber.default(100) });
export const manualValidateBodySchema = z.strictObject({ ...lease, documentId: opaqueId.optional() });
export const manualArtifactBodySchema = z.strictObject({ ...lease, documentId: opaqueId, artifactIdentity: hex64 });
export const manualDocumentReportSchema = z.strictObject({ payload: manualDocumentResultSchema, digest: hex64 });
export const manualWriteBodySchema = z.strictObject({ ...lease, items: z.array(manualDocumentReportSchema).min(1).max(100) });
export const manualFinishBodySchema = z.strictObject({ ...lease, payload: manualAggregateResultSchema, digest: hex64 });

export function manualRequestHash(companyId: string, branchId: string, userId: string, scope: ManualBackupScope): string {
    return createHash("sha256").update("eformsign-backup/manual-request/v1\n").update(canonicalBackupJson({
        companyId, branchId, userId, scope: JSON.parse(canonicalManualBackupScope(scope)),
    })).digest("hex");
}
export function toManualSelectedCandidate(document: ManualBackupDocumentRecord | Pick<ManualBackupDocumentRecord, "candidate">): ManualSelectedCandidate {
    const c = document.candidate;
    return parseManualControl(manualSelectedCandidateSchema, { ...c, artifacts: c.artifacts.map(a => ({
        artifactType: a.fileType === "audit_trail" ? "audit-trail" : a.fileType,
        artifactIdentity: a.artifactIdentity, sha256: a.sha256, byteLength: a.byteSize,
    })) }, "INVALID_REPORT");
}
export function manualFixedSelection(run: ManualBackupRunRecord, documents: readonly ManualBackupDocumentRecord[]): ManualSelection {
    try {
        if (documents.length !== run.sourceCounts.total || documents.some((d, i) => d.ordinal !== i + 1
            || d.runId !== run.id || d.branchId !== run.branchId || d.candidate.documentId !== d.documentId
            || d.candidate.ordinal !== d.ordinal)) throw new Error();
        const selection = normalizeManualSelection({ jobId: run.id, companyId: run.companyId, branchId: run.branchId,
            scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
            candidates: documents.map(toManualSelectedCandidate) });
        return selection;
    } catch { throw new ManualBackupControlError("INVALID_REPORT"); }
}
export function validateManualOutcome(value: unknown): { payload: ManualDocumentResult; digest: string } {
    try {
        assertBackupObject(value, MANUAL_BACKUP_OUTCOME_MAX_BYTES);
        const result = parseManualControl(manualDocumentReportSchema, value, "INVALID_REPORT");
        if (result.digest !== manualDocumentResultDigest(result.payload)) throw new Error();
        return result;
    } catch { throw new ManualBackupControlError("INVALID_REPORT"); }
}
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const destinationSummarySchema = z.strictObject({ state: z.enum(["excluded", "stored", "partial", "failed", "unverified"]), saved: safeCount });
export const manualSummarySchema = z.strictObject({ target: safeCount, saved: safeCount, attention: safeCount,
    metadataOnly: safeCount, local: destinationSummarySchema, drive: destinationSummarySchema });
export type ManualBackupSummary = z.infer<typeof manualSummarySchema>;
export function deriveManualSummary(report: ManualAggregateResult, results: readonly ManualDocumentResult[]): ManualBackupSummary {
    const destination = (key: "local" | "drive"): z.infer<typeof destinationSummarySchema> => {
        const states = results.map(r => r[key].state);
        const saved = states.filter(s => s === "verified").length;
        const required = states.filter(s => s !== "metadata_only" && s !== "not_required");
        const state = required.length === 0 ? "excluded" : required.every(s => s === "verified") ? "stored"
            : saved > 0 ? "partial" : states.includes("blocked") ? "failed" : "unverified";
        return { state, saved };
    };
    return { target: results.length, saved: results.filter(r => r.local.state === "verified"
        && (r.drive.state === "verified" || r.drive.state === "not_required")).length,
    attention: report.counts.attention, metadataOnly: results.filter(r => r.local.state === "metadata_only").length,
    local: destination("local"), drive: destination("drive") };
}
export function manualReportWrapper(report: ManualAggregateResult, results: readonly ManualDocumentResult[]): { report: ManualAggregateResult; summary: ManualBackupSummary } {
    const wrapper = { report, summary: deriveManualSummary(report, results) };
    try { assertBackupObject(wrapper, MANUAL_BACKUP_REPORT_MAX_BYTES); } catch { throw new ManualBackupControlError("INVALID_REPORT"); }
    return wrapper;
}
function defaultSummary(run: ManualBackupRunRecord): ManualBackupSummary {
    const target = Number.isSafeInteger(run.sourceCounts.total) && run.sourceCounts.total >= 0 ? run.sourceCounts.total : 0;
    return { target, saved: 0, attention: run.status === "queued" || run.status === "running" ? 0 : target,
        metadataOnly: 0, local: { state: "unverified", saved: 0 }, drive: { state: "unverified", saved: 0 } };
}
export function toManualStaffRun(run: ManualBackupRunRecord) {
    let summary = defaultSummary(run);
    const wrapper = z.strictObject({ report: manualAggregateResultSchema, summary: manualSummarySchema }).safeParse(run.result);
    if (wrapper.success && !["queued", "running"].includes(run.status) && wrapper.data.report.scope.jobId === run.id
        && wrapper.data.report.scope.branchId === run.branchId && wrapper.data.report.scope.companyId === run.companyId
        && wrapper.data.report.status === run.status && wrapper.data.report.runId === run.workerRunId
        && wrapper.data.report.scope.attemptId === `${run.id}.attempt-${run.attempts}`
        && manualAggregateResultDigest(wrapper.data.report) === run.reportHash
        && wrapper.data.report.documentResultCount === summary.target && wrapper.data.report.counts.selected === summary.target
        && wrapper.data.summary.attention === wrapper.data.report.counts.attention
        && wrapper.data.summary.metadataOnly === wrapper.data.report.counts.metadataOnly
        && wrapper.data.summary.local.saved === wrapper.data.report.counts.localVerified
        && wrapper.data.summary.drive.saved === wrapper.data.report.counts.driveVerified
        && wrapper.data.summary.saved <= wrapper.data.summary.local.saved
        && wrapper.data.summary.target === summary.target && wrapper.data.summary.saved <= summary.target
        && wrapper.data.summary.attention <= summary.target && wrapper.data.summary.metadataOnly <= summary.target
        && wrapper.data.summary.local.saved <= summary.target && wrapper.data.summary.drive.saved <= summary.target) summary = wrapper.data.summary;
    const scope = parseManualBackupScope(run.scope);
    return { id: run.id, status: run.status, scope: scope.ok ? scope.value : null, cut: run.snapshotAt.toISOString(),
        createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null,
        summary, coverage: "unverified" as const, backupComplete: false as const,
        failureCode: run.failureCode === "WORKER_LEASE_EXPIRED" || run.failureCode === "INVALID_SERVER_SELECTION" ? run.failureCode : null };
}
export function toManualStaffDocument(document: ManualBackupDocumentRecord) {
    const classification = z.enum(EXPORT_CLASSIFICATIONS).safeParse(document.candidate.classification);
    let local = "unverified"; let drive = "unverified";
    try { const outcome = validateManualOutcome(document.outcome); local = outcome.payload.local.state; drive = outcome.payload.drive.state; } catch { /* Safe fallback. */ }
    return { documentId: document.documentId, ordinal: document.ordinal, kind: document.kind, currentMilestone: document.currentMilestone,
        documentCreatedAt: document.documentCreatedAt.toISOString(), classification: classification.success ? classification.data : null,
        local, drive };
}
