import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { openWorker, type OpenedWorker, type WorkerCommand, type WorkerEnvironment } from "infrastructure/eformsign-backup/worker/cli";
import type { WorkerConfig } from "infrastructure/eformsign-backup/worker/config";
import { decodeDevice } from "infrastructure/eformsign-backup/worker/lock";
import type { FsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";
import type { RunSummary } from "infrastructure/eformsign-backup/worker/runner";

import { FakeExportApi, type FixtureArtifact, type FixtureDoc } from "./fake-export-api";
import { probeFor } from "./destination-support";
import { buildMinimalPdf } from "./pdf-fixture-minimal";

export const COMPANY = "C001";
export const ARCHIVE_ID = "11111111-1111-4111-8111-111111111111";
export const TOKEN = `ebx_${"A".repeat(43)}`;

export function pdfOf(seed: string): Buffer { return buildMinimalPdf(seed); }
export function sha256Of(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** A document with both artifacts (the normal included shape). */
export function pairDoc(documentId: string, seed = documentId, extra: Partial<FixtureDoc> = {}): FixtureDoc {
    return {
        documentId,
        artifacts: [
            { fileType: "document", bytes: pdfOf(`${seed} document`) },
            { fileType: "audit_trail", bytes: pdfOf(`${seed} audit`) },
        ],
        ...extra,
    };
}
export function singleDoc(documentId: string, seed = documentId): FixtureDoc {
    return { documentId, artifacts: [{ fileType: "document", bytes: pdfOf(`${seed} document`) }] satisfies FixtureArtifact[] };
}

export function runIdOf(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
/** Deterministic UUID v4 source: 1, 2, 3, ... */
export function sequentialUuid(start = 1): () => string {
    let next = start;
    return () => runIdOf(next++);
}

export class TestClock {
    private ms: number;
    constructor(start = "2026-10-19T00:00:00.000Z") { this.ms = Date.parse(start); }
    now(): Date { return new Date(this.ms); }
    advance(ms: number): void { this.ms += ms; }
    set(iso: string): void { this.ms = Date.parse(iso); }
}

/** A probe that reports an ext4 volume with plenty of room and a `/proc/locks` that says this process holds `lockPath`. */
export function lockedProbe(lockPath: string, overrides: Parameters<typeof probeFor>[0] = {}, pid = process.pid): FsProbe {
    const base = probeFor(overrides);
    return {
        statfs: base.statfs,
        readProcLocks: async () => {
            const stat = await fs.lstat(lockPath);
            const { major, minor } = decodeDevice(stat.dev);
            return `1: FLOCK  ADVISORY  WRITE ${pid} ${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${stat.ino} 0 EOF\n`;
        },
    };
}

export interface HarnessOptions {
    docs?: FixtureDoc[];
    config?: Partial<Omit<WorkerConfig, "control" | "archive">> & {
        control?: Partial<WorkerConfig["control"]>;
        archive?: Partial<WorkerConfig["archive"]>;
    };
    pageSize?: number;
    startServer?: boolean;
}

export interface Harness {
    base: string;
    control: string;
    archive: string;
    lockPath: string;
    tokenPath: string;
    configPath: string;
    baseUrl: string;
    api: FakeExportApi;
    clock: TestClock;
    uuid: () => string;
    config: WorkerConfig;
}

/** Every test root lives under the home directory: the archive primitive rejects /tmp ancestors. */
export async function makeBase(prefix = "bjj455-runner-"): Promise<string> {
    return fs.mkdtemp(path.join(homedir(), prefix));
}

export function configJson(h: Pick<Harness, "control" | "archive" | "tokenPath" | "baseUrl">, overrides: HarnessOptions["config"] = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        enabled: true,
        companyId: COMPANY,
        exportBaseUrl: h.baseUrl,
        tokenFile: h.tokenPath,
        control: { path: h.control, reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000, ...overrides.control },
        archive: { path: h.archive, archiveId: ARCHIVE_ID, reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000, requireMountPoint: false, ...overrides.archive },
        requestTimeoutMs: 20_000,
        ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "control" && key !== "archive")),
    };
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
    const base = await makeBase();
    const control = path.join(base, "control");
    const archive = path.join(base, "archive");
    await fs.mkdir(control, { mode: 0o700 });
    await fs.mkdir(archive, { mode: 0o700 });
    const lockPath = path.join(control, "worker.lock");
    await fs.writeFile(lockPath, "", { mode: 0o600 });
    const tokenPath = path.join(base, "token");
    await fs.writeFile(tokenPath, `${TOKEN}\n`, { mode: 0o600 });
    const api = new FakeExportApi({ companyId: COMPANY, token: TOKEN, ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }) });
    api.docs = options.docs ?? [];
    const baseUrl = options.startServer === false ? "http://127.0.0.1:9/internal/eformsign-backup/v1" : await api.start();
    const configPath = path.join(base, "worker.json");
    const json = configJson({ control, archive, tokenPath, baseUrl }, options.config);
    await fs.writeFile(configPath, JSON.stringify(json), { mode: 0o600 });
    const { loadWorkerConfig } = await import("infrastructure/eformsign-backup/worker/config");
    const config = await loadWorkerConfig(configPath);
    return { base, control, archive, lockPath, tokenPath, configPath, baseUrl, api, clock: new TestClock(), uuid: sequentialUuid(), config };
}

export async function rewriteConfig(h: Harness, overrides: HarnessOptions["config"]): Promise<WorkerConfig> {
    const json = configJson(h, overrides);
    await fs.rm(h.configPath, { force: true });
    await fs.writeFile(h.configPath, JSON.stringify(json), { mode: 0o600 });
    const { loadWorkerConfig } = await import("infrastructure/eformsign-backup/worker/config");
    h.config = await loadWorkerConfig(h.configPath);
    return h.config;
}

