import { z } from "zod";
import { EXPORT_CLASSIFICATIONS } from "domain/eformsign-backup/export/constants";
import { parseArtifactKey } from "./archive-paths";
import {
    DESTINATION_STATES, destinationKey, transitionDestination, type DestinationState,
} from "./destination-transitions";
import {
    knownGapSchema, type KnownGap, type LedgerBodies, type LedgerRecord, LEDGER_RECORD_VERSION,
} from "./ledger-records";
import {
    artifactTypeField, count, hex64, identifier, isoUtc, isoWithOffset, opaqueId, reasonCodeField,
    relativeKeyField, runCountsSchema, runIdField, sequenceField, sequenceFloorField,
    type RunCounts,
} from "./schema-fields";
import {
    JUDGED_HISTORICAL_COVERAGES, JUDGED_SNAPSHOT_STATUSES,
    type JudgedHistoricalCoverage, type JudgedSnapshotStatus,
} from "./snapshot-status";
import { WorkerError, type WorkerReasonCode } from "./worker-error";

/**
 * Pure ledger state: the result of applying journal records one after another (contract W2, §4).
 * Built only by `applyLedgerRecord`; nothing here touches a file, a clock or the network.
 */
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
}

export interface RunState {
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

export interface StagedArtifact { sha256: string; byteLength: number; at: string }
export interface PublishedFile { sha256: string; at: string }
export interface PublishedCompletion extends PublishedFile { sequence: number }
export interface TailDiscard { byteLength: number; quarantineName: string; at: string }

export interface LedgerState {
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
    };
}

function cloneState(state: LedgerState): LedgerState {
    return {
        ...state,
        installation: state.installation && { ...state.installation },
        runs: new Map([...state.runs].map(([key, run]) => [key, { ...run, reasonCodes: [...run.reasonCodes] }])),
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
    };
}

function fail(code: WorkerReasonCode): never {
    throw new WorkerError(code);
}

function maxSequence(state: LedgerState): number {
    let max = state.sequenceFloor;
    for (const binding of state.snapshots.values()) max = Math.max(max, binding.sequence);
    for (const completion of state.completions.values()) max = Math.max(max, completion.sequence);
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
    };
    if (origin === "recovery_started") {
        draft.sequenceFloor = body.sequenceFloor ?? 0;
        for (const gap of body.knownGaps ?? []) addGap(draft, { ...gap });
    }
}

function applyTransition(draft: LedgerState, record: LedgerRecord & { type: "destination_transition" }): void {
    const { body } = record;
    const key = destinationKey(body.artifactIdentity, body.destinationIdentity, body.destinationRevision);
    const entry = draft.destinations.get(key);
    if ((entry?.state ?? null) !== body.from) fail("forbidden-transition");
    transitionDestination(body.from, body.to);
    const gapCode = body.to === "blocked"
        && (body.reasonCode === "source-removed" || body.reasonCode === "exact-bytes-unavailable")
        ? body.reasonCode : null;
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
    const key = destinationKey(body.artifactIdentity, installation.destinationIdentity, installation.destinationRevision);
    const entry = draft.destinations.get(key);
    const parsed = parseArtifactKey(body.relativeKey);
    if (!draft.artifacts.has(body.artifactIdentity) && parsed) {
        draft.artifacts.set(body.artifactIdentity, {
            documentId: parsed.documentId, artifactType: parsed.artifactType, sha256: parsed.sha256, byteLength: null,
        });
    }
    draft.destinations.set(key, {
        artifactIdentity: body.artifactIdentity,
        destinationIdentity: installation.destinationIdentity,
        destinationRevision: installation.destinationRevision,
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
            draft.runs.set(record.body.runId, {
                runId: record.body.runId, scheduledFor: record.body.scheduledFor, startedAt: record.body.startedAt,
                status: "open", snapshotId: null, sequence: null, finishedAt: null,
                snapshotStatus: null, historicalCoverage: null, reasonCodes: [], counts: null,
            });
            break;
        }
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
});
const runSchema = z.strictObject({
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
const stateJsonSchema = z.strictObject({
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
});

/** Plain, canonical-JSON-safe object (arrays instead of Map/Set, `null` instead of `undefined`). */
export function ledgerStateToJson(state: LedgerState): z.infer<typeof stateJsonSchema> {
    return {
        schemaVersion: 1,
        lastSeq: state.lastSeq,
        lastAt: state.lastAt,
        installation: state.installation && { ...state.installation },
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
    };
}

/** Strict inverse of `ledgerStateToJson`; throws `WorkerError("ledger-schema")` for anything else. */
export function ledgerStateFromJson(value: unknown): LedgerState {
    const parsed = stateJsonSchema.safeParse(value);
    if (!parsed.success) throw new WorkerError("ledger-schema");
    const json = parsed.data;
    return {
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
    };
}
