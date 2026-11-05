import { z } from "zod";
import { EXPORT_CLASSIFICATIONS } from "domain/eformsign-backup/export/constants";
import { parseArtifactKey, parseCompletionName } from "./archive-paths";
import {
    DESTINATION_STATES, destinationKey, transitionDestination, type DestinationState,
} from "./destination-transitions";
import {
    DRIVE_DESTINATION_IDENTITY_PREFIX, DRIVE_LAYOUT_REVISION_PREFIX, isDriveDestinationIdentity,
} from "./drive-layout";
import {
    driveBindingFields, knownGapSchema, type DriveBindingFields, type KnownGap, type LedgerBodies, type LedgerRecord,
    LEDGER_RECORD_VERSION, LEDGER_BODY_SCHEMAS,
} from "./ledger-records";
import {
    artifactTypeField, count, driveFileId, hex64, identifier, isoUtc, isoWithOffset, opaqueId, reasonCodeField,
    relativeKeyField, runCountsSchema, runIdField, sequenceField, sequenceFloorField,
    type RunCounts,
} from "./schema-fields";
import {
    JUDGED_HISTORICAL_COVERAGES, JUDGED_SNAPSHOT_STATUSES,
    type JudgedHistoricalCoverage, type JudgedSnapshotStatus,
} from "./snapshot-status";
import {
    manualExecutionScopeSchema, manualSelectedCandidateSchema, manualDocumentResultSchema, manualAggregateResultSchema,
    manualSelectionDigest, manualDocumentResultDigest, manualAggregateResultDigest, buildManualAggregateResult,
    validateManualDocumentResult, sameManualValue,
    type ManualExecutionScope, type ManualSelectedCandidate, type ManualDocumentResult, type ManualAggregateResult,
} from "./manual-protocol";
import { WorkerError, type WorkerReasonCode } from "./worker-error";

/**
 * Pure ledger state: the result of applying journal records one after another (contract W2, §4).
 * Built only by `applyLedgerRecord`; nothing here touches a file, a clock or the network.
 */
/**
 * The Google Drive binding of the installation (BJJ-456). `pending` after `drive_bound` (the root and its marker are still
 * being set up); `ready` after `drive_ready`. The runner and recover use only a `ready` binding.
 */
export interface DriveBinding extends DriveBindingFields {
    status: "pending" | "ready";
}

export interface Installation {
    installationId: string;
    archiveId: string;
    archiveDev: number;
    archiveIno: number;
    destinationIdentity: string;
    destinationRevision: string;
    /** `installed` for a fresh ledger, `recovery_started` for one rebuilt from the archive. */
    origin: "installed" | "recovery_started";
    priorLedgerName: string | null;
    /** The current Drive binding; `null` until `drive_bound`. A later `drive_bound` supersedes it with a new revision. */
    drive: DriveBinding | null;
}

export interface RunState {
    executionScope?: ManualExecutionScope;
    runId: string;
    scheduledFor: string | null;
    startedAt: string;
    status: "open" | "finished";
    snapshotId: string | null;
    sequence: number | null;
    finishedAt: string | null;
    snapshotStatus: JudgedSnapshotStatus | null;
    historicalCoverage: JudgedHistoricalCoverage | null;
    reasonCodes: WorkerReasonCode[];
    counts: RunCounts | null;
}

export interface SnapshotBinding {
    snapshotId: string;
    runId: string;
    sequence: number;
    scopeRevision: string;
    policyRevision: string;
    counts: Record<string, number>;
}

export interface CandidateObservation {
    snapshotId: string;
    ordinal: number;
    documentId: string;
    classification: LedgerBodies["candidate_observed"]["classification"];
    metadataRevision: string;
    artifacts: LedgerBodies["candidate_observed"]["artifacts"];
}

export interface ArtifactInfo {
    documentId: string;
    artifactType: "document" | "audit-trail";
    sha256: string;
    /** Unknown (`null`) for an artifact first seen through `recovered_verified`. */
    byteLength: number | null;
}

export interface DestinationHistoryEvent {
    seq: number;
    at: string;
    from: DestinationState | null;
    to: DestinationState;
    reasonCode: WorkerReasonCode | null;
    attempts: number;
    kind: "transition" | "recovery";
}

export interface DestinationEntry {
    artifactIdentity: string;
    destinationIdentity: string;
    destinationRevision: string;
    state: DestinationState;
    attempts: number;
    nextRetryAt: string | null;
    reasonCode: WorkerReasonCode | null;
    relativeKey: string | null;
    lastVerifiedAt: string | null;
    /** Append-only: a later `integrity_error` never removes an earlier `verified` event. */
    history: DestinationHistoryEvent[];
}

/** A Drive file or folder the worker reserved an id for before creating it (reserve-first, BJJ-456 design §7.2). */
export interface DriveNode {
    kind: "folder" | "file";
    fileId: string;
    parentFileId: string;
    status: "reserved" | "created";
}
/** A record (manifest, completion, run inventory, marker) published on Drive. */
export interface PublishedDriveRecord { sha256: string; fileId: string }

/** Key of the Drive maps: `<destinationRevision>|<nodeKey or relativeKey>`. A revision never contains `|`. */
export function driveStateKey(destinationRevision: string, key: string): string {
    return `${destinationRevision}|${key}`;
}
/** The archive path of a completion file: `eformsign/<company>/completions/<name>`. */
const DRIVE_COMPLETION_KEY = /^eformsign\/[^/]+\/completions\/([^/]+)$/;
function splitDriveStateKey(key: string): [string, string] {
    const at = key.indexOf("|");
    return [key.slice(0, at), key.slice(at + 1)];
}

export interface StagedArtifact { sha256: string; byteLength: number; at: string }
export interface PublishedFile { sha256: string; at: string }
export interface PublishedCompletion extends PublishedFile { sequence: number }
export interface TailDiscard { byteLength: number; quarantineName: string; at: string }

