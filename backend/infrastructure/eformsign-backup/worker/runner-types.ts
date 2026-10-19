import type {
    JudgedHistoricalCoverage, JudgedSnapshotStatus, RunCounts, WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import type { ArtifactRequest, CandidatePageView, SnapshotView } from "./export-client";
import type { FsProbe } from "./fs-probe";
import type { LedgerFaultPoint, LedgerStore } from "./ledger-store";
import type { LocalDestination } from "./local-destination";
import type { WorkerConfig } from "./config";

/** Where a test can stop the runner (contract section 7, T-WRK-17). Production code never sets a hook. */
export const RUNNER_FAULT_POINTS = [
    "after-transferring",
    "after-staged-before-staging_verified",
    "after-publish-before-verifying",
    "after-verifying-before-verified",
    "after-manifest-before-record",
    "after-completion-before-record",
] as const;
export type RunnerFaultPoint = typeof RUNNER_FAULT_POINTS[number];
export type RunnerFault = (point: RunnerFaultPoint) => void | Promise<void>;

export interface Clock {
    now(): Date;
}

/** The slice of `ExportClient` the runner calls; tests and the real client both satisfy it. */
export interface ExportPort {
    createSnapshot(idempotencyKey: string): Promise<SnapshotView>;
    getSnapshot(snapshotId: string): Promise<SnapshotView>;
    listCandidates(snapshotId: string, cursor: string | null): Promise<CandidatePageView>;
    openArtifact(snapshotId: string, artifact: ArtifactRequest): Promise<AsyncIterable<Uint8Array>>;
}

export const LOCAL_DESTINATION_REVISION = "local-layout-v1";
export function localDestinationIdentity(archiveId: string): string {
    return `local:${archiveId}`;
}

export interface RunnerDependencies {
    config: WorkerConfig;
    clock: Clock;
    uuid: () => string;
    probe: FsProbe;
    sleep: (ms: number) => Promise<void>;
    ledger: LedgerStore;
    /** Opens the ledger again after `recover` restored the control marker (the replay result depends on it). */
    reopenLedger?: () => Promise<LedgerStore>;
    /** Builds the archive side for a given installed root identity (`init` and `recover` pick it from the live archive). */
    createDestination(identity: { dev: number; ino: number }): LocalDestination;
    /** `null` for every command except `run`. */
    exportClient: ExportPort | null;
    compactionThreshold?: number;
    runnerFault?: RunnerFault;
    archiveFault?: (point: ArchiveFaultPoint) => void;
    ledgerFault?: (point: LedgerFaultPoint) => void;
}

export interface RunSummary {
    outcome: "finished" | "disabled";
    runId: string | null;
    snapshotId: string | null;
    sequence: number | null;
    snapshotStatus: JudgedSnapshotStatus | null;
    historicalCoverage: JudgedHistoricalCoverage | null;
    reasonCodes: WorkerReasonCode[];
    counts: RunCounts | null;
}

export interface VerifySummary {
    outcome: "finished" | "disabled";
    runId: string | null;
    checked: number;
    integrityErrors: number;
    archiveAvailable: boolean;
}

export interface RecoverSummary {
    outcome: "finished" | "disabled";
    recovered: number;
    unverified: number;
    sequenceFloor: number;
    knownGaps: number;
}

export interface InitSummary {
    outcome: "finished";
    installationId: string;
}

export interface InspectSummary {
    status: "ok" | "not_initialized" | "recovery_required";
    reasons: string[];
    lastSeq: number;
    counts: Record<string, number>;
}

export interface WorkerRunnerPort {
    init(): Promise<InitSummary>;
    run(options?: { scheduledFor?: string | null }): Promise<RunSummary>;
    verify(options: { all: boolean }): Promise<VerifySummary>;
    recover(options: { installationId: string }): Promise<RecoverSummary>;
    inspect(): InspectSummary;
}

export const ZERO_COUNTS: Readonly<RunCounts> = Object.freeze({
    candidates: 0, included: 0, verified: 0, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0,
});
