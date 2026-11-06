import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { openWorker, type OpenedWorker, type WorkerEnvironment } from "infrastructure/eformsign-backup/worker/cli";
import type { WorkerConfig } from "infrastructure/eformsign-backup/worker/config";
import { decodeDevice } from "infrastructure/eformsign-backup/worker/lock";
import { FS_TYPE_EXT4 } from "infrastructure/eformsign-backup/worker/fs-probe";
import type { ManualDeliveryBinding } from "infrastructure/eformsign-backup/worker/manual-delivery-store";
import type { ManualBindingPort } from "infrastructure/eformsign-backup/worker/manual-pending";
import { COMPANY, demand } from "./eformsign-backup-fixture-data";

/** Native QA seam only. This does not prove Linux locking or killed-worker recovery. */
export function nativeEnvironment(lockPath: string): WorkerEnvironment {
    const bindings: ManualDeliveryBinding[] = [];
    const port: ManualBindingPort = {
        async list() { return structuredClone(bindings); },
        async put(binding) { bindings.push(structuredClone(binding)); },
        async remove(binding) {
            const index = bindings.findIndex(b => b.executionScope.jobId === binding.executionScope.jobId && b.executionScope.attemptId === binding.executionScope.attemptId);
            if (index >= 0) bindings.splice(index, 1);
        },
    };
    return {
        out: () => undefined, err: () => undefined,
        probe: {
            async statfs() { return { type: FS_TYPE_EXT4, bavail: 1_000_000, bsize: 4096, ffree: 1_000_000 }; },
            async readProcLocks() {
                const stat = await fs.lstat(lockPath);
                const device = decodeDevice(stat.dev);
                return `1: FLOCK ADVISORY WRITE ${process.pid} ${device.major.toString(16)}:${device.minor.toString(16)}:${stat.ino} 0 EOF\n`;
            },
        },
        manualBindingStoreFactory: options => ({
            list: () => port.list(),
            async put(binding) { await options.beforeWrite(); await port.put(binding); },
            async remove(binding) { await options.beforeWrite(); await port.remove(binding); },
        }),
    };
}

export class FixtureConsumer {
    private worker: OpenedWorker | null = null;
    private busy: Promise<void> = Promise.resolve();
    private stopped = false;
    private claimed = 0;
    private readonly started = performance.now();
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(private readonly config: WorkerConfig, private readonly environment: WorkerEnvironment, private readonly capture: () => Promise<void> = async () => undefined) {}

    async initialize(): Promise<void> {
        const init = await openWorker(this.config, "init", this.environment);
        try { await init.runner.init(); } finally { await init.close(); }
        this.worker = await openWorker(this.config, "process-pending", this.environment);
    }
    start(): void {
        demand(this.worker && !this.timer);
        this.timer = setInterval(() => { void this.consume().catch(() => { this.stopped = true; }); }, 1000);
    }
    consume(): Promise<void> {
        // One queue for polling and exercise: never opens a second processor.
        this.busy = this.busy.then(async () => {
            if (this.stopped || this.claimed >= 8 || performance.now() - this.started >= 30 * 60_000) return;
            demand(this.worker);
            await this.capture();
            const summary = await this.worker.processPending(1);
            this.claimed += summary.counts.claimed;
            demand(this.claimed <= 8, "CLAIM_LIMIT");
            await this.capture();
        });
        return this.busy;
    }
    async close(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        try { await this.busy; } finally { await this.worker?.close(); this.worker = null; }
    }
    get claims(): number { return this.claimed; }
}

export async function createConsumer(session: string, baseUrl: string, token: string, capture?: () => Promise<void>): Promise<FixtureConsumer> {
    const control = path.join(session, "control");
    const archive = path.join(session, "archive");
    await fs.mkdir(control, { mode: 0o700 });
    await fs.mkdir(archive, { mode: 0o700 });
    const lock = path.join(control, "worker.lock");
    const tokenFile = path.join(session, "machine-token");
    await fs.writeFile(lock, "", { mode: 0o600, flag: "wx" });
    await fs.writeFile(tokenFile, token, { mode: 0o600, flag: "wx" });
    const config: WorkerConfig = {
        schemaVersion: 1, enabled: true, companyId: COMPANY, exportBaseUrl: baseUrl, tokenFile,
        control: { path: control, reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000 },
        archive: { path: archive, archiveId: "12000000-0000-4000-8000-000000000001", reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000, requireMountPoint: false },
        requestTimeoutMs: 20_000,
    };
    const consumer = new FixtureConsumer(config, nativeEnvironment(lock), capture);
    await consumer.initialize();
    return consumer;
}