export interface ManualAttemptState {
    scope: ManualExecutionScope;
    candidates: Map<string, ManualSelectedCandidate>;
    ordinals: Map<number, string>;
    ready: LedgerBodies["manual_selection_ready"] | null;
    results: Map<string, { payload: ManualDocumentResult; digest: string }>;
    aggregate: { payload: ManualAggregateResult; digest: string } | null;
    delivery: "pending" | "acknowledged" | "rejected" | null;
    rejectionReason: LedgerBodies["manual_result_rejected"]["reason"] | null;
}

export interface LedgerState {
    manualAttempts?: Map<string, ManualAttemptState>;
    lastSeq: number;
    lastAt: string | null;
    installation: Installation | null;
    /** `recovery_started.sequenceFloor`; 0 for a ledger that was installed fresh. */
    sequenceFloor: number;
    runs: Map<string, RunState>;
    snapshots: Map<string, SnapshotBinding>;
    /** Candidates of the latest bound snapshot only (older snapshots are dropped at the next `snapshot_bound`). */
    candidates: Map<string, CandidateObservation>;
    artifacts: Map<string, ArtifactInfo>;
    destinations: Map<string, DestinationEntry>;
    staged: Map<string, StagedArtifact>;
    manifests: Map<string, PublishedFile>;
    completions: Map<string, PublishedCompletion>;
    terminalUnavailable: Set<string>;
    gaps: KnownGap[];
    tailDiscards: TailDiscard[];
    /** Drive nodes by `driveStateKey(revision, nodeKey)`; a later reservation of a key supersedes the earlier one. */
    driveNodes: Map<string, DriveNode>;
    /** Records published on Drive by `driveStateKey(revision, relativeKey)`. */
    driveRecords: Map<string, PublishedDriveRecord>;
    /** Records whose bytes wait in the Drive outbox, by `driveStateKey(revision, relativeKey)` -> sha256. */
    driveRecordsPending: Map<string, string>;
    /** Reservation ids a later reservation superseded, as `driveStateKey(revision, fileId)`. They are never current again. */
    driveRetiredIds: Set<string>;
}

export function emptyLedgerState(): LedgerState {
    return {
        lastSeq: 0,
        lastAt: null,
        installation: null,
        sequenceFloor: 0,
        runs: new Map(),
        snapshots: new Map(),
        candidates: new Map(),
        artifacts: new Map(),
        destinations: new Map(),
        staged: new Map(),
        manifests: new Map(),
        completions: new Map(),
        terminalUnavailable: new Set(),
        gaps: [],
        tailDiscards: [],
        driveNodes: new Map(),
        driveRecords: new Map(),
        driveRecordsPending: new Map(),
        driveRetiredIds: new Set(),
    };
}

function cloneState(state: LedgerState): LedgerState {
    return {
        ...state,
        ...(state.manualAttempts === undefined ? {} : { manualAttempts: new Map([...state.manualAttempts].map(([key, attempt]) => [key, cloneManualAttempt(attempt)])) }),
        installation: state.installation && { ...state.installation, drive: state.installation.drive && { ...state.installation.drive } },
        runs: new Map([...state.runs].map(([key, run]) => [key, { ...run, ...(run.executionScope === undefined ? {} : { executionScope: { ...run.executionScope } }), reasonCodes: [...run.reasonCodes] }])),
        snapshots: new Map(state.snapshots),
        candidates: new Map(state.candidates),
        artifacts: new Map(state.artifacts),
        destinations: new Map([...state.destinations].map(([key, entry]) => [key, { ...entry, history: [...entry.history] }])),
        staged: new Map(state.staged),
        manifests: new Map(state.manifests),
        completions: new Map(state.completions),
        terminalUnavailable: new Set(state.terminalUnavailable),
        gaps: [...state.gaps],
        tailDiscards: [...state.tailDiscards],
        driveNodes: new Map([...state.driveNodes].map(([key, node]) => [key, { ...node }])),
        driveRecords: new Map([...state.driveRecords].map(([key, record]) => [key, { ...record }])),
        driveRecordsPending: new Map(state.driveRecordsPending),
        driveRetiredIds: new Set(state.driveRetiredIds),
    };
}

function fail(code: WorkerReasonCode): never {
    throw new WorkerError(code);
}

function maxSequence(state: LedgerState): number {
    let max = state.sequenceFloor;
    for (const binding of state.snapshots.values()) max = Math.max(max, binding.sequence);
    for (const completion of state.completions.values()) max = Math.max(max, completion.sequence);
    // A completion that only Drive holds (recover imported it, the archive does not have it) still owns its sequence.
    for (const key of state.driveRecords.keys()) {
        const name = splitDriveStateKey(key)[1].match(DRIVE_COMPLETION_KEY)?.[1];
        const parsed = name === undefined ? null : parseCompletionName(name);
        if (parsed !== null) max = Math.max(max, parsed.sequence);
    }
    return max;
}

/** Contract §3 step 6: `max(ledger max, recovery floor, archive max) + 1`. Never clock based. */
export function nextSnapshotSequence(state: LedgerState, archiveMaxSequence = 0): number {
    if (!Number.isSafeInteger(archiveMaxSequence) || archiveMaxSequence < 0) fail("ledger-inconsistent");
    const next = Math.max(maxSequence(state), archiveMaxSequence) + 1;
    return next <= 999_999_999_999 ? next : fail("ledger-inconsistent");
}

export function integrityErrorCount(entry: Pick<DestinationEntry, "history">): number {
    return entry.history.filter((event) => event.to === "integrity_error").length;
}

/**
 * The one classification of the reasons a gap can carry.
 *
 * PERMANENT: the bytes are gone at the source and no later run can fetch them (`source-removed`, `exact-bytes-unavailable`).
 * These are the only reasons a destination transition turns into a known gap of the ledger, and the only completion gaps
 * `recover` brings back as known gaps.
 *
 * TRANSIENT: every other code. A completion lists these for a document it omits (`export-unavailable`, `artifact-pending`,
 * `artifact-integrity`, `archive-conflict`, `ledger-inconsistent`, `integrity-repeated`, ...): they say why that snapshot
 * lacks the document, not that its bytes are gone, so they never become historical coverage. Most can resolve on a later
 * run; `integrity-repeated` stays blocked until the source offers different bytes for the artifact.
 */
