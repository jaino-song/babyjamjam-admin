import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildCompletion, buildManifest, manifestKey } from "domain/eformsign-backup/worker";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { COMPLETION_KEY, MANIFEST_KEY, PDF_KEY, RUN_KEY, bindDrive, currentRootId, driveKeys, driveTree } from "./helpers/drive-run-support";
import {
    COMPANY, createHarness, destroyHarness, initArchive, listFiles, pairDoc, readCompletions, readJsonFile, readLedgerRecords, runOnce, withWorker, type Harness,
} from "./helpers/runner-support";
import { spawnUnderFlock } from "./helpers/runner-flock-support";

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

    // ---- QF1-F1: errors at the new boundaries, and records a normal installation never acknowledged ------------------------------------

    /** The Drive phase is listing a directory itself (or through `listCompletions`), not reading one file of the archive. */
    const isDrivePhaseListing = (stack: string): boolean => /DriveRunPhase/.test(stack) && !/walkExisting|readArchiveFile|readFileNoFollow|listManifestFiles/.test(stack);

    /** Makes the listing of the directory ending in `suffix` fail with a native EACCES, but only when the Drive phase asks for it. */
    function failDrivePhaseListing(suffix: string): jest.SpyInstance {
        const real = fs.readdir.bind(fs) as (...args: unknown[]) => Promise<unknown>;
        return jest.spyOn(fs, "readdir").mockImplementation(((target: unknown, ...rest: unknown[]) => {
            if (typeof target === "string" && target.endsWith(suffix) && isDrivePhaseListing(new Error().stack ?? "")) {
                return Promise.reject(Object.assign(new Error("synthetic EACCES"), { code: "EACCES" }));
            }
            return real(target, ...rest);
        }) as never);
    }
    const ledgerRunsFinished = async (): Promise<{ started: number; finished: number }> => {
        const records = await readLedgerRecords(h.control);
        return { started: records.filter((r) => r.type === "run_started").length, finished: records.filter((r) => r.type === "run_finished").length };
    };

    describe("F1: an unreadable optional input never aborts the command", () => {
        afterEach(async () => {
            jest.restoreAllMocks();
            await fs.chmod(path.join(h.control, "staging"), 0o700).catch(() => undefined);
        });

        it("recover: an unreadable staging directory skips staged-copy adoption and recovery finishes as it always did", async () => {
            await install();
            const installationId = (await readJsonFile<{ installationId: string }>(path.join(h.archive, MARKER))).installationId;
            await fs.rename(path.join(h.control, "ledger"), path.join(h.base, "ledger.lost"));
            await fs.chmod(path.join(h.control, "staging"), 0o000);

            const summary = await withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));

            expect(summary).toMatchObject({ outcome: "finished", recovered: 6, unverified: 0 });
            expect((await readLedgerRecords(h.control)).filter((record) => record.type === "staging_verified")).toEqual([]);
        }, 180_000);

        it("run: a failing completion listing in the Drive phase marks the archive unavailable, the run finishes, and the next run publishes", async () => {
            await install();
            await recoverLedger();
            await runOnce(h);
            await rebind();
            const before = await ledgerRunsFinished();
            const spy = failDrivePhaseListing("/completions");

            const failed = await runOnce(h);

            spy.mockRestore();
            expect(failed.reasonCodes).toContain("archive-unavailable");
            const after = await ledgerRunsFinished();
            expect(after.started - before.started).toBe(1);
            expect(after.finished - before.finished).toBe(1);
            await runOnce(h);
            await runOnce(h);
            await expectNewRootEqualsArchive();
        }, 180_000);

        it("run: a failing runs/ listing is not an absent folder: it marks the archive unavailable and the standalone inventory follows on the next run", async () => {
            await install();
            await recoverLedger();
            await runOnce(h);
            const [anyRun] = (await listFiles(h.archive)).filter((key) => /\/runs\//.test(key));
            const standaloneId = randomUUID();
            const inventory = await readJsonFile<Record<string, unknown>>(path.join(h.archive, anyRun!));
            const standaloneKey = `eformsign/${COMPANY}/runs/${standaloneId}.json`;
            await fs.writeFile(path.join(h.archive, standaloneKey), JSON.stringify({ ...inventory, runId: standaloneId }), { mode: 0o600 });
            await rebind();
            const spy = failDrivePhaseListing("/runs");

            const failed = await runOnce(h);

            spy.mockRestore();
            expect(failed.reasonCodes).toContain("archive-unavailable");
            expect((await driveTree(h, fakes)).has(standaloneKey)).toBe(false);
            await runOnce(h);
            expect((await driveTree(h, fakes)).has(standaloneKey)).toBe(true);
        }, 180_000);
    });

    describe("F3: records a normal installation wrote but never acknowledged", () => {
        it("a kill after the completion is written and before completion_published: rebind then publishes that completion", async () => {
            await install();
            h.api.docs.push(pairDoc("D004"));
            const child = spawnUnderFlock(h, ["run", "--config", h.configPath, "--kill-at", "after-completion-before-record"]);
            expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
            const origin = (await readLedgerRecords(h.control)).find((record) => record.type === "installed" || record.type === "recovery_started")!;
            expect(origin.type).toBe("installed");
            h.clock.set(new Date(Date.now() + 60_000).toISOString());
            await rebind();

            await runOnce(h);
            await runOnce(h);

            const tree = await driveTree(h, fakes);
            const archiveFiles = (await listFiles(h.archive)).sort();
            expect([...tree.keys()].sort()).toEqual(archiveFiles);
            expect(driveKeys(tree, COMPLETION_KEY)).toHaveLength((await readCompletions(h.archive)).length);
            expect(liveDuplicates()).toEqual([]);
        }, 180_000);

        it("an archive completion that names a manifest the ledger does not know brings that manifest to the new root too", async () => {
            await install();
            const [manifestFile] = (await listFiles(h.archive)).filter((key) => /\/manifests\//.test(key));
            const known = await readJsonFile<{ documentId: string; companyId: string; artifacts: Array<{ artifactType: string; artifactIdentity: string; sha256: string; byteLength: number }> }>(
                path.join(h.archive, manifestFile!),
            );
            const revision = "c".repeat(64);
            const crafted = buildManifest({ companyId: known.companyId, documentId: known.documentId, metadataRevision: revision, artifacts: known.artifacts } as never);
            const craftedKey = manifestKey({ companyId: known.companyId, documentId: known.documentId, metadataRevision: revision, manifestSha256: crafted.sha256 });
            await fs.writeFile(path.join(h.archive, craftedKey), crafted.bytes, { mode: 0o600 });
            const [latest] = (await readCompletions(h.archive)).slice(-1);
            const value = latest!.value;
            const completion = buildCompletion({
                companyId: known.companyId, sequence: 99, snapshotId: "crafted-snapshot", runId: randomUUID(), scopeRevision: value["scopeRevision"],
                policyRevision: value["policyRevision"], destinationIdentity: value["destinationIdentity"], destinationRevision: value["destinationRevision"],
                entries: [{ documentId: known.documentId, metadataRevision: revision, manifestKey: craftedKey, manifestSha256: crafted.sha256 }], gaps: [],
            });
            await fs.writeFile(path.join(h.archive, completion.relativeKey), completion.bytes, { mode: 0o600 });
            await rebind();

            await runOnce(h);
            await runOnce(h);

            const tree = await driveTree(h, fakes);
            expect(tree.has(craftedKey)).toBe(true);
            expect(tree.has(completion.relativeKey)).toBe(true);
        }, 180_000);
    });
});
