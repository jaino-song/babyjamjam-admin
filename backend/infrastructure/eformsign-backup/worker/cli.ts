import { randomUUID } from "node:crypto";
import path from "node:path";

import { WorkerError, identifier, isoWithOffset, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import { loadWorkerConfig, isNormalAbsolutePath, type WorkerConfig } from "./config";
import { ExportClient, readTokenFile } from "./export-client";
import { assertSupportedFilesystem, createRealFsProbe, type FsProbe } from "./fs-probe";
import { LedgerStore, type LedgerFaultPoint } from "./ledger-store";
import { assertLockHeld } from "./lock";
import { LocalDestination } from "./local-destination";
import { controlMarkerWriter } from "./runner-common";
import { WorkerRunner } from "./runner";
import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import {
    ZERO_COUNTS, type Clock, type InitSummary, type InspectSummary, type RecoverSummary, type RunSummary, type RunnerDependencies,
    type RunnerFault, type VerifySummary, type WorkerRunnerPort,
} from "./runner-types";

export type WorkerCommand = "init" | "run" | "verify" | "recover" | "inspect";
const COMMANDS: readonly WorkerCommand[] = ["init", "run", "verify", "recover", "inspect"];

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
    inspect(): InspectSummary { throw new WorkerError("internal"); }
}

const LOCK_NAME = "worker.lock";

/**
 * Opens what one command needs, in this order: the lock check (before anything is touched), the filesystem checks, the
 * token file (`run` only), the ledger. A failure at any step leaves the earlier ones unopened.
 */
export async function openWorker(config: WorkerConfig, command: WorkerCommand, environment: WorkerEnvironment = {}): Promise<OpenedWorker> {
    if (!config.enabled && (command === "run" || command === "verify" || command === "recover")) {
        return { runner: new DisabledRunner(), close: async () => undefined };
    }
    const probe = environment.probe ?? createRealFsProbe();
    const clock: Clock = environment.clock ?? { now: () => new Date() };
    const controlPath = config.control.path;

    if (command !== "inspect") await assertLockHeld(path.join(controlPath, LOCK_NAME), probe);
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

    const openLedger = (): Promise<LedgerStore> => LedgerStore.open(controlPath, {
        readOnly: command === "inspect",
        ...(environment.ledgerFault === undefined ? {} : { fault: environment.ledgerFault }),
        now: () => clock.now().toISOString(),
        writeMarker: controlMarkerWriter,
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
    for (let index = 1; index < args.length; index++) {
        const flag = args[index]!;
        if (seen.has(flag)) usage();
        seen.add(flag);
        if (flag === "--all") {
            if (command !== "verify") usage();
            all = true;
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
        } else {
            usage();
        }
    }
    if (configPath === null || (command === "recover" && installationId === null)) usage();
    return { command, configPath, scheduledFor, all, installationId };
}

// ---- exit codes ------------------------------------------------------------------------------------------------------

const CONFIGURATION: ReadonlySet<WorkerReasonCode> = new Set([
    "config-invalid", "token-file-invalid", "export-base-url-invalid", "lock-not-held", "unsupported-filesystem",
]);
const CONTROL: ReadonlySet<WorkerReasonCode> = new Set(["control-unavailable", "control-space"]);
const STATE: ReadonlySet<WorkerReasonCode> = new Set([
    "not-initialized", "recovery-required", "ledger-duplicate-install", "ledger-inconsistent", "archive-identity-mismatch",
    "archive-marker-invalid", "archive-unavailable", "archive-conflict", "archive-not-mount-point", "archive-unsafe-path", "archive-space",
]);

/** 78 configuration, 74 control side, 69 state or archive, 70 anything else. */
export function exitCodeFor(reasonCode: WorkerReasonCode): number {
    if (CONFIGURATION.has(reasonCode)) return 78;
    if (CONTROL.has(reasonCode)) return 74;
    if (STATE.has(reasonCode)) return 69;
    return 70;
}

// ---- main ------------------------------------------------------------------------------------------------------------

type LogLine = { event: string; runId?: string; reasonCode?: string; counts?: Record<string, number> };

async function execute(parsed: ParsedArgs, worker: OpenedWorker, emit: (line: LogLine) => void): Promise<void> {
    const { runner } = worker;
    switch (parsed.command) {
        case "init":
            await runner.init();
            emit({ event: "initialized" });
            return;
        case "run": {
            const summary = await runner.run({ scheduledFor: parsed.scheduledFor });
            if (summary.outcome === "disabled" || summary.runId === null || summary.snapshotStatus === null) {
                emit({ event: "disabled" });
                return;
            }
            emit({ event: `run_${summary.snapshotStatus}`, runId: summary.runId, counts: { ...(summary.counts ?? ZERO_COUNTS) } });
            for (const reasonCode of summary.reasonCodes) emit({ event: "run_reason", runId: summary.runId, reasonCode });
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
            const summary = await runner.recover({ installationId: parsed.installationId! });
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
        case "inspect": {
            const summary = runner.inspect();
            const reasonCode = summary.status === "not_initialized" ? "not-initialized" : summary.status === "recovery_required" ? "recovery-required" : undefined;
            emit({ event: "inspect", ...(reasonCode === undefined ? {} : { reasonCode }), counts: summary.counts });
            return;
        }
    }
}

/**
 * The command line contract: stdout carries one JSON object per line with keys from {event, runId, reasonCode, counts};
 * stderr carries a reason code and nothing else; the exit code follows `exitCodeFor`. Nothing is printed on failure
 * except that reason code, so a token or a path can never reach a log.
 */
export async function runWorkerCli(args: readonly string[], environment: WorkerEnvironment = {}): Promise<number> {
    const out = environment.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
    const err = environment.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
    try {
        const parsed = parseArgs(args);
        const config = await loadWorkerConfig(parsed.configPath);
        const worker = await openWorker(config, parsed.command, environment);
        const lines: LogLine[] = [];
        try {
            await execute(parsed, worker, (line) => lines.push(line));
        } finally {
            await worker.close();
        }
        for (const line of lines) out(JSON.stringify(line));
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
