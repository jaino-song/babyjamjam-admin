import { constants, fstatSync, lstatSync, promises as fs, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MANUAL_BACKUP_LEASE_DURATION_MS, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { manualControlUuidSchema } from "domain/eformsign-backup/manual-backup-control";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { manualExecutionScopeSchema } from "domain/eformsign-backup/worker/manual-protocol";
import { hex64, identifier, isoUtc, runIdField } from "domain/eformsign-backup/worker/schema-fields";
import { WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { publishBytesNoClobber, type AtomicPublishOptions } from "./atomic-file";
import { manualClaimSnapshotSchema } from "./manual-control-client";

const MAX_BYTES = 64 * 1024;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const NAMESPACE = "manual-delivery";
const utc = isoUtc.pipe(z.iso.datetime());
const bindingSchema = z.strictObject({
    version: z.literal(1), executionScope: manualExecutionScopeSchema, snapshot: manualClaimSnapshotSchema,
    leaseToken: manualControlUuidSchema, leaseDurationMs: z.literal(MANUAL_BACKUP_LEASE_DURATION_MS), leaseExpiresAtUTC: utc,
    installationId: identifier, credentialFingerprint: hex64, createdAtUTC: utc,
}).refine(b => b.snapshot.companyId === b.executionScope.companyId && b.snapshot.snapshotId === manualBackupSnapshotId(b.executionScope));
export type ManualDeliveryBinding = z.infer<typeof bindingSchema>;
export interface ManualDeliveryStoreOptions {
    controlPath: string; companyId: string; installationId: string; credentialFingerprint: string;
    beforeWrite: () => Promise<void>; fault?: AtomicPublishOptions["fault"];
}
interface Identity { dev: number; ino: number }
interface Directory { name: string; handle: FileHandle; identity: Identity }
interface RecordFile { binding: ManualDeliveryBinding; bytes: Buffer; identity: Identity; name: string }
interface Context { directories: Directory[] }
function unavailable(): never { throw new WorkerError("control-unavailable"); }
function code(error: unknown): unknown { return error !== null && typeof error === "object" && "code" in error ? error.code : null; }
function same(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function privateEntry(stat: Stats, mode: number): boolean {
    return typeof process.getuid === "function" && stat.uid === process.getuid() && (stat.mode & 0o7777) === mode;
}
function safeParse<T>(schema: z.ZodType<T>, value: unknown): T {
    try { const result = schema.safeParse(value); if (result.success) return result.data; } catch { /* Discard accessors and validator details. */ }
    return unavailable();
}
function normalized(value: unknown): ManualDeliveryBinding {
    try {
        // Validate the original data-property-only JSON profile before schemas can clone/transform it.
        const bytes = canonicalJson(value);
        if (Buffer.byteLength(bytes) > MAX_BYTES) unavailable();
        return safeParse(bindingSchema, JSON.parse(bytes));
    } catch { return unavailable(); }
}
async function lstatOrNull(name: string): Promise<Stats | null> {
    try { return await fs.lstat(name); } catch (error) { if (code(error) === "ENOENT") return null; throw error; }
}
function lstatOrNullSync(name: string): Stats | null {
    try { return lstatSync(name); } catch (error) { if (code(error) === "ENOENT") return null; throw error; }
}
function sorted(values: string[]): string[] { return values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); }

/**
 * Owner-only outbox evidence. The caller supplies the existing ledger/lock guard; this library takes no lock.
 * Publication is one guarded private-control operation. A mid-helper lock loss may leave valid evidence;
 * the post-guard refuses success and no artifact work is authorized by this class.
 */
export class ManualDeliveryStore {
    private readonly controlPath: string;
    private readonly companyId: string;
    private readonly installationId: string;
    private readonly credentialFingerprint: string;
    private readonly beforeWrite: () => Promise<void>;
    private readonly fault: AtomicPublishOptions["fault"];
    private readonly pinned = new Map<string, Identity>();
    private queue: Promise<void> = Promise.resolve();
    constructor(options: ManualDeliveryStoreOptions) {
        try {
            const controlPath = options.controlPath;
            if (typeof controlPath !== "string" || !path.isAbsolute(controlPath) || controlPath === "/"
                || controlPath.endsWith("/") || path.normalize(controlPath) !== controlPath || controlPath.includes("\0")
                || typeof options.beforeWrite !== "function" || (options.fault !== undefined && typeof options.fault !== "function")) unavailable();
            this.controlPath = controlPath;
            this.companyId = safeParse(identifier, options.companyId);
            this.installationId = safeParse(identifier, options.installationId);
            this.credentialFingerprint = safeParse(hex64, options.credentialFingerprint);
            this.beforeWrite = options.beforeWrite; this.fault = options.fault;
        } catch { unavailable(); }
    }
    async put(value: ManualDeliveryBinding): Promise<void> {
        // Deliberately before the first await/queue boundary: caller mutation cannot redirect a capability.
        const binding = this.binding(value);
        const bytes = Buffer.from(canonicalJson(binding), "utf8");
        return this.serialize(context => this.putRecord(context, binding, bytes));
    }
    list(): Promise<ManualDeliveryBinding[]> {
        return this.serialize(async context => (await this.scan(context)).map(r => r.binding));
    }
    async remove(value: ManualDeliveryBinding): Promise<void> {
        const binding = this.binding(value);
        const bytes = Buffer.from(canonicalJson(binding), "utf8");
        return this.serialize(async context => {
            const records = await this.scan(context);
            const name = this.fileName(binding);
            const record = records.find(r => r.name === name);
            // Missing is idempotent only after validating the whole owned namespace and binding identity.
            if (!record) return;
            if (!record.bytes.equals(bytes)) unavailable();
            const directory = await this.directory(context, path.dirname(name), false);
            if (!directory) unavailable();
            await this.guard(context);
            const fresh = await this.readFile(name);
            if (!same(record.identity, fresh.identity) || !fresh.bytes.equals(bytes)) unavailable();
            await this.guard(context);
            // Recheck the exact entry after the asynchronous lock proof, immediately before unlink.
            const entry = lstatSync(name);
            if (!entry.isFile() || !privateEntry(entry, 0o600) || !same(entry, record.identity)) unavailable();
            await fs.unlink(name);
            await this.guard(context);
            await this.sync(context, directory);
        });
    }
    private binding(value: unknown): ManualDeliveryBinding {
        const b = normalized(value);
        if (b.executionScope.companyId !== this.companyId || b.installationId !== this.installationId
            || b.credentialFingerprint !== this.credentialFingerprint) unavailable();
        return b;
    }
    private fileName(binding: ManualDeliveryBinding): string {
        return path.join(this.controlPath, NAMESPACE, binding.executionScope.jobId, `${binding.executionScope.attemptId}.json`);
    }
    private serialize<T>(work: (context: Context) => Promise<T>): Promise<T> {
        const run = this.queue.then(async () => {
            const context: Context = { directories: [] };
            try {
                await this.directory(context, this.controlPath, false);
                const result = await work(context);
                await this.revalidate(context);
                return result;
            } catch (error) {
                if (error instanceof WorkerError && error.reasonCode === "control-space") throw new WorkerError("control-space");
                if (code(error) === "ENOSPC") throw new WorkerError("control-space");
                return unavailable();
            } finally {
                for (const directory of context.directories.reverse()) {
                    try { await directory.handle.close(); } catch { /* Never expose filesystem details. */ }
                }
            }
        });
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    private async directory(context: Context, name: string, create: boolean): Promise<Directory | null> {
        const opened = context.directories.find(d => d.name === name);
        if (opened) { await this.checkDirectory(opened); return opened; }
        let entry = await lstatOrNull(name);
        if (!entry && create) {
            const parent = context.directories.find(d => d.name === path.dirname(name));
            if (!parent) unavailable();
            await this.guard(context);
            await fs.mkdir(name, { mode: 0o700 });
            await this.guard(context);
            // Once a directory is created, loss of the next proof preserves it as private evidence.
            await this.sync(context, parent);
            entry = await fs.lstat(name);
        }
        if (!entry) { if (name === this.controlPath) unavailable(); return null; }
        if (!entry.isDirectory() || entry.isSymbolicLink() || !privateEntry(entry, 0o700)) unavailable();
        const prior = this.pinned.get(name);
        if (prior && !same(prior, entry)) unavailable();
        const handle = await fs.open(name, DIRECTORY_FLAGS);
        try {
            const stat = await handle.stat();
            if (!stat.isDirectory() || !privateEntry(stat, 0o700) || !same(stat, entry)) unavailable();
            const directory = { name, handle, identity: { dev: stat.dev, ino: stat.ino } };
            await this.checkDirectory(directory);
            this.pinned.set(name, directory.identity);
            context.directories.push(directory);
            return directory;
        } catch (error) { await handle.close(); throw error; }
    }
    private async checkDirectory(directory: Directory): Promise<void> {
        const entry = await fs.lstat(directory.name);
        const stat = await directory.handle.stat();
        if (!entry.isDirectory() || entry.isSymbolicLink() || !stat.isDirectory()
            || !privateEntry(entry, 0o700) || !privateEntry(stat, 0o700)
            || !same(entry, directory.identity) || !same(stat, directory.identity)) unavailable();
    }
    private async revalidate(context: Context): Promise<void> {
        for (const directory of context.directories) await this.checkDirectory(directory);
    }
    private async guard(context: Context): Promise<void> {
        await this.beforeWrite();
        // No asynchronous filesystem work between the fresh lock proof and the owned mutation.
        // Still detect a root/descendant replacement made during the caller's awaited proof.
        for (const directory of context.directories) {
            const entry = lstatSync(directory.name);
            const stat = fstatSync(directory.handle.fd);
            if (!entry.isDirectory() || entry.isSymbolicLink() || !stat.isDirectory()
                || !privateEntry(entry, 0o700) || !privateEntry(stat, 0o700)
                || !same(entry, directory.identity) || !same(stat, directory.identity)) unavailable();
        }
    }
    private async sync(context: Context, directory: Directory): Promise<void> {
        await this.guard(context);
        await directory.handle.sync();
        await this.guard(context);
    }
    private async readFile(name: string): Promise<RecordFile> {
        const entry = await fs.lstat(name);
        if (!entry.isFile() || entry.isSymbolicLink() || !privateEntry(entry, 0o600)
            || entry.size <= 0 || entry.size > MAX_BYTES) unavailable();
        const handle = await fs.open(name, FILE_FLAGS);
        try {
            const initial = await handle.stat();
            if (!initial.isFile() || !privateEntry(initial, 0o600) || !same(entry, initial) || initial.size !== entry.size) unavailable();
            // One extra byte detects growth without allocating based on an untrusted later stat.
            const buffer = Buffer.alloc(entry.size + 1);
            let filled = 0;
            while (filled < buffer.length) {
                const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
                if (bytesRead === 0) break;
                filled += bytesRead;
            }
            const final = await handle.stat();
            const current = await fs.lstat(name);
            if (filled !== entry.size || final.size !== entry.size || !same(final, entry) || !same(current, entry)
                || !current.isFile() || !privateEntry(current, 0o600) || !privateEntry(final, 0o600)) unavailable();
            const bytes = buffer.subarray(0, filled);
            const binding = this.binding(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
            if (this.fileName(binding) !== name || canonicalJson(binding) !== bytes.toString("utf8")) unavailable();
            return { binding, bytes, name, identity: { dev: entry.dev, ino: entry.ino } };
        } finally { await handle.close(); }
    }
    private async scan(context: Context): Promise<RecordFile[]> {
        const namespace = await this.directory(context, path.join(this.controlPath, NAMESPACE), false);
        if (!namespace) return [];
        const records: RecordFile[] = [];
        for (const job of sorted(await fs.readdir(namespace.name))) {
            safeParse(runIdField, job);
            const directory = await this.directory(context, path.join(namespace.name, job), false);
            if (!directory) unavailable();
            for (const file of sorted(await fs.readdir(directory.name))) {
                if (!file.startsWith(`${job}.attempt-`) || !file.endsWith(".json")
                    || !/^[1-9][0-9]*$/.test(file.slice(job.length + 9, -5))) unavailable();
                records.push(await this.readFile(path.join(directory.name, file)));
            }
        }
        return records;
    }
    private async putRecord(context: Context, binding: ManualDeliveryBinding, bytes: Buffer): Promise<void> {
        const records = await this.scan(context);
        const name = this.fileName(binding);
        const existing = records.find(r => r.name === name);
        if (existing && !existing.bytes.equals(bytes)) unavailable();
        const namespace = await this.directory(context, path.join(this.controlPath, NAMESPACE), true);
        const directory = await this.directory(context, path.dirname(name), true);
        if (!directory || !namespace) unavailable();
        // Re-sync existing ancestors too: a prior failed mkdir/fsync may have left a private but
        // not-yet-durable directory. A later successful put must make the complete path durable.
        await this.sync(context, context.directories[0]!);
        await this.sync(context, namespace);
        // Prevalidate the final file's owner/mode/inode before the shared helper could reuse it.
        const entry = await lstatOrNull(name);
        if (entry) {
            const fresh = await this.readFile(name);
            if (!existing || !same(existing.identity, fresh.identity) || !fresh.bytes.equals(bytes)) unavailable();
        } else if (existing) unavailable();
        await this.guard(context);
        const guardedEntry = lstatOrNullSync(name);
        if (guardedEntry && (!existing || !guardedEntry.isFile() || !privateEntry(guardedEntry, 0o600)
            || !same(guardedEntry, existing.identity))) unavailable();
        if (!guardedEntry && existing) unavailable();
        await publishBytesNoClobber(directory.name, path.basename(name), bytes, { fault: this.fault, ioReasonCode: "control-unavailable" });
        // This is deliberately an awaited guard, never an asynchronous `fault` callback.
        await this.guard(context);
        const published = await this.readFile(name);
        if (!published.bytes.equals(bytes) || (existing && !same(published.identity, existing.identity))) unavailable();
    }
}
