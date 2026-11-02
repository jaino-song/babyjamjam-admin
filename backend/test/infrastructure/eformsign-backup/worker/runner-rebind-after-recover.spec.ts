import { promises as fs } from "node:fs";
import path from "node:path";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { COMPLETION_KEY, MANIFEST_KEY, PDF_KEY, RUN_KEY, bindDrive, currentRootId, driveKeys, driveTree } from "./helpers/drive-run-support";
import {
    createHarness, destroyHarness, initArchive, listFiles, pairDoc, readCompletions, readJsonFile, readLedgerRecords, runOnce, withWorker, type Harness,
} from "./helpers/runner-support";

const MARKER = ".bjj-backup/installation.json";

/**
 * BJJ-456 QA finding F1: a rebind after `recover`. Everything the archive holds must reach the new root, from the archive's own bytes
 * (F1b), and the staged copies `recover` could prove must be adopted instead of set aside as damaged (F1a).
 */
describe("BJJ-456 QF1: drive-setup --rebind after recover", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    async function install(): Promise<void> {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002"), pairDoc("D003")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);
        await runOnce(h);
        await runOnce(h);
    }

    async function recoverLedger(): Promise<void> {
        const installationId = (await readJsonFile<{ installationId: string }>(path.join(h.archive, MARKER))).installationId;
        await fs.rename(path.join(h.control, "ledger"), path.join(h.base, "ledger.lost"));
        const summary = await withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
        expect(summary).toMatchObject({ outcome: "finished", unverified: 0 });
    }

    async function rebind(): Promise<void> {
        fakes.drive.trash(await currentRootId(h));
        await bindDrive(h, true);
    }

    const stagingNames = async (): Promise<string[]> => (await fs.readdir(path.join(h.control, "staging"))).sort();
    const liveDuplicates = (): string[] => {
        const seen = new Map<string, number>();
        for (const node of fakes.drive.nodes()) {
            if (node.trashed || node.id === fakes.drive.myDriveId) continue;
            const key = `${node.parents.join(",")}|${node.name}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
    };

    async function expectNewRootEqualsArchive(): Promise<void> {
        const tree = await driveTree(h, fakes);
        const archiveFiles = (await listFiles(h.archive)).sort();
        expect([...tree.keys()].sort()).toEqual(archiveFiles);
        for (const key of archiveFiles) expect(tree.get(key)?.equals(await fs.readFile(path.join(h.archive, key)))).toBe(true);
        expect(driveKeys(tree, COMPLETION_KEY)).toHaveLength((await readCompletions(h.archive)).length);
        expect(driveKeys(tree, PDF_KEY)).toHaveLength(6);
        expect(driveKeys(tree, MANIFEST_KEY).length).toBeGreaterThan(0);
        expect(driveKeys(tree, RUN_KEY).length).toBeGreaterThanOrEqual(2);
    }

    it("control (no recover): the new root holds everything the archive holds, with no set-aside and no orphan temp", async () => {
        await install();
        await rebind();

        const first = await runOnce(h);
        const second = await runOnce(h);

        await expectNewRootEqualsArchive();
        expect((await stagingNames()).filter((name) => name.includes(".corrupt-"))).toEqual([]);
        expect(first.counts?.orphanTemps).toBe(0);
        expect(second.counts?.orphanTemps).toBe(0);
        expect(liveDuplicates()).toEqual([]);
    }, 180_000);

    it("recover, then rebind: every manifest, completion and run inventory the archive holds is on the new root", async () => {
        await install();
        await recoverLedger();
        await runOnce(h);
        await rebind();

        await runOnce(h);
        await runOnce(h);

        await expectNewRootEqualsArchive();
        const completions = await readCompletions(h.archive);
        expect(completions.length).toBeGreaterThanOrEqual(5);
        const records = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_record_published");
        const lastBinding = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_bound").slice(-1)[0]!.body["destinationRevision"];
        const published = records.filter((record) => record.body["destinationRevision"] === lastBinding).map((record) => record.body["relativeKey"] as string);
        expect(new Set(published).size).toBe(published.length);
        expect(liveDuplicates()).toEqual([]);
    }, 180_000);

    it("recover, then rebind: staged copies recover could prove are adopted, never set aside, and nothing is downloaded again", async () => {
        await install();
        await recoverLedger();
        await runOnce(h);
        const stagedBefore = await stagingNames();
        expect(stagedBefore).toHaveLength(6);
        await rebind();
        const downloads = h.api.artifactRequests().length;

        const first = await runOnce(h);
        const second = await runOnce(h);

        expect(await stagingNames()).toEqual(stagedBefore);
        expect((await stagingNames()).filter((name) => name.includes(".corrupt-"))).toEqual([]);
        expect(first.counts?.orphanTemps).toBe(0);
        expect(second.counts?.orphanTemps).toBe(0);
        expect(h.api.artifactRequests()).toHaveLength(downloads);
        expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(6);
        expect(liveDuplicates()).toEqual([]);
    }, 180_000);
});
