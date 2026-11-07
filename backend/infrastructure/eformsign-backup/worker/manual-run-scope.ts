import { EXPORT_ARTIFACT_MAX_BYTES, EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { WorkerError, artifactKey, isWorkerReasonCode, type DestinationEntry, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import {
    manualExecutionScopeSchema, manualSelectionDigest, normalizeManualDocumentResult,
    normalizeManualSelection, type DestinationObservation, type ManualDocumentResult, type ManualSelectedCandidate,
} from "domain/eformsign-backup/worker/manual-protocol";
import { type ExecutionEffectFence } from "../execution-effect-fence";
import type { CandidateView, SnapshotView } from "./export-client";
import type { ManualRunOptions } from "./runner-types";

const MANUAL_KEYS = ["executionScope", "selection", "snapshot", "exportPort", "fence"] as const;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const validUtc = (value: unknown): value is string => typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_all, ms: string | undefined) => `.${(ms ?? "").padEnd(3, "0")}Z`);

export function hasManualRunOptions(value: unknown): boolean {
    try { return value !== null && (typeof value === "object" || typeof value === "function") && MANUAL_KEYS.some((key) => key in value); }
    catch { throw new WorkerError("export-response-invalid"); }
}

/** No I/O or capability invocation. Parse/copy every public fact before the caller's first await. */
export function prepareManualRun(value: unknown, companyId: string): ManualRunScope | null {
    if (!hasManualRunOptions(value)) return null;
    try {
        const options = value as ManualRunOptions;
        if ("scheduledFor" in options) throw new Error();
        const scope = manualExecutionScopeSchema.parse(options.executionScope);
        const selection = normalizeManualSelection(options.selection);
        if (scope.companyId !== companyId || selection.companyId !== companyId || scope.jobId !== selection.jobId
            || scope.branchId !== selection.branchId || scope.selectionDigest !== manualSelectionDigest(selection)
            || selection.scopeRevision !== MANUAL_BACKUP_SCOPE_REVISION || selection.policyRevision !== EXPORT_POLICY_REVISION) throw new Error();
        const identities = new Set<string>();
        for (const [index, candidate] of selection.candidates.entries()) {
            if (candidate.ordinal !== index + 1 || (index > 0 && selection.candidates[index - 1]!.documentId >= candidate.documentId)) throw new Error();
            if (candidate.classification !== "included" && candidate.artifacts.length !== 0) throw new Error();
            for (const artifact of candidate.artifacts) {
                if (artifact.byteLength > EXPORT_ARTIFACT_MAX_BYTES || identities.has(artifact.artifactIdentity)) throw new Error();
                identities.add(artifact.artifactIdentity);
                if (artifact.artifactIdentity !== artifactIdentity({ companyId, documentId: candidate.documentId,
                    artifactKind: artifact.artifactType, contentSha256: artifact.sha256, byteLength: artifact.byteLength })) throw new Error();
                artifactKey({ companyId, documentId: candidate.documentId, artifactType: artifact.artifactType, sha256: artifact.sha256 });
            }
        }
        const counts = { total: selection.candidates.length, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 };
        const countKey = { inaccessible: "inaccessible", unknown_template: "unknownTemplate", policy_pending: "policyPending",
            excluded_by_policy: "excludedByPolicy", included: "included" } as const;
        for (const candidate of selection.candidates) counts[countKey[candidate.classification]]++;
        const raw = options.snapshot;
        if (!raw || raw.status !== "ready" || raw.companyId !== companyId || raw.snapshotId !== manualBackupSnapshotId(scope)
            || raw.scopeRevision !== selection.scopeRevision || raw.policyRevision !== selection.policyRevision
            || raw.coverage?.status !== "unverified" || typeof raw.coverage.reasonCode !== "string"
            || raw.backupComplete !== false || raw.expiresAt !== null || !validUtc(raw.createdAt) || !validUtc(raw.readyAt)
            || Date.parse(raw.readyAt) < Date.parse(raw.createdAt) || !raw.counts
            || Object.keys(raw.counts).length !== Object.keys(counts).length
            || Object.entries(counts).some(([key, count]) => raw.counts[key as keyof typeof counts] !== count)) throw new Error();
        const snapshot: SnapshotView = { snapshotId: raw.snapshotId, status: "ready", companyId, scopeRevision: raw.scopeRevision,
            policyRevision: raw.policyRevision, createdAt: raw.createdAt, readyAt: raw.readyAt, expiresAt: null, counts,
            coverage: { status: "unverified", reasonCode: raw.coverage.reasonCode }, backupComplete: false };
        const exportPort = options.exportPort;
        const fence = options.fence;
        if (!exportPort || typeof exportPort.openArtifact !== "function" || !fence || typeof fence.assertActive !== "function"
            || !(fence.signal instanceof AbortSignal)) throw new Error();
        // Capability objects deliberately retain their prototypes and receiver identity.
        return new ManualRunScope({ executionScope: scope, selection, snapshot, exportPort, fence });
    } catch { throw new WorkerError("export-response-invalid"); }
}

