import { randomUUID } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import { UUID_V4_PATTERN, WorkerError, driveFileId, identifier, isoWithOffset, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import { loadWorkerConfig, isNormalAbsolutePath, resolveDriveConfig, type WorkerConfig } from "./config";
import { DriveTokenSource } from "./drive-auth";
import { DriveClient } from "./drive-client";
import { DriveDestination } from "./drive-destination";
import { ExportClient, readTokenFile } from "./export-client";
import { assertSupportedFilesystem, createRealFsProbe, type FsProbe } from "./fs-probe";
import { LedgerStore, type LedgerFaultPoint } from "./ledger-store";
import { lockGuard, verifyLockHeld } from "./lock";
import { LocalDestination } from "./local-destination";
import { controlMarkerWriter } from "./runner-common";
import { WorkerRunner } from "./runner";
import { DriveRootCandidatesError } from "./runner-recover";
import { RunEndedWithFailure } from "./runner-run";
import { readSecretFile, readSecretJson } from "./secret-file";
import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import {
    ZERO_COUNTS, type Clock, type DriveDependency, type DriveSetupSummary, type InitSummary, type InspectSummary, type RecoverSummary, type RunSummary, type RunnerDependencies,
    type RunnerFault, type VerifySummary, type WorkerRunnerPort,
} from "./runner-types";

export type WorkerCommand = "init" | "run" | "verify" | "recover" | "inspect" | "drive-setup";
const COMMANDS: readonly WorkerCommand[] = ["init", "run", "verify", "recover", "inspect", "drive-setup"];

/** Everything a test may replace. Production passes nothing and gets the real clock, uuid source, `/proc/locks`, fetch and stdio. */
export interface WorkerEnvironment {
    clock?: Clock;
    uuid?: () => string;
    probe?: FsProbe;
    sleep?: (ms: number) => Promise<void>;
    out?: (line: string) => void;
    err?: (line: string) => void;
    fetchImpl?: typeof fetch;
    compactionThreshold?: number;
    runnerFault?: RunnerFault;
    ledgerFault?: (point: LedgerFaultPoint) => void;
    archiveFault?: (point: ArchiveFaultPoint) => void;
}

export interface OpenedWorker {
    runner: WorkerRunnerPort;
    close(): Promise<void>;
}

/** `enabled: false` turns run, verify and recover into no-ops that never open the lock, the ledger or the network. */
class DisabledRunner implements WorkerRunnerPort {
    init(): Promise<InitSummary> { throw new WorkerError("internal"); }
    async run(): Promise<RunSummary> {
        return { outcome: "disabled", runId: null, snapshotId: null, sequence: null, snapshotStatus: null, historicalCoverage: null, reasonCodes: [], counts: null };
    }
    async verify(): Promise<VerifySummary> {
        return { outcome: "disabled", runId: null, checked: 0, integrityErrors: 0, archiveAvailable: true };
    }
    async recover(): Promise<RecoverSummary> {
        return { outcome: "disabled", recovered: 0, unverified: 0, sequenceFloor: 0, knownGaps: 0 };
    }
    driveSetup(): Promise<DriveSetupSummary> { throw new WorkerError("internal"); }
    inspect(): InspectSummary { throw new WorkerError("internal"); }
}

const LOCK_NAME = "worker.lock";

/** The commands that may talk to Drive, and so read the Drive secret files. `init` and `inspect` never do. */
const DRIVE_COMMANDS: ReadonlySet<WorkerCommand> = new Set(["run", "drive-setup", "recover", "verify"]);
const DRIVE_CLIENT_FILE_MAX_BYTES = 4096;
const DRIVE_REFRESH_TOKEN_MAX_BYTES = 1024;
const DRIVE_REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_\-/.]{20,512}$/;
const driveClientFileSchema = z.strictObject({ client_id: z.string().min(1).max(512), client_secret: z.string().min(1).max(512) });

/**
 * The Drive client for a config with a `drive` block. Unreadable or badly permissioned secret files are `token-file-invalid`
 * (a token the server rejects is `drive-token-invalid`, and only later). No request is made here.
 */
