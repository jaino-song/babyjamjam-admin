import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NFS_SUPER_MAGIC } from "infrastructure/eformsign-backup/worker/fs-probe";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";

import { spawnUnderFlock, type Spawned } from "./helpers/runner-flock-support";
import {
    createHarness, destroyHarness, initArchive, pairDoc, readLedgerRecords, runOnce, treeSignature, withWorker, type Harness,
} from "./helpers/runner-support";

async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
}

const journalSize = async (h: Harness): Promise<number> => (await fs.stat(path.join(h.control, "ledger", "journal-000000000001.jsonl"))).size;

describe("T-WRK-13: the real lock (flock -n -F -E 75, two real processes)", () => {
    let h: Harness;
    const spawned: Spawned[] = [];
    let release: () => void = () => undefined;
    afterEach(async () => {
        release();
        for (const item of spawned.splice(0)) { if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill("SIGKILL"); await item.exited; }
        await destroyHarness(h);
    });
    const start = (args: string[], options?: { flock?: boolean }): Spawned => { const item = spawnUnderFlock(h, args, options); spawned.push(item); return item; };

    it("should let one process work, send the second away with exit 75 and an untouched ledger, and let a third recover after SIGKILL", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        const gate = new Promise<void>((resolve) => { release = resolve; });
        h.api.addFault({ route: "artifact", times: 1, fault: { kind: "stall", until: gate } });
        const lockBefore = await fs.stat(h.lockPath);

        const first = start(["run", "--config", h.configPath]);
        await until(() => h.api.artifactRequests().length >= 1, "the first process to ask for an artifact");
        const sizeBefore = await journalSize(h);
        const recordsBefore = (await readLedgerRecords(h.control)).length;

        const second = start(["run", "--config", h.configPath]);
        expect(await second.exited).toEqual({ code: 75, signal: null });
        expect(second.stdout()).toBe("");
        expect(await journalSize(h)).toBe(sizeBefore);
        expect((await readLedgerRecords(h.control)).length).toBe(recordsBefore);

        first.child.kill("SIGKILL");
        expect(await first.exited).toEqual({ code: null, signal: "SIGKILL" });
        release();

        const third = start(["run", "--config", h.configPath]);
        expect(await third.exited).toEqual({ code: 0, signal: null });

        const records = await readLedgerRecords(h.control);
        const starts = records.filter((record) => record.type === "run_started");
        expect(starts).toHaveLength(2);
        const killedRun = starts[0]!.body["runId"];
        const crashFinish = records.findIndex((record) => record.type === "run_finished" && record.body["runId"] === killedRun);
        const crashTransition = records.findIndex((record) => record.type === "destination_transition" && record.body["reasonCode"] === "crashed");
        const secondStart = records.findIndex((record) => record.type === "run_started" && record.body["runId"] !== killedRun);
        expect(crashTransition).toBeGreaterThan(recordsBefore - 1);
        expect(crashTransition).toBeLessThan(crashFinish);
        expect(crashFinish).toBeLessThan(secondStart);
        expect(records[crashFinish]!.body).toMatchObject({ snapshotStatus: "failed", reasonCodes: ["crashed"] });
        expect(records[records.length - 1]).toMatchObject({ type: "run_finished", body: { snapshotStatus: "partial" } });

        const lockAfter = await fs.stat(h.lockPath);
        expect([lockAfter.ino, lockAfter.dev, lockAfter.size]).toEqual([lockBefore.ino, lockBefore.dev, lockBefore.size]);
    }, 240_000);

    it("should stop the writer holding a deleted lock file with lock-not-held before it writes, while the holder of the new lock finishes", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        const gate = new Promise<void>((resolve) => { release = resolve; });
        h.api.addFault({ route: "artifact", times: 1, fault: { kind: "stall", until: gate } });

        const first = start(["run", "--config", h.configPath]);
        await until(() => h.api.artifactRequests().length >= 1, "the first process to ask for an artifact");
        const oldInode = (await fs.stat(h.lockPath)).ino;

        // An operator deletes the lock while A is mid-run: flock -n creates a new inode, so B takes it without contention.
        await fs.rm(h.lockPath);
        const second = start(["run", "--config", h.configPath]);
        expect(await second.exited).toEqual({ code: 0, signal: null });
        expect((await fs.stat(h.lockPath)).ino).not.toBe(oldInode);

        const journal = path.join(h.control, "ledger", "journal-000000000001.jsonl");
        const bytesAfterSecond = await fs.readFile(journal);
        const recordsAfterSecond = await readLedgerRecords(h.control);

        release();
        expect(await first.exited).toEqual({ code: 78, signal: null });
        expect(first.stderr()).toContain("lock-not-held");
        expect(await fs.readFile(journal)).toEqual(bytesAfterSecond);
        expect(await readLedgerRecords(h.control)).toEqual(recordsAfterSecond);

        const replayed = await LedgerStore.open(h.control, { readOnly: true });
        expect(replayed.status).toBe("ok");
        expect(replayed.reasons).toEqual([]);
        const seqs = recordsAfterSecond.map((record) => record.seq);
        expect(seqs).toEqual(seqs.map((_seq, index) => index + 1));
        expect(replayed.lastSeq).toBe(seqs.length);
        expect(recordsAfterSecond[recordsAfterSecond.length - 1]).toMatchObject({ type: "run_finished", body: { snapshotStatus: "partial" } });
    }, 240_000);

    it("should refuse with 78 and lock-not-held when the process was not started under flock, writing nothing", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        const sizeBefore = await journalSize(h);
        const bare = start(["run", "--config", h.configPath], { flock: false });
        expect(await bare.exited).toEqual({ code: 78, signal: null });
        expect(bare.stderr().trim()).toBe("lock-not-held");
        expect(h.api.requests).toHaveLength(0);
        expect(await journalSize(h)).toBe(sizeBefore);
    }, 120_000);

    it("should refuse a filesystem that is not ext4 or xfs (an NFS statfs) with 78 and unsupported-filesystem, writing nothing", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        const sizeBefore = await journalSize(h);
        const nfs = start(["run", "--config", h.configPath, "--statfs-type", String(NFS_SUPER_MAGIC)]);
        expect(await nfs.exited).toEqual({ code: 78, signal: null });
        expect(nfs.stderr().trim()).toBe("unsupported-filesystem");
        expect(h.api.requests).toHaveLength(0);
        expect(await journalSize(h)).toBe(sizeBefore);
    }, 120_000);

    /**
     * A recover child that stops after the worker is open and before `recover` starts, until the spec releases it. It lives in the
     * test directory, so the spec needs no helper outside its own file. argv: config path, installation id, gate prefix.
     */
    const GATED_RECOVER = `
const fs = require("node:fs/promises");
const { openWorker, exitCodeFor } = require(process.cwd() + "/infrastructure/eformsign-backup/worker/cli.ts");
const { loadWorkerConfig } = require(process.cwd() + "/infrastructure/eformsign-backup/worker/config.ts");
(async () => {
    const [configFile, installationId, prefix] = process.argv.slice(2);
    const worker = await openWorker(await loadWorkerConfig(configFile), "recover", {});
    try {
        await fs.writeFile(prefix + ".ready", "open");
        for (;;) {
            if (await fs.stat(prefix + ".release").then(() => true, () => false)) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        console.log(JSON.stringify({ result: await worker.runner.recover({ installationId }) }));
    } finally {
        await worker.close();
    }
})().catch((error) => { console.error(error.reasonCode || error.message); process.exitCode = error.reasonCode ? exitCodeFor(error.reasonCode) : 70; });
`;
    const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true, () => false);
    function startGatedRecover(id: string, gate: string): Spawned {
        const script = path.join(h.base, "gated-recover.cjs");
        const command = ["flock", "-n", "-F", "-E", "75", h.lockPath, process.execPath, "-r", "ts-node/register/transpile-only", script, h.configPath, id, gate];
        const child = spawn(command[0]!, command.slice(1), {
            cwd: path.resolve(__dirname, "../../../.."), env: { ...process.env, NODE_PATH: "." }, stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout!.on("data", (chunk: Buffer) => { out += chunk.toString(); });
        child.stderr!.on("data", (chunk: Buffer) => { err += chunk.toString(); });
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { child.once("exit", (code, signal) => resolve({ code, signal })); });
        const item = { child, exited, stdout: () => out, stderr: () => err };
        spawned.push(item);
        return item;
    }

    it("FU-11 F1: should stop a recover holding a deleted lock file with 78 lock-not-held before it restores the control marker, while the holder of the new lock finishes", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        const id = (JSON.parse(await fs.readFile(path.join(h.archive, ".bjj-backup", "installation.json"), "utf8")) as { installationId: string }).installationId;
        await runOnce(h);
        const journal = path.join(h.control, "ledger", "journal-000000000001.jsonl");
        const damaged = await fs.readFile(journal);
        const offset = damaged.indexOf(0x0a) + 30;
        damaged[offset] = damaged[offset]! ^ 0xff;
        await fs.writeFile(journal, damaged);
        // A recover killed after its first recovered_verified leaves an ok ledger that a second recover resumes.
        await expect(withWorker(h, "recover", (worker) => worker.runner.recover({ installationId: id }), {
            runnerFault: (point) => { if (point === "recover-after-first-recovered") throw new Error("interrupted"); },
        })).rejects.toThrow("interrupted");
        const controlMarker = path.join(h.control, "installation.json");
        await fs.rm(controlMarker);
        await fs.writeFile(path.join(h.base, "gated-recover.cjs"), GATED_RECOVER);

        const gateA = path.join(h.base, "gate-a");
        const gateB = path.join(h.base, "gate-b");
        const stale = startGatedRecover(id, gateA);
        await until(() => exists(`${gateA}.ready`), "recover A to open the worker");
        const oldInode = (await fs.stat(h.lockPath)).ino;
        // An operator deletes the lock while A waits: flock -n creates a new inode, so B takes it without contention.
        await fs.rm(h.lockPath);
        const current = startGatedRecover(id, gateB);
        await until(() => exists(`${gateB}.ready`), "recover B to open the worker");
        expect((await fs.stat(h.lockPath)).ino).not.toBe(oldInode);
        const before = await treeSignature(h.control);

        await fs.writeFile(`${gateA}.release`, "go");
        expect(await stale.exited).toEqual({ code: 78, signal: null });
        expect(stale.stderr().trim()).toBe("lock-not-held");
        expect(await exists(controlMarker)).toBe(false);
        expect(await treeSignature(h.control)).toBe(before);

        await fs.writeFile(`${gateB}.release`, "go");
        expect(await current.exited).toEqual({ code: 0, signal: null });
        expect(await exists(controlMarker)).toBe(true);
        expect(current.stdout()).toContain("recovered");
    }, 240_000);
});