export const PERMANENT_GAP_REASONS = ["source-removed", "exact-bytes-unavailable"] as const;
export function isPermanentGapReason(code: WorkerReasonCode | null): code is typeof PERMANENT_GAP_REASONS[number] {
    return code !== null && (PERMANENT_GAP_REASONS as readonly string[]).includes(code);
}

function addGap(draft: LedgerState, gap: KnownGap): void {
    const exists = draft.gaps.some((known) => known.documentId === gap.documentId
        && known.artifactIdentity === gap.artifactIdentity && known.reasonCode === gap.reasonCode);
    if (!exists) draft.gaps.push(gap);
}

/** Document of an artifact: from an observed candidate, else from the artifact key of the record. */
function documentOf(draft: LedgerState, artifactIdentity: string, relativeKey: string | null): string {
    const known = draft.artifacts.get(artifactIdentity);
    if (known) return known.documentId;
    const parsed = relativeKey === null ? null : parseArtifactKey(relativeKey);
    return parsed ? parsed.documentId : fail("ledger-inconsistent");
}

function requireInstallation(draft: LedgerState): Installation {
    return draft.installation ?? fail("ledger-first-record");
}

/** The identity and revision of a Drive binding follow from its root and binding ids; anything else is a corrupt record. */
function assertBindingConsistent(binding: DriveBindingFields): void {
    if (binding.destinationIdentity !== `${DRIVE_DESTINATION_IDENTITY_PREFIX}${binding.rootFolderId}`
        || binding.destinationRevision !== `${DRIVE_LAYOUT_REVISION_PREFIX}${binding.bindingId}`) fail("ledger-inconsistent");
}

function sameBinding(left: DriveBindingFields, right: DriveBindingFields): boolean {
    return (Object.keys(driveBindingFields) as Array<keyof DriveBindingFields>).every((field) => left[field] === right[field]);
}

/** A Drive result or reservation only belongs to the binding that is current when it is recorded (T29). */
function assertCurrentDriveBinding(draft: LedgerState, identity: string, revision: string): DriveBinding {
    const drive = requireInstallation(draft).drive;
    if (drive === null || drive.destinationIdentity !== identity || drive.destinationRevision !== revision) fail("ledger-inconsistent");
    return drive;
}

function requireDriveRevision(draft: LedgerState, revision: string): DriveBinding {
    const drive = requireInstallation(draft).drive;
    if (drive === null || drive.destinationRevision !== revision) fail("ledger-inconsistent");
    return drive;
}

function applyInstall(
    draft: LedgerState, origin: Installation["origin"],
    body: LedgerBodies["installed"] & Partial<LedgerBodies["recovery_started"]>,
): void {
    if (draft.installation !== null) fail("ledger-duplicate-install");
    draft.installation = {
        installationId: body.installationId,
        archiveId: body.archiveId,
        archiveDev: body.archiveDev,
        archiveIno: body.archiveIno,
        destinationIdentity: body.destinationIdentity,
        destinationRevision: body.destinationRevision,
        origin,
        priorLedgerName: body.priorLedgerName ?? null,
        drive: null,
    };
    if (body.drive !== undefined) {
        assertBindingConsistent(body.drive);
        draft.installation.drive = { ...body.drive, status: "pending" };
    }
    if (origin === "recovery_started") {
        draft.sequenceFloor = body.sequenceFloor ?? 0;
        for (const gap of body.knownGaps ?? []) addGap(draft, { ...gap });
    }
}

function applyTransition(draft: LedgerState, record: LedgerRecord & { type: "destination_transition" }): void {
    const { body } = record;
    if (isDriveDestinationIdentity(body.destinationIdentity)) {
        assertCurrentDriveBinding(draft, body.destinationIdentity, body.destinationRevision);
    }
    const key = destinationKey(body.artifactIdentity, body.destinationIdentity, body.destinationRevision);
    const entry = draft.destinations.get(key);
    if ((entry?.state ?? null) !== body.from) fail("forbidden-transition");
    transitionDestination(body.from, body.to);
    const gapCode = body.to === "blocked" && isPermanentGapReason(body.reasonCode) ? body.reasonCode : null;
    if (gapCode !== null) {
        const documentId = documentOf(draft, body.artifactIdentity, body.relativeKey ?? entry?.relativeKey ?? null);
        if (gapCode === "source-removed") draft.terminalUnavailable.add(body.artifactIdentity);
        addGap(draft, { documentId, artifactIdentity: body.artifactIdentity, reasonCode: gapCode });
    }
    const event: DestinationHistoryEvent = {
        seq: record.seq, at: record.at, from: body.from, to: body.to,
        reasonCode: body.reasonCode, attempts: body.attempts, kind: "transition",
    };
    draft.destinations.set(key, {
        artifactIdentity: body.artifactIdentity,
        destinationIdentity: body.destinationIdentity,
        destinationRevision: body.destinationRevision,
        state: body.to,
        attempts: body.attempts,
        nextRetryAt: body.nextRetryAt,
        reasonCode: body.reasonCode,
        relativeKey: body.relativeKey ?? entry?.relativeKey ?? null,
        lastVerifiedAt: body.to === "verified" ? record.at : entry?.lastVerifiedAt ?? null,
        history: [...(entry?.history ?? []), event],
    });
}

