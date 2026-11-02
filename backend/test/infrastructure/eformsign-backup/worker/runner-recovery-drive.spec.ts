import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";
import { runRestoreDriveCli } from "infrastructure/eformsign-backup/worker/cli-restore-drive";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { PDF_KEY, JSON_KEY, bindDrive, currentRootId, driveKeys, driveTree, swapArchive } from "./helpers/drive-run-support";
import { driveFaults } from "./helpers/fake-drive-server";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
import {
    ARCHIVE_ID, createHarness, destroyHarness, environmentFor, initArchive, listFiles, pairDoc, readJsonFile, readLedgerRecords, runOnce, tryRun,
    withWorker, type Harness,
} from "./helpers/runner-support";

const DOCUMENTS = ["D001", "D002", "D003"];
const PDFS = DOCUMENTS.length * 2;
const MARKER = ".bjj-backup/installation.json";
const NEW_BINDING = "33333333-3333-4333-8333-333333333333";

describe("T30 / BJJ-456 U6: recover and verify with Drive as the second destination", () => {
    let h: Harness;
    let fakes: DriveHarness;
    let rootId: string;
    let installationId: string;
    let original: Record<string, unknown>;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    /** A healthy installation with Drive bound and two snapshots on both destinations. */
    async function populate(): Promise<void> {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);
        await runOnce(h);
        h.api.docs.push(pairDoc("D003"));
        await runOnce(h);
        rootId = await currentRootId(h);
        const bound = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_bound");
        original = bound[bound.length - 1]!.body;
        installationId = (await readJsonFile<{ installationId: string }>(path.join(h.archive, MARKER))).installationId;
    }

    /** The control ledger is gone (moved aside); the markers on both destinations are what is left to prove identity. */
    async function loseLedger(): Promise<void> {
        await fs.rename(path.join(h.control, "ledger"), path.join(h.base, "ledger.lost"));
    }

    const recover = (id: string = installationId, driveRootFolderId?: string, overrides: Parameters<typeof environmentFor>[1] = {}) =>
        withWorker(h, "recover", (worker) => worker.runner.recover({ installationId: id, ...(driveRootFolderId === undefined ? {} : { driveRootFolderId }) }), overrides);
    const verify = (all: boolean) => withWorker(h, "verify", (worker) => worker.runner.verify({ all }));
    const records = async (type?: string) => (await readLedgerRecords(h.control)).filter((record) => type === undefined || record.type === type);
    const isDrive = (record: { body: Record<string, unknown> }): boolean => String(record.body["destinationIdentity"]).startsWith("drive:");
    const driveTransitions = async () => (await records("destination_transition")).filter(isDrive);
    const driveRecovered = async () => (await records("recovered_verified")).filter(isDrive);

    /** Live Drive files and folders under the root, by archive path. */
    function driveIds(): { files: Map<string, string>; folders: Map<string, string> } {
        const files = new Map<string, string>();
        const folders = new Map<string, string>();
        const walk = (id: string, prefix: string): void => {
            for (const node of fakes.drive.children(id)) {
                if (node.trashed) continue;
                if (node.bytes !== null) files.set(`${prefix}${node.name}`, node.id);
                else {
                    folders.set(`${prefix}${node.name}`, node.id);
                    walk(node.id, `${prefix}${node.name}/`);
                }
            }
        };
        walk(rootId, "");
        return { files, folders };
    }
    const pdfKeyOf = (documentId: string, type: "document" | "audit-trail"): string =>
        [...driveIds().files.keys()].find((key) => key.includes(`/${documentId}/artifacts/${type}/`))!;
    /** (parent, name) pairs held by more than one live Drive object: a duplicated folder or file. */
    const liveDuplicates = (): string[] => {
        const seen = new Map<string, number>();
        for (const node of fakes.drive.nodes()) {
            if (node.trashed || node.id === fakes.drive.myDriveId) continue;
            const key = `${node.parents.join(",")}|${node.name}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
    };
    const counters = () => ({ creates: fakes.drive.creates, uploads: fakes.drive.uploadsCompleted, requests: fakes.drive.requests.length });

    /** A second, decoy root of the same installation that also carries the marker (what a leftover of a rebind looks like). */
    async function seedSecondRoot(withMarker = true): Promise<string> {
        const marker = await fs.readFile(path.join(h.archive, MARKER));
        const second = fakes.drive.seed({
            id: "SecondRootFolder0001", name: "bjj-eformsign-backup", parents: [fakes.drive.myDriveId],
            appProperties: { bjjInstallationId: installationId, bjjArchiveId: ARCHIVE_ID, bjjBindingId: NEW_BINDING },
        });
        if (withMarker) {
            const dir = fakes.drive.seed({ id: "SecondMarkerDir00001", name: ".bjj-backup", parents: [second.id] });
            fakes.drive.seed({ id: "SecondMarkerFile0001", name: "installation.json", mimeType: "application/json", parents: [dir.id], bytes: marker });
        }
        return second.id;
    }

    describe("a lost local ledger with Drive populated by a real run", () => {
        it("should leave run in recovery-required and make no Drive request that creates anything", async () => {
            await populate();
            await loseLedger();
            const before = counters();

            const result = await tryRun(h);

            expect(result).toBeInstanceOf(WorkerError);
            expect(result).toMatchObject({ reasonCode: "recovery-required" });
            expect(fakes.drive.creates).toBe(before.creates);
            expect(fakes.drive.uploadsCompleted).toBe(before.uploads);
            expect(fakes.drive.requests).toHaveLength(before.requests);
        }, 180_000);

        it("should rebuild the local and the Drive entries with zero creates and zero uploads, adopt the binding, and let the next run upload no artifact again", async () => {
            await populate();
            const pdfsBefore = driveKeys(await driveTree(h, fakes), PDF_KEY);
            const before = counters();
            await loseLedger();

            const summary = await recover();

            expect(summary).toMatchObject({ outcome: "finished", recovered: PDFS, unverified: 0 });
            expect(fakes.drive.creates).toBe(before.creates);
            expect(fakes.drive.uploadsCompleted).toBe(before.uploads);

            // The binding is the one the Drive root carries, ready, under the same revision.
            const bound = await records("drive_bound");
            expect(bound).toHaveLength(1);
            expect(bound[0]!.body).toEqual(original);
            const ready = await records("drive_ready");
            expect(ready.map((record) => record.body["destinationRevision"])).toEqual([original["destinationRevision"]]);

            // Every live Drive file and folder is a node of this revision; every artifact is a Drive recovered_verified with its file id.
            const { files, folders } = driveIds();
            const reserved = await records("drive_node_reserved");
            const created = await records("drive_node_created");
            expect(new Set(reserved.map((record) => record.body["nodeKey"]))).toEqual(new Set([...files.keys(), ...folders.keys()]));
            expect(reserved).toHaveLength(files.size + folders.size);
            expect(created).toHaveLength(reserved.length);
            for (const record of reserved) {
                const key = String(record.body["nodeKey"]);
                expect(record.body["fileId"]).toBe(record.body["kind"] === "folder" ? folders.get(key) : files.get(key));
            }
            const recovered = await driveRecovered();
            expect(recovered).toHaveLength(PDFS);
            for (const record of recovered) {
                expect(record.body["destinationIdentity"]).toBe(original["destinationIdentity"]);
                expect(record.body["destinationRevision"]).toBe(original["destinationRevision"]);
                expect(record.body["fileId"]).toBe(files.get(String(record.body["relativeKey"])));
            }
            const published = await records("drive_record_published");
            expect(published.map((record) => record.body["relativeKey"]).sort()).toEqual(driveKeys(await driveTree(h, fakes), JSON_KEY));
            const status = await withWorker(h, "inspect", async (worker) => worker.runner.inspect());
            expect(status.counts).toMatchObject({ driveBound: 1, driveVerified: PDFS, driveBlocked: 0, driveIntegrityError: 0, verified: PDFS });

            // The next run does not touch a single artifact again; only the new snapshot's records go up.
            const artifactRequests = h.api.artifactRequests().length;
            const jsonBefore = driveKeys(await driveTree(h, fakes), JSON_KEY).length;
            const uploadsBefore = fakes.drive.uploadsCompleted;
            const next = await runOnce(h);

            expect(next.reasonCodes.filter((code) => code.startsWith("drive-"))).toEqual([]);
            expect(next.counts).toMatchObject({ verified: PDFS, driveVerified: PDFS, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 });
            expect(h.api.artifactRequests()).toHaveLength(artifactRequests);
            const tree = await driveTree(h, fakes);
            expect(driveKeys(tree, PDF_KEY)).toEqual(pdfsBefore);
            expect(fakes.drive.uploadsCompleted - uploadsBefore).toBe(driveKeys(tree, JSON_KEY).length - jsonBefore);
            expect(fakes.drive.nodes().filter((node) => node.bytes !== null && node.name.endsWith(".pdf"))).toHaveLength(PDFS);
        }, 240_000);

        it("should yield a Drive mirror that restore-drive verifies completely after recover and one more run", async () => {
            await populate();
            await loseLedger();
            await recover();
            await runOnce(h);
            const out = path.join(h.base, "mirror-out");
            const outputs: string[] = [];

            const code = await runRestoreDriveCli(["--config", h.configPath, "--out", out], { out: (line) => outputs.push(line), err: () => undefined });

            expect(code).toBe(0);
            const report = await readJsonFile<{ verified: number; failed: number }>(path.join(out, "restore-drive-report.json"));
            expect(report).toMatchObject({ failed: 0 });
            expect(report.verified).toBe((await listFiles(h.archive)).length);
        }, 240_000);

        it("should do nothing on Drive when recover runs again after it finished", async () => {
            await populate();
            await loseLedger();
            await recover();
            const ledgerLength = (await records()).length;
            const before = counters();

            await recover();

            expect(fakes.drive.requests).toHaveLength(before.requests);
            expect(await records()).toHaveLength(ledgerLength);
        }, 180_000);

        it("should not import a layout it cannot tell apart: a path held by two Drive files is refused as drive-conflict and nothing is bound", async () => {
            await populate();
            const key = pdfKeyOf("D001", "document");
            const original1 = fakes.drive.node(driveIds().files.get(key)!)!;
            fakes.drive.seed({ id: "DuplicateOfPdf000001", name: original1.name, mimeType: original1.mimeType, parents: original1.parents, bytes: original1.bytes });
            await loseLedger();

            await expect(recover()).rejects.toMatchObject({ reasonCode: "drive-conflict" });

            expect(await records("drive_bound")).toEqual([]);
            expect((await records("recovered_verified")).length).toBe(PDFS);
        }, 180_000);
    });

    describe("conflicts are refused, the local result is kept", () => {
        it("should refuse two roots of the same installation with drive-root-changed, then take the one the operator names", async () => {
            await populate();
            const second = await seedSecondRoot();
            await loseLedger();
            const before = counters();

            const failure = await recover().catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(WorkerError);
            expect(failure).toMatchObject({ reasonCode: "drive-root-changed" });
            expect((failure as { candidates: Array<{ rootFolderId: string; bindingId: string | null }> }).candidates)
                .toEqual([{ rootFolderId: rootId, bindingId: original["bindingId"] }, { rootFolderId: second, bindingId: NEW_BINDING }].sort((a, b) => (a.rootFolderId < b.rootFolderId ? -1 : 1)));
            expect(await records("drive_bound")).toEqual([]);
            expect((await records("recovered_verified")).length).toBe(PDFS);
            expect(fakes.drive.creates).toBe(before.creates);

            const summary = await recover(installationId, rootId);

            expect(summary).toMatchObject({ outcome: "finished", recovered: 0, unverified: 0 });
            expect((await records("drive_bound"))[0]!.body).toEqual(original);
            expect((await driveRecovered())).toHaveLength(PDFS);
            expect(fakes.drive.creates).toBe(before.creates);
        }, 240_000);

        it("should print the candidate roots as one ids-only stdout line (A2.4), keep stderr to the reason code and exit 69, then succeed with --drive-root-folder-id", async () => {
            await populate();
            const second = await seedSecondRoot();
            await loseLedger();
            const run = async (extra: string[]) => {
                const out: string[] = [];
                const err: string[] = [];
                const code = await runWorkerCli(
                    ["recover", "--config", h.configPath, "--installation-id", installationId, ...extra],
                    environmentFor(h, { out: (line) => out.push(line), err: (line) => err.push(line) }),
                );
                return { code, out, err };
            };

            const refused = await run([]);

            expect(refused.code).toBe(69);
            expect(refused.err).toEqual(["drive-root-changed"]);
            const expected = [{ rootFolderId: rootId, bindingId: original["bindingId"] }, { rootFolderId: second, bindingId: NEW_BINDING }]
                .sort((a, b) => (a.rootFolderId < b.rootFolderId ? -1 : 1));
            expect(refused.out.map((line) => JSON.parse(line))).toEqual([{ event: "recover_drive_root_ambiguous", reasonCode: "drive-root-changed", candidates: expected }]);
            const printed = refused.out.join("\n");
            for (const secret of ["bjj-eformsign-backup", "127.0.0.1", "Bearer", fakes.oauth.refreshToken, fakes.oauth.clientSecret]) expect(printed).not.toContain(secret);

            const chosen = await run(["--drive-root-folder-id", rootId]);

            expect(chosen.code).toBe(0);
            expect(chosen.err).toEqual([]);
            expect((await records("drive_bound"))[0]!.body).toEqual(original);
        }, 240_000);

        it("should refuse with drive-root-changed when the only root was trashed, and when the named id is not a root of this installation", async () => {
            await populate();
            fakes.drive.trash(rootId);
            await loseLedger();

            await expect(recover()).rejects.toMatchObject({ reasonCode: "drive-root-changed" });
            await expect(recover(installationId, rootId)).rejects.toMatchObject({ reasonCode: "drive-root-changed" });
            await expect(recover(installationId, driveIds().files.get(MARKER) ?? "NoSuchFolder000001")).rejects.toMatchObject({ reasonCode: "drive-root-changed" });

            expect(await records("drive_bound")).toEqual([]);
            expect((await records("recovered_verified")).length).toBe(PDFS);
        }, 180_000);

        it("should refuse with archive-conflict when the marker on Drive differs from the archive marker", async () => {
            await populate();
            fakes.drive.corrupt(driveIds().files.get(MARKER)!);
            await loseLedger();
            const before = counters();

            await expect(recover()).rejects.toMatchObject({ reasonCode: "archive-conflict" });

            expect(await records("drive_bound")).toEqual([]);
            expect(await driveRecovered()).toEqual([]);
            expect(fakes.drive.creates).toBe(before.creates);
        }, 180_000);

        it("should not import a Drive manifest that fails parseManifestBytes, nor mark its artifacts recovered", async () => {
            await populate();
            const ids = driveIds().files;
            const manifestKey = [...ids.keys()].find((key) => key.includes("/D001/manifests/"))!;
            fakes.drive.corrupt(ids.get(manifestKey)!);
            await loseLedger();

            await recover();

            const published = (await records("drive_record_published")).map((record) => record.body["relativeKey"]);
            expect(published).not.toContain(manifestKey);
            expect(published.filter((key) => String(key).includes("/manifests/"))).toHaveLength(DOCUMENTS.length - 1);
            const recovered = (await driveRecovered()).map((record) => String(record.body["relativeKey"]));
            expect(recovered).toHaveLength(PDFS - 2);
            expect(recovered.some((key) => key.includes("/D001/"))).toBe(false);
            // The damaged record's path is a node (a later publish compares against it instead of creating a twin).
            expect((await records("drive_node_reserved")).map((record) => record.body["nodeKey"])).toContain(manifestKey);
        }, 180_000);
    });

    describe("an artifact is recovered only after Drive's own facts or its bytes prove it (u6-trustlisting)", () => {
        it("should leave a file out when its bytes were damaged although its name and size still match the listing", async () => {
            await populate();
            const damagedKey = pdfKeyOf("D002", "document");
            fakes.drive.corrupt(driveIds().files.get(damagedKey)!);
            await loseLedger();

            const summary = await recover();

            expect(summary).toMatchObject({ recovered: PDFS });
            const recovered = (await driveRecovered()).map((record) => String(record.body["relativeKey"]));
            expect(recovered).toHaveLength(PDFS - 1);
            expect(recovered).not.toContain(damagedKey);
            // The damaged file is a node, so the next run settles it as an integrity error instead of creating a twin silently.
            expect((await records("drive_node_reserved")).map((record) => record.body["nodeKey"])).toContain(damagedKey);
        }, 180_000);

        it("should download and hash when Drive omits its checksum, and still refuse the damaged file", async () => {
            await populate();
            const damagedKey = pdfKeyOf("D003", "audit-trail");
            fakes.drive.corrupt(driveIds().files.get(damagedKey)!);
            fakes.drive.addFault({ route: "get", action: driveFaults.omitSha256() });
            fakes.drive.addFault({ route: "list", action: driveFaults.omitSha256() });
            await loseLedger();
            const downloads = fakes.drive.downloads;

            await recover();

            const recovered = (await driveRecovered()).map((record) => String(record.body["relativeKey"]));
            expect(recovered).toHaveLength(PDFS - 1);
            expect(recovered).not.toContain(damagedKey);
            expect(fakes.drive.downloads - downloads).toBeGreaterThanOrEqual(PDFS);
        }, 180_000);
    });

    describe("recover never creates anything on Drive (u6-createonrecover)", () => {
        it("should leave a missing folder missing, recover the rest, and let the next run create exactly what is missing", async () => {
            await populate();
            const folderKey = [...driveIds().folders.keys()].find((key) => key.endsWith("/D001/artifacts/audit-trail"))!;
            fakes.drive.trash(driveIds().folders.get(folderKey)!);
            await loseLedger();
            const before = counters();

            await recover();

            expect(fakes.drive.creates).toBe(before.creates);
            expect(fakes.drive.uploadsCompleted).toBe(before.uploads);
            expect((await driveRecovered())).toHaveLength(PDFS - 1);
            expect((await records("drive_node_reserved")).map((record) => record.body["nodeKey"])).not.toContain(folderKey);

            const next = await runOnce(h);

            expect(next.counts).toMatchObject({ driveVerified: PDFS, driveBlocked: 0, driveIntegrityError: 0 });
            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(PDFS);
        }, 240_000);

        it("should not recover a trashed file and let the next run upload just that one", async () => {
            await populate();
            const key = pdfKeyOf("D002", "audit-trail");
            fakes.drive.trash(driveIds().files.get(key)!);
            await loseLedger();
            const before = counters();

            await recover();

            expect(fakes.drive.creates).toBe(before.creates);
            expect((await driveRecovered())).toHaveLength(PDFS - 1);
            // The folder that now holds nothing is still the layout's folder: adopted, so the next run reuses it.
            expect((await records("drive_node_reserved")).map((record) => record.body["nodeKey"])).toContain(key.slice(0, key.lastIndexOf("/")));

            await runOnce(h);

            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(PDFS);
            expect(fakes.drive.uploadsCompleted - before.uploads).toBeGreaterThanOrEqual(1);
            expect(fakes.drive.creates - before.creates).toBe(fakes.drive.uploadsCompleted - before.uploads);
            expect(liveDuplicates()).toEqual([]);
        }, 240_000);
    });

    describe("resume and failure reasons", () => {
        it("should converge without duplicates when recover is killed after its first Drive artifact and run again", async () => {
            await populate();
            await loseLedger();
            const before = counters();

            const child = spawnUnderFlock(h, ["recover", "--config", h.configPath, "--installation-id", installationId, "--kill-at", "drive-recover-after-first"]);
            expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
            expect(await driveRecovered()).toHaveLength(1);
            expect((await records("drive_ready"))).toEqual([]);
            expect(await records("drive_bound")).toHaveLength(1);

            const summary = await recover();

            expect(summary).toMatchObject({ outcome: "finished", recovered: 0, unverified: 0 });
            const recovered = await driveRecovered();
            expect(recovered).toHaveLength(PDFS);
            expect(new Set(recovered.map((record) => record.body["artifactIdentity"])).size).toBe(PDFS);
            expect(await records("drive_bound")).toHaveLength(1);
            expect(await records("drive_ready")).toHaveLength(1);
            const reservedKeys = (await records("drive_node_reserved")).map((record) => record.body["nodeKey"]);
            expect(new Set(reservedKeys).size).toBe(reservedKeys.length);
            expect((await records("recovery_started"))).toHaveLength(1);
            expect(fakes.drive.creates).toBe(before.creates);
            expect(fakes.drive.uploadsCompleted).toBe(before.uploads);
            expect((await runOnce(h)).counts).toMatchObject({ driveVerified: PDFS, driveBlocked: 0 });
        }, 240_000);

        it("should exit 78 with drive-token-invalid when the refresh token is revoked between page 1 and page 2 of a listing, keeping the local result", async () => {
            await populate();
            await loseLedger();
            fakes.drive.pageSizeCap = 1;
            let revoked = false;
            const fetchImpl: typeof fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
                if (!revoked && url.includes("pageToken=")) {
                    revoked = true;
                    fakes.oauth.revoke();
                }
                return fetch(input, init);
            };
            const err: string[] = [];

            const code = await runWorkerCli(
                ["recover", "--config", h.configPath, "--installation-id", installationId],
                environmentFor(h, { fetchImpl, out: () => undefined, err: (line) => err.push(line) }),
            );

            expect(revoked).toBe(true);
            expect([code, err]).toEqual([78, ["drive-token-invalid"]]);
            expect(await records("drive_bound")).toEqual([]);
            expect((await records("recovered_verified")).length).toBe(PDFS);
        }, 240_000);

        it("should finish the Drive part on a second recover when Drive was down for the first (Drive-only recover)", async () => {
            await populate();
            await loseLedger();
            const fault = fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });
            const before = counters();

            await expect(recover()).rejects.toMatchObject({ reasonCode: "drive-unavailable" });
            expect((await records("recovered_verified")).length).toBe(PDFS);
            expect(await records("drive_bound")).toEqual([]);
            fakes.drive.faults.splice(fakes.drive.faults.indexOf(fault), 1);

            await recover();

            expect(await driveRecovered()).toHaveLength(PDFS);
            expect(await records("drive_ready")).toHaveLength(1);
            expect(fakes.drive.creates).toBe(before.creates);
        }, 240_000);

        it("should keep the local result and end with the secret-file reason when a Drive secret file is unusable (A8)", async () => {
            await populate();
            await loseLedger();
            await fs.chmod(fakes.refreshTokenFile, 0o644);
            const before = counters();
            const tokenRequests = fakes.oauth.tokenRequests;
            const err: string[] = [];

            const code = await runWorkerCli(
                ["recover", "--config", h.configPath, "--installation-id", installationId],
                environmentFor(h, { out: () => undefined, err: (line) => err.push(line) }),
            );

            expect([code, err]).toEqual([78, ["token-file-invalid"]]);
            expect((await records("recovered_verified")).length).toBe(PDFS);
            expect(await records("drive_bound")).toEqual([]);
            expect(fakes.drive.requests).toHaveLength(before.requests);
            expect(fakes.oauth.tokenRequests).toBe(tokenRequests);
        }, 180_000);

        it("should refuse --drive-root-folder-id as drive-not-configured, before changing anything, when the config has no drive block", async () => {
            h = await createHarness({ docs: [pairDoc("D001")] });
            await initArchive(h);
            await runOnce(h);
            installationId = (await readJsonFile<{ installationId: string }>(path.join(h.archive, MARKER))).installationId;
            await loseLedger();

            await expect(recover(installationId, "SomeRootFolder000001")).rejects.toMatchObject({ reasonCode: "drive-not-configured" });

            await expect(fs.readdir(path.join(h.control, "ledger"))).rejects.toMatchObject({ code: "ENOENT" });
            expect(await recover()).toMatchObject({ outcome: "finished", recovered: 2 });
        }, 180_000);
    });

    describe("verify checks the Drive entries of the current binding", () => {
        const driveHistory = async (id: string) =>
            (await driveTransitions()).filter((record) => record.body["artifactIdentity"] === id).map((record) => record.body["to"]);
        const identityOf = async (key: string): Promise<string> => {
            const found = [...(await driveTransitions()), ...(await driveRecovered())].find((record) => record.body["relativeKey"] === key);
            return String(found!.body["artifactIdentity"]);
        };
        const lastRun = async () => (await records("run_finished")).pop()!;

        it("should touch Drive not at all while no entry is due, and recheck every entry with --all, downloading the bytes", async () => {
            await populate();
            const before = counters();

            const quiet = await verify(false);

            expect(quiet).toMatchObject({ checked: 0, integrityErrors: 0, archiveAvailable: true });
            expect(fakes.drive.requests).toHaveLength(before.requests);

            const downloads = fakes.drive.downloads;
            const all = await verify(true);

            expect(all).toMatchObject({ checked: 2 * PDFS, integrityErrors: 0 });
            expect(fakes.drive.downloads - downloads).toBeGreaterThanOrEqual(PDFS);
            expect(fakes.drive.creates).toBe(before.creates);
            expect(fakes.drive.uploadsCompleted).toBe(before.uploads);
        }, 180_000);

        it("should recheck entries older than seven days without --all", async () => {
            await populate();
            h.clock.advance(8 * 24 * 3600 * 1000);
            const requests = fakes.drive.requests.length;

            const summary = await verify(false);

            expect(summary).toMatchObject({ checked: 2 * PDFS, integrityErrors: 0 });
            expect(fakes.drive.requests.length).toBeGreaterThan(requests);
        }, 180_000);

        it("should turn a damaged Drive file into an integrity_error of the Drive entry only, keeping the earlier success events", async () => {
            await populate();
            const key = pdfKeyOf("D001", "document");
            const identity = await identityOf(key);
            fakes.drive.corrupt(driveIds().files.get(key)!);

            const summary = await verify(true);

            expect(summary).toMatchObject({ checked: 2 * PDFS, integrityErrors: 1 });
            expect(await driveHistory(identity)).toEqual(["pending", "transferring", "verifying", "verified", "integrity_error"]);
            const local = (await records("destination_transition")).filter((record) => !isDrive(record) && record.body["artifactIdentity"] === identity);
            expect(local.map((record) => record.body["to"])).toEqual(["pending", "transferring", "verifying", "verified"]);
            const status = await withWorker(h, "inspect", async (worker) => worker.runner.inspect());
            expect(status.counts).toMatchObject({ driveVerified: PDFS - 1, driveIntegrityError: 1, verified: PDFS });
            expect((await lastRun()).body["reasonCodes"]).toEqual([]);
        }, 180_000);

        it("should find a damaged file by hashing its bytes when Drive omits the checksum", async () => {
            await populate();
            const key = pdfKeyOf("D002", "audit-trail");
            const identity = await identityOf(key);
            fakes.drive.corrupt(driveIds().files.get(key)!);
            fakes.drive.addFault({ route: "get", action: driveFaults.omitSha256() });
            fakes.drive.addFault({ route: "list", action: driveFaults.omitSha256() });
            const downloads = fakes.drive.downloads;

            const summary = await verify(true);

            expect(summary).toMatchObject({ integrityErrors: 1 });
            expect((await driveHistory(identity)).pop()).toBe("integrity_error");
            expect(fakes.drive.downloads - downloads).toBeGreaterThanOrEqual(PDFS);
        }, 180_000);

        it("should turn a trashed Drive file into an integrity_error", async () => {
            await populate();
            const key = pdfKeyOf("D003", "document");
            const identity = await identityOf(key);
            fakes.drive.trash(driveIds().files.get(key)!);

            const summary = await verify(true);

            expect(summary).toMatchObject({ integrityErrors: 1 });
            expect((await driveHistory(identity)).pop()).toBe("integrity_error");
        }, 180_000);

        it("should write no transition and name drive-unavailable in the run record when Drive cannot be reached", async () => {
            await populate();
            const key = pdfKeyOf("D001", "audit-trail");
            fakes.drive.corrupt(driveIds().files.get(key)!);
            fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });
            const before = (await driveTransitions()).length;

            const summary = await verify(true);

            // Only the local archive was rechecked: Drive gave no answer, so it contributes nothing.
            expect(summary).toMatchObject({ outcome: "finished", checked: PDFS, integrityErrors: 0, archiveAvailable: true });
            expect(await driveTransitions()).toHaveLength(before);
            expect(await lastRun()).toMatchObject({ body: { snapshotStatus: "partial", reasonCodes: ["drive-unavailable"] } });
        }, 180_000);

        it("should write no transition and name drive-root-changed when the Drive root was trashed", async () => {
            await populate();
            fakes.drive.trash(rootId);
            const before = (await driveTransitions()).length;

            const summary = await verify(true);

            expect(summary).toMatchObject({ checked: PDFS, integrityErrors: 0 });
            expect(await driveTransitions()).toHaveLength(before);
            expect((await lastRun()).body["reasonCodes"]).toEqual(["drive-root-changed"]);
        }, 180_000);

        it("should still verify Drive while the local archive is unavailable", async () => {
            await populate();
            const key = pdfKeyOf("D001", "document");
            const identity = await identityOf(key);
            fakes.drive.corrupt(driveIds().files.get(key)!);
            await swapArchive(h);

            const summary = await verify(true);

            expect(summary).toMatchObject({ archiveAvailable: false, integrityErrors: 1 });
            expect((await driveHistory(identity)).pop()).toBe("integrity_error");
            expect(await lastRun()).toMatchObject({ body: { snapshotStatus: "blocked", reasonCodes: ["archive-unavailable"] } });
        }, 180_000);

        it("should verify entries that recover wrote, whose byte length the ledger does not know", async () => {
            await populate();
            await loseLedger();
            await recover();
            const clean = await verify(true);
            expect(clean).toMatchObject({ checked: 2 * PDFS, integrityErrors: 0 });
            const key = pdfKeyOf("D002", "document");
            const identity = await identityOf(key);
            fakes.drive.corrupt(driveIds().files.get(key)!);

            const damaged = await verify(true);

            expect(damaged).toMatchObject({ integrityErrors: 1 });
            expect((await driveHistory(identity)).pop()).toBe("integrity_error");
        }, 240_000);
    });
});
