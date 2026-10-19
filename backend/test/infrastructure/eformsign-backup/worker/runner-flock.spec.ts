import { promises as fs } from "node:fs";
import path from "node:path";

import { NFS_SUPER_MAGIC } from "infrastructure/eformsign-backup/worker/fs-probe";

import { spawnUnderFlock, type Spawned } from "./helpers/runner-flock-support";
import { createHarness, destroyHarness, initArchive, pairDoc, readLedgerRecords, type Harness } from "./helpers/runner-support";

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
});