function applyRecovered(draft: LedgerState, record: LedgerRecord & { type: "recovered_verified" }): void {
    const { body } = record;
    const installation = requireInstallation(draft);
    let destinationIdentity = installation.destinationIdentity;
    let destinationRevision = installation.destinationRevision;
    const driveFields = [body.destinationIdentity, body.destinationRevision, body.fileId].filter((field) => field !== undefined).length;
    if (driveFields !== 0 && driveFields !== 3) fail("ledger-schema");
    if (body.destinationIdentity !== undefined && body.destinationRevision !== undefined) {
        // A Drive result is for the current binding only: another revision's verification is never carried over.
        assertCurrentDriveBinding(draft, body.destinationIdentity, body.destinationRevision);
        destinationIdentity = body.destinationIdentity;
        destinationRevision = body.destinationRevision;
    }
    const key = destinationKey(body.artifactIdentity, destinationIdentity, destinationRevision);
    const entry = draft.destinations.get(key);
    const parsed = parseArtifactKey(body.relativeKey);
    if (!draft.artifacts.has(body.artifactIdentity) && parsed) {
        draft.artifacts.set(body.artifactIdentity, {
            documentId: parsed.documentId, artifactType: parsed.artifactType, sha256: parsed.sha256, byteLength: null,
        });
    }
    draft.destinations.set(key, {
        artifactIdentity: body.artifactIdentity,
        destinationIdentity,
        destinationRevision,
        state: "verified",
        attempts: entry?.attempts ?? 0,
        nextRetryAt: null,
        reasonCode: null,
        relativeKey: body.relativeKey,
        lastVerifiedAt: record.at,
        history: [...(entry?.history ?? []), {
            seq: record.seq, at: record.at, from: entry?.state ?? null, to: "verified",
            reasonCode: null, attempts: entry?.attempts ?? 0, kind: "recovery",
        }],
    });
}

function applyDriveBound(draft: LedgerState, body: LedgerBodies["drive_bound"]): void {
    const installation = requireInstallation(draft);
    assertBindingConsistent(body);
    const known = installation.drive;
    if (known !== null && known.destinationRevision === body.destinationRevision) {
        // The same binding again changes nothing (and keeps its status); the same revision for other fields is corrupt.
        if (!sameBinding(known, body)) fail("ledger-inconsistent");
        return;
    }
    installation.drive = { ...body, status: "pending" };
}

type ManualRecord = Extract<LedgerRecord, { type: `manual_${string}` }>;

function newManualAttempt(scope: ManualExecutionScope): ManualAttemptState {
    return { scope: { ...scope }, candidates: new Map(), ordinals: new Map(), ready: null,
        results: new Map(), aggregate: null, delivery: null, rejectionReason: null };
}

function cloneManualAttempt(attempt: ManualAttemptState): ManualAttemptState {
    return {
        ...attempt, scope: { ...attempt.scope }, ordinals: new Map(attempt.ordinals),
        candidates: new Map([...attempt.candidates].map(([key, candidate]) => [key, manualSelectedCandidateSchema.parse(candidate)])),
        ready: attempt.ready && { ...attempt.ready },
        results: new Map([...attempt.results].map(([key, result]) => [key, { digest: result.digest, payload: manualDocumentResultSchema.parse(result.payload) }])),
        aggregate: attempt.aggregate && { digest: attempt.aggregate.digest, payload: manualAggregateResultSchema.parse(attempt.aggregate.payload) },
    };
}

function manualSelection(attempt: ManualAttemptState, ready: LedgerBodies["manual_selection_ready"]) {
    return { jobId: attempt.scope.jobId, companyId: attempt.scope.companyId, branchId: attempt.scope.branchId,
        scopeRevision: ready.scopeRevision, policyRevision: ready.policyRevision, candidates: [...attempt.candidates.values()] };
}

/** Shared invariant checker for journal transitions and strict checkpoint reconstruction. */
function applyManualRecord(draft: LedgerState, raw: ManualRecord): void {
    const checked = LEDGER_BODY_SCHEMAS[raw.type].safeParse(raw.body);
    if (!checked.success) fail("ledger-inconsistent");
    const record = { ...raw, body: checked.data } as ManualRecord;
    const body = record.body;
    const runId = "payload" in body ? body.payload.runId : body.runId;
    const run = draft.runs.get(runId);
    const attempt = draft.manualAttempts?.get(runId);
    if (!run?.executionScope || !attempt || !sameManualValue(run.executionScope, attempt.scope)) fail("ledger-inconsistent");
    const callback = record.type === "manual_result_acknowledged" || record.type === "manual_result_rejected";
    if (!callback && run.status !== "open") fail("ledger-inconsistent");
    switch (record.type) {
        case "manual_candidate_selected": {
            const candidate = record.body.candidate;
            const known = attempt.candidates.get(candidate.documentId);
            if (known) {
                if (!sameManualValue(known, candidate)) fail("ledger-inconsistent");
                return;
            }
            if (attempt.ready !== null || attempt.ordinals.has(candidate.ordinal)) fail("ledger-inconsistent");
            attempt.candidates.set(candidate.documentId, candidate);
            attempt.ordinals.set(candidate.ordinal, candidate.documentId);
            return;
        }
        case "manual_selection_ready": {
            const ready = record.body;
            if (attempt.ready !== null) {
                if (!sameManualValue(attempt.ready, ready)) fail("ledger-inconsistent");
                return;
            }
            if (ready.candidateCount !== attempt.candidates.size || ready.selectionDigest !== attempt.scope.selectionDigest
                || ready.selectionDigest !== manualSelectionDigest(manualSelection(attempt, ready))) fail("ledger-inconsistent");
            attempt.ready = ready;
            return;
        }
        case "manual_document_result": {
            const { payload, digest } = record.body;
            const candidate = attempt.candidates.get(payload.documentId);
            if (!attempt.ready || !candidate || !sameManualValue(payload.scope, attempt.scope)
                || payload.observedAtSequence > draft.lastSeq || digest !== manualDocumentResultDigest(payload)) fail("ledger-inconsistent");
            validateManualDocumentResult(candidate, payload);
            const known = attempt.results.get(payload.documentId);
            if (known) {
                if (!sameManualValue(known, record.body)) fail("ledger-inconsistent");
                return;
            }
            if (attempt.aggregate !== null || [...attempt.results.values()].some((r) => r.payload.receiptId === payload.receiptId)) fail("ledger-inconsistent");
            attempt.results.set(payload.documentId, record.body);
            return;
        }
        case "manual_result_ready": {
            const { payload, digest } = record.body;
            if (!attempt.ready || !sameManualValue(payload.scope, attempt.scope)
                || digest !== manualAggregateResultDigest(payload)) fail("ledger-inconsistent");
            const derived = buildManualAggregateResult({ receiptId: payload.receiptId, runId, scope: attempt.scope,
                selection: manualSelection(attempt, attempt.ready), results: [...attempt.results.values()].map((r) => r.payload),
                status: payload.status, reasons: payload.reasons });
            if (!sameManualValue(derived, payload)) fail("ledger-inconsistent");
            if (attempt.aggregate !== null) {
                if (!sameManualValue(attempt.aggregate, record.body)) fail("ledger-inconsistent");
                return;
            }
            if ([...attempt.results.values()].some((r) => r.payload.receiptId === payload.receiptId)) fail("ledger-inconsistent");
            attempt.aggregate = record.body;
            attempt.delivery = "pending";
            return;
        }
        case "manual_result_acknowledged":
        case "manual_result_rejected": {
            const callbackBody = record.body;
            if (!attempt.aggregate || callbackBody.receiptId !== attempt.aggregate.payload.receiptId
                || callbackBody.digest !== attempt.aggregate.digest) fail("ledger-inconsistent");
            const next = record.type === "manual_result_acknowledged" ? "acknowledged" : "rejected";
            const reason = record.type === "manual_result_rejected" ? record.body.reason : null;
            if (attempt.delivery !== "pending" && (attempt.delivery !== next || attempt.rejectionReason !== reason)) fail("ledger-inconsistent");
            attempt.delivery = next;
            attempt.rejectionReason = reason;
            return;
        }
    }
}