async function openDrive(config: WorkerConfig, clock: Clock, fetchImpl: typeof fetch | undefined): Promise<DriveDependency | null> {
    const settings = resolveDriveConfig(config);
    if (settings === null || config.drive === undefined) return null;
    const credentials = await readSecretJson(config.drive.clientFile, driveClientFileSchema, DRIVE_CLIENT_FILE_MAX_BYTES, "token-file-invalid");
    const refreshToken = await readSecretFile(config.drive.refreshTokenFile, {
        pattern: DRIVE_REFRESH_TOKEN_PATTERN, maxBytes: DRIVE_REFRESH_TOKEN_MAX_BYTES, reasonCode: "token-file-invalid",
    });
    const tokens = new DriveTokenSource({
        tokenUrl: settings.tokenUrl, clientId: credentials.client_id, clientSecret: credentials.client_secret, refreshToken,
        now: () => clock.now(), requestTimeoutMs: settings.requestTimeoutMs, ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    const client = new DriveClient({
        apiBaseUrl: settings.apiBaseUrl, uploadBaseUrl: settings.uploadBaseUrl, tokens,
        requestTimeoutMs: settings.requestTimeoutMs, chunkBytes: settings.chunkBytes, ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    return { kind: "ready", client, settings };
}

/**
 * `drive-setup` is a Drive-only command: an unusable secret file ends it (78). `run` and `recover` have a local side that must not
 * depend on Drive (design 7.1), so for them the failure becomes a dependency of kind `unavailable` (A8).
 */
async function openDriveFor(command: WorkerCommand, config: WorkerConfig, clock: Clock, fetchImpl: typeof fetch | undefined): Promise<DriveDependency | null> {
    try {
        return await openDrive(config, clock, fetchImpl);
    } catch (error) {
        if (command === "drive-setup" || !(error instanceof WorkerError) || error.reasonCode !== "token-file-invalid") throw error;
        return { kind: "unavailable", reason: "token-file-invalid" };
    }
}

/**
 * Opens what one command needs, in this order: the lock check (before anything is touched), the filesystem checks, the
 * token file (`run` only), the Drive secret files (`run`, `drive-setup`, `recover`, `verify`, when the config has a `drive` block; a bad one ends only
 * `drive-setup`), the ledger. A failure at any step leaves the earlier ones unopened.
 */
export async function openWorker(config: WorkerConfig, command: WorkerCommand, environment: WorkerEnvironment = {}): Promise<OpenedWorker> {
    if (!config.enabled && (command === "run" || command === "verify" || command === "recover")) {
        return { runner: new DisabledRunner(), close: async () => undefined };
    }
    const probe = environment.probe ?? createRealFsProbe();
    const clock: Clock = environment.clock ?? { now: () => new Date() };
    const controlPath = config.control.path;

    const lockPath = path.join(controlPath, LOCK_NAME);
    const held = command === "inspect" ? null : await verifyLockHeld(lockPath, probe);
    await assertSupportedFilesystem(probe, controlPath, "control-unavailable");
    if (command !== "inspect") {
        try {
            await assertSupportedFilesystem(probe, config.archive.path, "archive-unavailable");
        } catch (error) {
            // A missing archive is an outcome the runner records; an archive on the wrong kind of filesystem is a refusal.
            if (!(error instanceof WorkerError) || error.reasonCode !== "archive-unavailable") throw error;
        }
    }
    const exportClient = command === "run"
        ? new ExportClient({
            baseUrl: config.exportBaseUrl, token: await readTokenFile(config.tokenFile), companyId: config.companyId,
            requestTimeoutMs: config.requestTimeoutMs, ...(environment.fetchImpl === undefined ? {} : { fetchImpl: environment.fetchImpl }),
        })
        : null;
    const drive = DRIVE_COMMANDS.has(command) ? await openDriveFor(command, config, clock, environment.fetchImpl) : null;

    const openLedger = (): Promise<LedgerStore> => LedgerStore.open(controlPath, {
        readOnly: command === "inspect",
        // recover repairs a torn tail itself, after its read-only refusal checks; every other command repairs on open.
        ...(command === "recover" ? { deferTornTailRepair: true } : {}),
        ...(environment.ledgerFault === undefined ? {} : { fault: environment.ledgerFault }),
        now: () => clock.now().toISOString(),
        writeMarker: controlMarkerWriter,
        // Every ledger write re-proves the lock: the path must still be the inode verified above, still locked by this pid.
        ...(held === null ? {} : { beforeWrite: lockGuard(lockPath, probe, held) }),
    });
    const deps: RunnerDependencies = {
        config,
        clock,
        uuid: environment.uuid ?? randomUUID,
        probe,
        sleep: environment.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        ledger: await openLedger(),
        reopenLedger: openLedger,
        createDestination: ({ dev, ino }) => new LocalDestination({
            archivePath: config.archive.path, archiveId: config.archive.archiveId, expectedDev: dev, expectedIno: ino,
            reserveBytes: config.archive.reserveBytes, reserveInodes: config.archive.reserveInodes, requireMountPoint: config.archive.requireMountPoint,
        }, probe, environment.archiveFault),
        exportClient,
        drive,
        createDriveDestination: (binding) => {
            if (drive === null) throw new WorkerError("drive-not-configured");
            if (drive.kind === "unavailable") throw new WorkerError(drive.reason);
            return new DriveDestination(drive.client, binding);
        },
        ...(environment.compactionThreshold === undefined ? {} : { compactionThreshold: environment.compactionThreshold }),
        ...(environment.runnerFault === undefined ? {} : { runnerFault: environment.runnerFault }),
    };
    return { runner: new WorkerRunner(deps), close: () => deps.ledger.close() };
}

// ---- argv ----------------------------------------------------------------------------------------------------------

interface ParsedArgs {
    command: WorkerCommand;
    configPath: string;
    scheduledFor: string | null;
    all: boolean;
    installationId: string | null;
    rebind: boolean;
    driveRootFolderId: string | null;
}

function usage(): never {
    throw new WorkerError("config-invalid");
}

/** Strict: unknown, repeated, valueless or misplaced flags are all `config-invalid`, before anything is opened. */
function parseArgs(args: readonly string[]): ParsedArgs {
    const command = args[0] as WorkerCommand | undefined;
    if (command === undefined || !COMMANDS.includes(command)) usage();
    const seen = new Set<string>();
    let configPath: string | null = null;
    let scheduledFor: string | null = null;
    let all = false;
    let installationId: string | null = null;
    let rebind = false;
    let driveRootFolderId: string | null = null;
    for (let index = 1; index < args.length; index++) {
        const flag = args[index]!;
        if (seen.has(flag)) usage();
        seen.add(flag);
        if (flag === "--all") {
            if (command !== "verify") usage();
            all = true;
            continue;
        }
        if (flag === "--rebind") {
            if (command !== "drive-setup") usage();
            rebind = true;
            continue;
        }
        const value = args[++index];
        if (value === undefined || value.startsWith("--")) usage();
        if (flag === "--config") {
            if (!isNormalAbsolutePath(value)) usage();
            configPath = value;
        } else if (flag === "--scheduled-for") {
            if (command !== "run" || !isoWithOffset.safeParse(value).success) usage();
            scheduledFor = value;
        } else if (flag === "--installation-id") {
            if (command !== "recover" || !identifier.safeParse(value).success) usage();
            installationId = value;
        } else if (flag === "--drive-root-folder-id") {
            if (command !== "recover" || !driveFileId.safeParse(value).success) usage();
            driveRootFolderId = value;
        } else {
            usage();
        }
    }
    if (configPath === null || (command === "recover" && installationId === null)) usage();
    return { command, configPath, scheduledFor, all, installationId, rebind, driveRootFolderId };
}

// ---- exit codes ------------------------------------------------------------------------------------------------------

const CONFIGURATION: ReadonlySet<WorkerReasonCode> = new Set([
    "config-invalid", "token-file-invalid", "export-base-url-invalid", "lock-not-held", "unsupported-filesystem",
    "drive-not-configured", "drive-token-invalid",
]);
const CONTROL: ReadonlySet<WorkerReasonCode> = new Set(["control-unavailable", "control-space"]);
const STATE: ReadonlySet<WorkerReasonCode> = new Set([
    "not-initialized", "recovery-required", "ledger-duplicate-install", "ledger-inconsistent", "archive-identity-mismatch",
    "archive-marker-invalid", "archive-unavailable", "archive-conflict", "archive-not-mount-point", "archive-unsafe-path", "archive-space",
    // A Drive-only command (drive-setup, restore-drive) ends on these; inside `run` a Drive failure never ends the run.
    "drive-root-changed", "drive-permission", "drive-quota", "drive-conflict", "drive-unavailable",
]);

/** 78 configuration, 74 control side, 69 state or archive, 70 anything else. */
export function exitCodeFor(reasonCode: WorkerReasonCode): number {
    if (CONFIGURATION.has(reasonCode)) return 78;
    if (CONTROL.has(reasonCode)) return 74;
    if (STATE.has(reasonCode)) return 69;
    return 70;
}

// ---- main ------------------------------------------------------------------------------------------------------------

type LogLine = {
    event: string; runId?: string; reasonCode?: string; counts?: Record<string, number>;
    /** `drive_bound` only: the Drive root and the layout revision it was bound under (identifiers, never a secret). */
    rootFolderId?: string; destinationRevision?: string;
    /** `recover_drive_root_ambiguous` only: the roots the operator can pick from, ids only. */
    candidates?: Array<{ rootFolderId: string; bindingId: string | null }>;
};

async function execute(parsed: ParsedArgs, worker: OpenedWorker, emit: (line: LogLine) => void): Promise<void> {
    const { runner } = worker;
    switch (parsed.command) {
        case "init":
            await runner.init();
            emit({ event: "initialized" });
            return;
        case "run": {
            const emitRun = (summary: RunSummary): void => {
                if (summary.outcome === "disabled" || summary.runId === null || summary.snapshotStatus === null) {
                    emit({ event: "disabled" });
                    return;
                }
                emit({ event: `run_${summary.snapshotStatus}`, runId: summary.runId, counts: { ...(summary.counts ?? ZERO_COUNTS) } });
                for (const reasonCode of summary.reasonCodes) emit({ event: "run_reason", runId: summary.runId, reasonCode });
            };
            try {
                emitRun(await runner.run({ scheduledFor: parsed.scheduledFor }));
            } catch (error) {
                // A run that ended with a deferred failure has recorded itself: its own lines are still the operator's summary.
                if (error instanceof RunEndedWithFailure) emitRun(error.summary);
                throw error;
            }
            return;
        }
        case "verify": {
            const summary = await runner.verify({ all: parsed.all });
            if (summary.outcome === "disabled" || summary.runId === null) {
                emit({ event: "disabled" });
                return;
            }
            emit({ event: "verify_finished", runId: summary.runId, counts: { checked: summary.checked, integrityErrors: summary.integrityErrors } });
            if (!summary.archiveAvailable) emit({ event: "verify_archive_unavailable", runId: summary.runId, reasonCode: "archive-unavailable" });
            return;
        }
        case "recover": {
            let summary: RecoverSummary;
            try {
                summary = await runner.recover({
                    installationId: parsed.installationId!,
                    ...(parsed.driveRootFolderId === null ? {} : { driveRootFolderId: parsed.driveRootFolderId }),
                });
            } catch (error) {
                // Several roots hold this archive's marker: the operator needs their ids to name one (A2.4). Ids only, validated.
                if (error instanceof DriveRootCandidatesError) {
                    emit({
                        event: "recover_drive_root_ambiguous", reasonCode: error.reasonCode,
                        candidates: error.candidates.filter((candidate) => driveFileId.safeParse(candidate.rootFolderId).success).map((candidate) => ({
                            rootFolderId: candidate.rootFolderId,
                            bindingId: candidate.bindingId !== null && UUID_V4_PATTERN.test(candidate.bindingId) ? candidate.bindingId : null,
                        })),
                    });
                }
                throw error;
            }
            if (summary.outcome === "disabled") {
                emit({ event: "disabled" });
                return;
            }
            emit({
                event: "recovered",
                counts: { recovered: summary.recovered, unverified: summary.unverified, sequenceFloor: summary.sequenceFloor, knownGaps: summary.knownGaps },
            });
            return;
        }
        case "drive-setup": {
            const summary = await runner.driveSetup({ rebind: parsed.rebind });
            emit({ event: "drive_bound", rootFolderId: summary.rootFolderId, destinationRevision: summary.destinationRevision });
            return;
        }
        case "inspect": {
            const summary = runner.inspect();
            const reasonCode = summary.status === "not_initialized" ? "not-initialized" : summary.status === "recovery_required" ? "recovery-required" : undefined;
            emit({ event: "inspect", ...(reasonCode === undefined ? {} : { reasonCode }), counts: summary.counts });
            return;
        }
    }
}

/**
 * The command line contract: stdout carries one JSON object per line with keys from {event, runId, reasonCode, counts,
 * rootFolderId, destinationRevision} (the last two on `drive_bound` only; `candidates` joins them on `recover_drive_root_ambiguous` only);
 * stderr carries a reason code and nothing else; the exit code follows `exitCodeFor`. On failure stderr is that reason
 * code only; stdout still carries the lines a command had ready (a run that ended in a deferred failure prints its own
 * `run_*` lines), all built from the fixed keys above, so a token or a path can never reach a log.
 */
export async function runWorkerCli(args: readonly string[], environment: WorkerEnvironment = {}): Promise<number> {
    const out = environment.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
    const err = environment.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
    try {
        const parsed = parseArgs(args);
        const config = await loadWorkerConfig(parsed.configPath);
        const worker = await openWorker(config, parsed.command, environment);
        const lines: LogLine[] = [];
        let failure: unknown = null;
        try {
            await execute(parsed, worker, (line) => lines.push(line));
        } catch (error) {
            failure = error;
        } finally {
            await worker.close();
        }
        // Whatever a command had to say before it failed goes out first; stderr still carries the reason code only.
        for (const line of lines) out(JSON.stringify(line));
        if (failure !== null) throw failure;
        return 0;
    } catch (error) {
        if (error instanceof WorkerError) {
            err(error.reasonCode);
            return exitCodeFor(error.reasonCode);
        }
        err("internal");
        return 70;
    }
}