/** Preserve required reasons first, then deterministically bound C1's safe reason array. */
export function boundedManualReasons(values: Iterable<string>): string[] {
    const unique = [...new Set(values)];
    const required = unique.filter((value) => ["coverage-unverified", "lease-lost", "source-changed", "aborted", "uncertain", "not-attempted"].includes(value));
    return [...new Set([...required, ...unique.filter(isWorkerReasonCode), ...unique])].slice(0, 64).sort();
}

type ArtifactObservation = DestinationObservation["artifacts"][number];
type Side = "local" | "drive";

/** Attempt-local observations never infer a fresh proof from the shared destination ledger. */
export class ManualRunScope {
    readonly allowedArtifacts: ReadonlySet<string>;
    readonly localFailures = new Map<string, string>();
    readonly driveFailures = new Map<string, string>();
    readonly localProof = new Set<string>();
    readonly driveProof = new Set<string>();
    readonly localManifests = new Set<string>();
    readonly driveManifests = new Set<string>();
    private readonly observations = { local: new Map<string, ArtifactObservation>(), drive: new Map<string, ArtifactObservation>() };
    private readonly proofFailures = { local: new Map<string, ArtifactObservation>(), drive: new Map<string, ArtifactObservation>() };
    private readonly attempted = { local: new Set<string>(), drive: new Set<string>() };

    constructor(readonly options: ManualRunOptions) {
        this.allowedArtifacts = new Set(options.selection.candidates.flatMap((c) => c.artifacts.map((a) => a.artifactIdentity)));
    }

    effect(documentId?: string): ExecutionEffectFence {
        const capability = this.options.fence;
        return { signal: capability.signal, assertActive: () => capability.assertActive(documentId) };
    }

    candidates(): CandidateView[] {
        return this.options.selection.candidates.map((c) => ({ ...c, reasons: [...c.reasons], artifacts: c.artifacts.map((a) => ({
            fileType: a.artifactType === "audit-trail" ? "audit_trail" : "document", artifactIdentity: a.artifactIdentity,
            sha256: a.sha256, byteSize: a.byteLength,
        })) }));
    }

    begin(side: Side, documentId: string): void { this.attempted[side].add(documentId); }
    /** A later failed check supersedes proof, even when the historical ledger entry must stay verified. */
    rejectProof(side: Side, identity: string, state: "retry_wait" | "blocked" | "integrity_error", reasonCode: WorkerReasonCode): void {
        (side === "local" ? this.localProof : this.driveProof).delete(identity);
        const observation = { artifactIdentity: identity, state, reasonCode };
        this.proofFailures[side].set(identity, observation);
        this.observations[side].set(identity, observation);
    }
    observe(side: Side, identity: string, entry: DestinationEntry | undefined): void {
        const proof = side === "local" ? this.localProof : this.driveProof;
        const failure = !proof.has(identity) && entry?.state === "verified" ? this.proofFailures[side].get(identity) : undefined;
        this.observations[side].set(identity, failure ?? { artifactIdentity: identity,
            state: proof.has(identity) ? "verified" : entry?.state === "verified" ? null : entry?.state ?? null,
            reasonCode: proof.has(identity) ? null : entry?.reasonCode ?? null });
    }