function applyRecord(draft: LedgerState, record: LedgerRecord): void {
    if (record.v !== LEDGER_RECORD_VERSION) fail("ledger-schema");
    if (record.seq !== draft.lastSeq + 1) fail("ledger-seq-gap");
    if (draft.lastSeq === 0 && record.type !== "installed" && record.type !== "recovery_started") {
        fail("ledger-first-record");
    }
    switch (record.type) {
        case "installed":
            applyInstall(draft, "installed", record.body);
            break;
        case "recovery_started":
            applyInstall(draft, "recovery_started", record.body);
            break;
        case "run_started": {
            if (draft.runs.has(record.body.runId)) fail("ledger-inconsistent");
            const scope = record.body.executionScope === undefined ? undefined : manualExecutionScopeSchema.safeParse(record.body.executionScope);
            if (scope !== undefined && !scope.success) fail("ledger-inconsistent");
            draft.runs.set(record.body.runId, {
                runId: record.body.runId, scheduledFor: record.body.scheduledFor, startedAt: record.body.startedAt,
                status: "open", snapshotId: null, sequence: null, finishedAt: null,
                snapshotStatus: null, historicalCoverage: null, reasonCodes: [], counts: null,
                ...(record.body.executionScope === undefined ? {} : { executionScope: scope !== undefined && scope.success ? scope.data : undefined }),
            });
            if (record.body.executionScope !== undefined) {
                draft.manualAttempts ??= new Map();
                draft.manualAttempts.set(record.body.runId, newManualAttempt(draft.runs.get(record.body.runId)!.executionScope!));
            }
            break;
        }
        case "manual_candidate_selected":
        case "manual_selection_ready":
        case "manual_document_result":
        case "manual_result_ready":
        case "manual_result_acknowledged":
        case "manual_result_rejected":
            applyManualRecord(draft, record);
            break;
        case "snapshot_bound": {
            const { body } = record;
            const run = draft.runs.get(body.runId);
            if (!run || run.status !== "open") fail("ledger-inconsistent");
            const existing = draft.snapshots.get(body.snapshotId);
            if (existing) {
                // Same snapshot again: the earlier sequence is reused, never reassigned.
                if (existing.sequence !== body.sequence) fail("ledger-inconsistent");
            } else if (body.sequence <= maxSequence(draft)) {
                fail("ledger-inconsistent");
            }
            draft.snapshots.set(body.snapshotId, existing ?? {
                snapshotId: body.snapshotId, runId: body.runId, sequence: body.sequence,
                scopeRevision: body.scopeRevision, policyRevision: body.policyRevision, counts: { ...body.counts },
            });
            run.snapshotId = body.snapshotId;
            run.sequence = existing?.sequence ?? body.sequence;
            for (const [key, candidate] of draft.candidates) {
                if (candidate.snapshotId !== body.snapshotId) draft.candidates.delete(key);
            }
            break;
        }
        case "candidate_observed": {
            const { body } = record;
            if (!draft.snapshots.has(body.snapshotId)) fail("ledger-inconsistent");
            draft.candidates.set(`${body.snapshotId}|${body.ordinal}`, {
                snapshotId: body.snapshotId, ordinal: body.ordinal, documentId: body.documentId,
                classification: body.classification, metadataRevision: body.metadataRevision,
                artifacts: body.artifacts.map((artifact) => ({ ...artifact })),
            });
            for (const artifact of body.artifacts) {
                draft.artifacts.set(artifact.artifactIdentity, {
                    documentId: body.documentId, artifactType: artifact.artifactType,
                    sha256: artifact.sha256, byteLength: artifact.byteLength,
                });
            }
            break;
        }
        case "destination_transition":
            applyTransition(draft, record);
            break;
        case "staging_verified":
            draft.staged.set(record.body.artifactIdentity, {
                sha256: record.body.sha256, byteLength: record.body.byteLength, at: record.at,
            });
            break;
        case "manifest_published": {
            const known = draft.manifests.get(record.body.relativeKey);
            if (known && known.sha256 !== record.body.sha256) fail("archive-conflict");
            if (!known) draft.manifests.set(record.body.relativeKey, { sha256: record.body.sha256, at: record.at });
            break;
        }
        case "completion_published": {
            const known = draft.completions.get(record.body.relativeKey);
            if (known && known.sha256 !== record.body.sha256) fail("archive-conflict");
            if (!known) {
                draft.completions.set(record.body.relativeKey, {
                    sha256: record.body.sha256, sequence: record.body.sequence, at: record.at,
                });
            }
            break;
        }
        case "run_finished": {
            const { body } = record;
            const run = draft.runs.get(body.runId);
            if (!run || run.status !== "open") fail("ledger-inconsistent");
            Object.assign(run, {
                status: "finished", finishedAt: body.finishedAt, snapshotStatus: body.snapshotStatus,
                historicalCoverage: body.historicalCoverage, reasonCodes: [...body.reasonCodes], counts: { ...body.counts },
            });
            break;
        }
        case "tail_discarded":
            draft.tailDiscards.push({ byteLength: record.body.byteLength, quarantineName: record.body.quarantineName, at: record.at });
            break;
        case "recovered_verified":
            applyRecovered(draft, record);
            break;
        case "drive_bound":
            applyDriveBound(draft, record.body);
            break;
        case "drive_ready": {
            const drive = requireDriveRevision(draft, record.body.destinationRevision);
            draft.installation!.drive = { ...drive, status: "ready" };
            break;
        }
        case "drive_node_reserved": {
            const { body } = record;
            requireDriveRevision(draft, body.destinationRevision);
            const key = driveStateKey(body.destinationRevision, body.nodeKey);
            const known = draft.driveNodes.get(key);
            // A reservation names an id nobody used before: not the current one, and not one an earlier supersession retired.
            if (known?.fileId === body.fileId || draft.driveRetiredIds.has(driveStateKey(body.destinationRevision, body.fileId))) {
                fail("ledger-inconsistent");
            }
            if (known !== undefined) draft.driveRetiredIds.add(driveStateKey(body.destinationRevision, known.fileId));
            draft.driveNodes.set(key, { kind: body.kind, fileId: body.fileId, parentFileId: body.parentFileId, status: "reserved" });
            break;
        }
        case "drive_node_created": {
            const { body } = record;
            requireDriveRevision(draft, body.destinationRevision);
            const key = driveStateKey(body.destinationRevision, body.nodeKey);
            const node = draft.driveNodes.get(key);
            if (node === undefined || node.fileId !== body.fileId) fail("ledger-inconsistent");
            draft.driveNodes.set(key, { ...node, status: "created" });
            break;
        }
        case "drive_record_published": {
            const { body } = record;
            requireDriveRevision(draft, body.destinationRevision);
            const key = driveStateKey(body.destinationRevision, body.relativeKey);
            const known = draft.driveRecords.get(key);
            const waiting = draft.driveRecordsPending.get(key);
            if ((known !== undefined && known.sha256 !== body.sha256) || (waiting !== undefined && waiting !== body.sha256)) fail("drive-conflict");
            draft.driveRecords.set(key, { sha256: body.sha256, fileId: body.fileId });
            draft.driveRecordsPending.delete(key);
            break;
        }
        case "drive_record_pending": {
            const { body } = record;
            requireDriveRevision(draft, body.destinationRevision);
            const key = driveStateKey(body.destinationRevision, body.relativeKey);
            const known = draft.driveRecords.get(key);
            const waiting = draft.driveRecordsPending.get(key);
            if ((known !== undefined && known.sha256 !== body.sha256) || (waiting !== undefined && waiting !== body.sha256)) fail("drive-conflict");
            // Already published with these bytes: nothing is left to publish.
            if (known === undefined) draft.driveRecordsPending.set(key, body.sha256);
            break;
        }
        default:
            fail("ledger-schema");
    }
    draft.lastSeq = record.seq;
    draft.lastAt = record.at;
}