export async function destroyHarness(h: Harness): Promise<void> {
    await h.api.stop();
    // A test may leave a directory read-only; restore the modes so the tree can go.
    for (const dir of [h.archive, h.control]) { try { await fs.chmod(dir, 0o700); } catch { /* moved or removed */ } }
    await fs.rm(h.base, { recursive: true, force: true });
}

export function environmentFor(h: Harness, overrides: WorkerEnvironment = {}): WorkerEnvironment {
    return {
        clock: h.clock, uuid: h.uuid, probe: lockedProbe(h.lockPath), sleep: async () => undefined,
        out: () => undefined, err: () => undefined, ...overrides,
    };
}

export async function withWorker<T>(
    h: Harness, command: WorkerCommand, use: (worker: OpenedWorker) => Promise<T>, overrides: WorkerEnvironment = {},
): Promise<T> {
    const worker = await openWorker(h.config, command, environmentFor(h, overrides));
    try {
        return await use(worker);
    } finally {
        await worker.close();
    }
}

export async function initArchive(h: Harness, overrides: WorkerEnvironment = {}): Promise<void> {
    await withWorker(h, "init", (worker) => worker.runner.init(), overrides);
}

export async function runOnce(h: Harness, overrides: WorkerEnvironment = {}, options: { scheduledFor?: string } = {}): Promise<RunSummary> {
    return withWorker(h, "run", (worker) => worker.runner.run(options), overrides);
}

export async function tryRun(h: Harness, overrides: WorkerEnvironment = {}): Promise<RunSummary | WorkerError> {
    try {
        return await runOnce(h, overrides);
    } catch (error) {
        if (error instanceof WorkerError) return error;
        throw error;
    }
}

// ---- reading what a run left behind --------------------------------------------------------------------------------

export async function readLedgerRecords(control: string): Promise<Array<{ seq: number; type: string; at: string; body: Record<string, unknown> }>> {
    const dir = path.join(control, "ledger");
    const records: Array<{ seq: number; type: string; at: string; body: Record<string, unknown> }> = [];
    for (const name of (await fs.readdir(dir)).filter((entry) => entry.startsWith("journal-")).sort()) {
        const text = await fs.readFile(path.join(dir, name), "utf8");
        for (const line of text.split("\n").filter(Boolean)) {
            try { records.push(JSON.parse(line)); } catch { /* a torn tail is not a record */ }
        }
    }
    return records;
}

export async function listFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        for (const entry of (await fs.readdir(dir)).sort()) {
            const full = path.join(dir, entry);
            const stat = await fs.lstat(full);
            if (stat.isDirectory()) await walk(full);
            else out.push(path.relative(root, full));
        }
    }
    await walk(root);
    return out;
}

/** The final PDFs of an archive: `eformsign/<company>/<doc>/artifacts/<type>/<sha>.pdf`, as relative paths. */
export async function archivePdfs(archive: string): Promise<string[]> {
    return (await listFiles(archive)).filter((file) => /\/artifacts\/[^/]+\/[0-9a-f]{64}\.pdf$/.test(file));
}

export async function treeSignature(root: string): Promise<string> {
    const lines: string[] = [];
    for (const file of await listFiles(root)) {
        lines.push(`${file}|${sha256Of(await fs.readFile(path.join(root, file)))}`);
    }
    return lines.join("\n");
}

export async function destinationStates(control: string): Promise<Record<string, string>> {
    const states: Record<string, string> = {};
    for (const record of await readLedgerRecords(control)) {
        if (record.type === "destination_transition") states[record.body["artifactIdentity"] as string] = record.body["to"] as string;
        if (record.type === "recovered_verified") states[record.body["artifactIdentity"] as string] = "verified";
    }
    return states;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures read untyped JSON and index it freely */
export async function readJsonFile<T = Record<string, any>>(file: string): Promise<T> {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

/** Completion files of the test company, oldest sequence first. */
export async function readCompletions(archive: string): Promise<Array<{ name: string; value: Record<string, any> }>> {
    const dir = path.join(archive, "eformsign", COMPANY, "completions");
    const names = (await fs.readdir(dir).catch(() => [] as string[])).sort();
    const out: Array<{ name: string; value: Record<string, any> }> = [];
    for (const name of names) out.push({ name, value: await readJsonFile(path.join(dir, name)) });
    return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True when any file under `root` contains `needle` (used for the token canary). */
export async function treeContains(root: string, needle: string): Promise<boolean> {
    for (const file of await listFiles(root)) {
        if ((await fs.readFile(path.join(root, file))).includes(needle)) return true;
    }
    return false;
}

/** The destination states one artifact went through, in ledger order (`to` of every transition). */
export async function transitionPath(control: string, artifactIdentity: string): Promise<string[]> {
    const states: string[] = [];
    for (const record of await readLedgerRecords(control)) {
        if (record.type === "destination_transition" && record.body["artifactIdentity"] === artifactIdentity) states.push(record.body["to"] as string);
    }
    return states;
}

export function recordTypes(records: Array<{ type: string }>): string[] {
    return records.map((record) => record.type);
}

export function identityFor(h: Harness, doc: FixtureDoc, fileType: "document" | "audit_trail"): string {
    const artifact = doc.artifacts?.find((candidate) => candidate.fileType === fileType);
    if (!artifact) throw new Error("fixture has no such artifact");
    return h.api.identityOf(doc.documentId, fileType, artifact.bytes);
}