    private destination(side: Side, candidate: ManualSelectedCandidate, identity: string | null, revision: string | null,
        configured: boolean, failure: string | null, stopped: string | null): DestinationObservation {
        const base = { destinationIdentity: identity, destinationRevision: revision, artifacts: [] as ArtifactObservation[], reasons: [] as string[] };
        if (!configured) return { ...base, state: "not_required", manifestStatus: "not_required" };
        if (candidate.classification === "excluded_by_policy") return { ...base, state: "metadata_only", manifestStatus: "not_required" };
        failure ??= (side === "local" ? this.localFailures : this.driveFailures).get(candidate.documentId) ?? null;
        const attempted = this.attempted[side].has(candidate.documentId);
        const proof = side === "local" ? this.localProof : this.driveProof;
        const artifacts = candidate.artifacts.map((artifact): ArtifactObservation => proof.has(artifact.artifactIdentity)
            ? { artifactIdentity: artifact.artifactIdentity, state: "verified", reasonCode: null }
            : this.observations[side].get(artifact.artifactIdentity) ?? { artifactIdentity: artifact.artifactIdentity, state: null, reasonCode: null });
        const manifest = (side === "local" ? this.localManifests : this.driveManifests).has(candidate.documentId);
        const verified = candidate.classification === "included" && candidate.artifacts.length === 2
            && candidate.artifacts.every((a) => a.byteLength > 0 && proof.has(a.artifactIdentity)) && manifest;
        const reasons = [...new Set([...artifacts.flatMap((a) => a.reasonCode ? [a.reasonCode] : []),
            ...(failure ? [failure] : []), ...(!attempted && candidate.classification === "included" ? ["not-attempted"] : []),
            ...(stopped ? [stopped] : []), ...(candidate.classification === "included" && candidate.artifacts.length !== 2 ? ["artifact-pending"] : [])])];
        return { ...base, artifacts, reasons, state: verified ? "verified" : failure || stopped ? "blocked"
            : artifacts.some((a) => a.state === "verified") ? "partial" : "unverified",
        manifestStatus: manifest ? "verified" : candidate.artifacts.length === 0 ? "not_required" : "pending" };
    }

    results(input: { runId: string; uuid(): string; observedAtSequence: number; localIdentity: string; localRevision: string;
        driveIdentity: string | null; driveRevision: string | null; driveConfigured: boolean; localFailure: string | null;
        driveFailure: string | null; stopped: string | null }): ManualDocumentResult[] {
        return this.options.selection.candidates.map((candidate) => normalizeManualDocumentResult({ receiptId: input.uuid(), runId: input.runId,
            scope: this.options.executionScope, documentId: candidate.documentId, classification: candidate.classification,
            expectedArtifactIdentities: candidate.artifacts.map((a) => a.artifactIdentity), observedAtSequence: input.observedAtSequence,
            local: this.destination("local", candidate, input.localIdentity, input.localRevision, true, input.localFailure, input.stopped),
            drive: this.destination("drive", candidate, input.driveIdentity, input.driveRevision, input.driveConfigured, input.driveFailure, input.stopped),
            reasons: boundedManualReasons([...(input.stopped ? [input.stopped] : []), ...candidate.reasons]),
        }));
    }
}

/** Legacy summaries keep their closed reason-code vocabulary. C1 receipts retain exact safe fence reasons. */
export function legacyManualReasons(values: Iterable<string>): WorkerReasonCode[] {
    const codes = new Set<WorkerReasonCode>(["coverage-unverified"]);
    for (const value of values) {
        if (isWorkerReasonCode(value)) codes.add(value);
        else if (value === "source-changed") codes.add("version-changed");
        else if (["lease-lost", "aborted", "uncertain"].includes(value)) codes.add("export-unavailable");
    }
    return [...codes].sort();
}