/** Applies one record and returns a new state; `state` is left untouched. */
export function applyLedgerRecord(state: LedgerState, record: LedgerRecord): LedgerState {
    const draft = cloneState(state);
    applyRecord(draft, record);
    return draft;
}

/** Applies records in order, copying `state` once. Use it for replay; it is `applyLedgerRecord` folded. */
export function applyLedgerRecords(state: LedgerState, records: Iterable<LedgerRecord>): LedgerState {
    const draft = cloneState(state);
    for (const record of records) applyRecord(draft, record);
    return draft;
}

// ----- checkpoint (de)serialisation ---------------------------------------------------------------------------

const installationSchema = z.strictObject({
    installationId: identifier,
    archiveId: identifier,
    archiveDev: count,
    archiveIno: count,
    destinationIdentity: identifier,
    destinationRevision: identifier,
    origin: z.enum(["installed", "recovery_started"]),
    priorLedgerName: z.string().min(1).max(128).nullable(),
    // Absent in a checkpoint written before the Drive destination existed.
    drive: z.strictObject({ ...driveBindingFields, status: z.enum(["pending", "ready"]) }).nullable().default(null),
});
const runSchema = z.strictObject({
    executionScope: manualExecutionScopeSchema.optional(),
    runId: runIdField,
    scheduledFor: isoWithOffset.nullable(),
    startedAt: isoUtc,
    status: z.enum(["open", "finished"]),
    snapshotId: identifier.nullable(),
    sequence: sequenceField.nullable(),
    finishedAt: isoUtc.nullable(),
    snapshotStatus: z.enum(JUDGED_SNAPSHOT_STATUSES).nullable(),
    historicalCoverage: z.enum(JUDGED_HISTORICAL_COVERAGES).nullable(),
    reasonCodes: z.array(reasonCodeField),
    counts: runCountsSchema.nullable(),
});
const historyEventSchema = z.strictObject({
    seq: sequenceField,
    at: isoUtc,
    from: z.enum(DESTINATION_STATES).nullable(),
    to: z.enum(DESTINATION_STATES),
    reasonCode: reasonCodeField.nullable(),
    attempts: count,
    kind: z.enum(["transition", "recovery"]),
});
const destinationSchema = z.strictObject({
    artifactIdentity: hex64,
    destinationIdentity: identifier,
    destinationRevision: identifier,
    state: z.enum(DESTINATION_STATES),
    attempts: count,
    nextRetryAt: isoUtc.nullable(),
    reasonCode: reasonCodeField.nullable(),
    relativeKey: relativeKeyField.nullable(),
    lastVerifiedAt: isoUtc.nullable(),
    history: z.array(historyEventSchema),
});
const candidateSchema = z.strictObject({
    snapshotId: identifier,
    ordinal: count,
    documentId: opaqueId,
    classification: z.enum(EXPORT_CLASSIFICATIONS),
    metadataRevision: hex64,
    artifacts: z.array(z.strictObject({
        artifactType: artifactTypeField, artifactIdentity: hex64, sha256: hex64, byteLength: count,
    })).max(2),
});
const manualAttemptJsonSchema = z.strictObject({
    runId: runIdField, scope: manualExecutionScopeSchema, candidates: z.array(manualSelectedCandidateSchema),
    ready: LEDGER_BODY_SCHEMAS.manual_selection_ready.nullable(),
    results: z.array(LEDGER_BODY_SCHEMAS.manual_document_result),
    aggregate: LEDGER_BODY_SCHEMAS.manual_result_ready.nullable(),
    delivery: z.enum(["pending", "acknowledged", "rejected"]).nullable(),
    rejectionReason: LEDGER_BODY_SCHEMAS.manual_result_rejected.shape.reason.nullable(),
});
const stateJsonSchema = z.strictObject({
    manualAttempts: z.array(manualAttemptJsonSchema).min(1).optional(),
    schemaVersion: z.literal(1),
    lastSeq: count,
    lastAt: isoUtc.nullable(),
    installation: installationSchema.nullable(),
    sequenceFloor: sequenceFloorField,
    runs: z.array(runSchema),
    snapshots: z.array(z.strictObject({
        snapshotId: identifier, runId: runIdField, sequence: sequenceField,
        scopeRevision: identifier, policyRevision: identifier, counts: z.record(z.string().min(1).max(64), count),
    })),
    candidates: z.array(candidateSchema),
    artifacts: z.array(z.strictObject({
        artifactIdentity: hex64, documentId: opaqueId, artifactType: artifactTypeField,
        sha256: hex64, byteLength: count.nullable(),
    })),
    destinations: z.array(destinationSchema),
    staged: z.array(z.strictObject({ artifactIdentity: hex64, sha256: hex64, byteLength: count, at: isoUtc })),
    manifests: z.array(z.strictObject({ relativeKey: relativeKeyField, sha256: hex64, at: isoUtc })),
    completions: z.array(z.strictObject({ relativeKey: relativeKeyField, sha256: hex64, sequence: sequenceField, at: isoUtc })),
    terminalUnavailable: z.array(hex64),
    gaps: z.array(knownGapSchema),
    tailDiscards: z.array(z.strictObject({ byteLength: count, quarantineName: z.string().min(1).max(128), at: isoUtc })),
    // The four Drive arrays are absent in a checkpoint written before the Drive destination existed.
    driveNodes: z.array(z.strictObject({
        destinationRevision: identifier, nodeKey: relativeKeyField, kind: z.enum(["folder", "file"]),
        fileId: driveFileId, parentFileId: driveFileId, status: z.enum(["reserved", "created"]),
    })).default([]),
    driveRecords: z.array(z.strictObject({
        destinationRevision: identifier, relativeKey: relativeKeyField, sha256: hex64, fileId: driveFileId,
    })).default([]),
    driveRecordsPending: z.array(z.strictObject({
        destinationRevision: identifier, relativeKey: relativeKeyField, sha256: hex64,
    })).default([]),
    driveRetiredIds: z.array(z.strictObject({ destinationRevision: identifier, fileId: driveFileId })).default([]),
});

/** Plain, canonical-JSON-safe object (arrays instead of Map/Set, `null` instead of `undefined`). */
export function ledgerStateToJson(state: LedgerState): z.infer<typeof stateJsonSchema> {
    return {
        ...(state.manualAttempts === undefined ? {} : { manualAttempts: [...state.manualAttempts].map(([runId, original]) => {
            const attempt = cloneManualAttempt(original);
            return { runId, scope: attempt.scope, candidates: [...attempt.candidates.values()],
                ready: attempt.ready, results: [...attempt.results.values()], aggregate: attempt.aggregate,
                delivery: attempt.delivery, rejectionReason: attempt.rejectionReason };
        }) }),
        schemaVersion: 1,
        lastSeq: state.lastSeq,
        lastAt: state.lastAt,
        installation: state.installation && { ...state.installation, drive: state.installation.drive && { ...state.installation.drive } },
        sequenceFloor: state.sequenceFloor,
        runs: [...state.runs.values()].map((run) => ({
            ...run, reasonCodes: [...run.reasonCodes], counts: run.counts && { ...run.counts },
        })),
        snapshots: [...state.snapshots.values()].map((snapshot) => ({ ...snapshot, counts: { ...snapshot.counts } })),
        candidates: [...state.candidates.values()].map((candidate) => ({
            ...candidate, artifacts: candidate.artifacts.map((artifact) => ({ ...artifact })),
        })),
        artifacts: [...state.artifacts].map(([artifactIdentity, info]) => ({ artifactIdentity, ...info })),
        destinations: [...state.destinations.values()].map((entry) => ({
            ...entry, history: entry.history.map((event) => ({ ...event })),
        })),
        staged: [...state.staged].map(([artifactIdentity, staged]) => ({ artifactIdentity, ...staged })),
        manifests: [...state.manifests].map(([relativeKey, file]) => ({ relativeKey, ...file })),
        completions: [...state.completions].map(([relativeKey, file]) => ({ relativeKey, ...file })),
        terminalUnavailable: [...state.terminalUnavailable],
        gaps: state.gaps.map((gap) => ({ ...gap })),
        tailDiscards: state.tailDiscards.map((discard) => ({ ...discard })),
        driveNodes: [...state.driveNodes].map(([key, node]) => {
            const [destinationRevision, nodeKey] = splitDriveStateKey(key);
            return { destinationRevision, nodeKey, ...node };
        }),
        driveRecords: [...state.driveRecords].map(([key, record]) => {
            const [destinationRevision, relativeKey] = splitDriveStateKey(key);
            return { destinationRevision, relativeKey, ...record };
        }),
        driveRecordsPending: [...state.driveRecordsPending].map(([key, sha256]) => {
            const [destinationRevision, relativeKey] = splitDriveStateKey(key);
            return { destinationRevision, relativeKey, sha256 };
        }),
        driveRetiredIds: [...state.driveRetiredIds].map((key) => {
            const [destinationRevision, fileId] = splitDriveStateKey(key);
            return { destinationRevision, fileId };
        }),
    };
}

/** Strict inverse of `ledgerStateToJson`; throws `WorkerError("ledger-schema")` for anything else. */
export function ledgerStateFromJson(value: unknown): LedgerState {
    const parsed = stateJsonSchema.safeParse(value);
    if (!parsed.success) throw new WorkerError("ledger-schema");
    const json = parsed.data;
    const state: LedgerState = {
        lastSeq: json.lastSeq,
        lastAt: json.lastAt,
        installation: json.installation,
        sequenceFloor: json.sequenceFloor,
        runs: new Map(json.runs.map((run) => [run.runId, run])),
        snapshots: new Map(json.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot])),
        candidates: new Map(json.candidates.map((candidate) => [
            `${candidate.snapshotId}|${candidate.ordinal}`, candidate,
        ])),
        artifacts: new Map(json.artifacts.map(({ artifactIdentity, ...info }) => [artifactIdentity, info])),
        destinations: new Map(json.destinations.map((entry) => [
            destinationKey(entry.artifactIdentity, entry.destinationIdentity, entry.destinationRevision), entry,
        ])),
        staged: new Map(json.staged.map(({ artifactIdentity, ...staged }) => [artifactIdentity, staged])),
        manifests: new Map(json.manifests.map(({ relativeKey, ...file }) => [relativeKey, file])),
        completions: new Map(json.completions.map(({ relativeKey, ...file }) => [relativeKey, file])),
        terminalUnavailable: new Set(json.terminalUnavailable),
        gaps: json.gaps,
        tailDiscards: json.tailDiscards,
        driveNodes: new Map(json.driveNodes.map(({ destinationRevision, nodeKey, ...node }) => [driveStateKey(destinationRevision, nodeKey), node])),
        driveRecords: new Map(json.driveRecords.map(({ destinationRevision, relativeKey, ...record }) => [driveStateKey(destinationRevision, relativeKey), record])),
        driveRecordsPending: new Map(json.driveRecordsPending.map((pending) => [driveStateKey(pending.destinationRevision, pending.relativeKey), pending.sha256])),
        driveRetiredIds: new Set(json.driveRetiredIds.map((retired) => driveStateKey(retired.destinationRevision, retired.fileId))),
    };
    if (new Set(json.runs.map((run) => run.runId)).size !== json.runs.length) fail("ledger-inconsistent");
    const manualRuns = json.runs.filter((run) => run.executionScope !== undefined);
    if (manualRuns.length !== (json.manualAttempts?.length ?? 0)) fail("ledger-inconsistent");
    if (json.manualAttempts !== undefined) {
        state.manualAttempts = new Map();
        for (const entry of json.manualAttempts) {
            const run = state.runs.get(entry.runId);
            if (!run?.executionScope || state.manualAttempts.has(entry.runId)
                || !sameManualValue(run.executionScope, entry.scope)
                || new Set(entry.candidates.map((c) => c.documentId)).size !== entry.candidates.length
                || new Set(entry.candidates.map((c) => c.ordinal)).size !== entry.candidates.length
                || new Set(entry.results.map((r) => r.payload.documentId)).size !== entry.results.length) fail("ledger-inconsistent");
            const attempt = newManualAttempt(entry.scope);
            state.manualAttempts.set(entry.runId, attempt);
            // Validate all immutable observations while the reconstructed run is open. Only delivery may follow finish.
            const validation: LedgerState = { ...state, lastSeq: json.lastSeq - 1,
                runs: new Map([[entry.runId, { ...run, status: "open" }]]) };
            const apply = (record: ManualRecord) => applyManualRecord(validation, record);
            const envelope = { v: LEDGER_RECORD_VERSION, seq: json.lastSeq, at: run.startedAt } as const;
            for (const candidate of entry.candidates) apply({ ...envelope, type: "manual_candidate_selected", body: { runId: entry.runId, candidate } });
            if (entry.ready) {
                if (entry.ready.runId !== entry.runId) fail("ledger-inconsistent");
                apply({ ...envelope, type: "manual_selection_ready", body: entry.ready });
            }
            for (const result of entry.results) {
                if (result.payload.runId !== entry.runId) fail("ledger-inconsistent");
                apply({ ...envelope, type: "manual_document_result", body: result });
            }
            if (entry.aggregate) {
                if (entry.aggregate.payload.runId !== entry.runId) fail("ledger-inconsistent");
                apply({ ...envelope, type: "manual_result_ready", body: entry.aggregate });
            }
            if (entry.delivery === "acknowledged" || entry.delivery === "rejected") {
                if (!entry.aggregate) fail("ledger-inconsistent");
                const body = { runId: entry.runId, receiptId: entry.aggregate.payload.receiptId, digest: entry.aggregate.digest };
                if (entry.delivery === "acknowledged") apply({ ...envelope, type: "manual_result_acknowledged", body });
                else {
                    if (entry.rejectionReason === null) fail("ledger-inconsistent");
                    apply({ ...envelope, type: "manual_result_rejected", body: { ...body, reason: entry.rejectionReason } });
                }
            }
            if (attempt.delivery !== entry.delivery || attempt.rejectionReason !== entry.rejectionReason) fail("ledger-inconsistent");
        }
    }
    return state;
}
