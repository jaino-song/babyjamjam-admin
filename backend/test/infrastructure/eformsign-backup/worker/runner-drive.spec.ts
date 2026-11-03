import { promises as fs } from "node:fs";
import path from "node:path";

import { runRestoreDriveCli } from "infrastructure/eformsign-backup/worker/cli-restore-drive";
import { runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";
import { DRIVE_OUTBOX_DIR } from "infrastructure/eformsign-backup/worker/drive-outbox";
import { destinationKey, driveStateKey } from "domain/eformsign-backup/worker";
import { assertLedgerRoom } from "infrastructure/eformsign-backup/worker/runner-common";
import { readOutbox, writeOutbox } from "infrastructure/eformsign-backup/worker/drive-outbox";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { DriveRunPhase } from "infrastructure/eformsign-backup/worker/runner-drive";
import { DestinationLedger, controlMarkerWriter } from "infrastructure/eformsign-backup/worker/runner-common";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { hashOf, makePhaseRig, rigDoc, rigUuid, type PhaseRig, type RigDoc } from "./helpers/drive-run-support";
import {
    COMPLETION_KEY, JSON_KEY, MANIFEST_KEY, MIB, PDF_KEY, RUN_KEY, bindDrive, driveKeys, driveTree, probeWith, swapArchive, swapBack,
} from "./helpers/drive-run-support";
import { driveFaults } from "./helpers/fake-drive-server";
import {
    COMPANY, createHarness, destroyHarness, environmentFor, initArchive, listFiles, pairDoc, readCompletions, readLedgerRecords, runOnce,
    sha256Of, singleDoc, transitionPath, treeContains, tryRun, type Harness,
} from "./helpers/runner-support";

describe("runner Drive phase (BJJ-456 U5): the second, independent destination", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    const make = async (docs: Parameters<typeof createHarness>[0] extends infer O ? (O extends { docs?: infer D } ? D : never) : never, bound = true): Promise<void> => {
        h = await createHarness({ docs, config: { drive: fakes.config } as never });
        await initArchive(h);
        if (bound) await bindDrive(h);
    };
    const localTransitions = async (): Promise<number> =>
        (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && !String(record.body["destinationIdentity"]).startsWith("drive:")).length;
    const stagingBins = async (): Promise<string[]> => (await fs.readdir(path.join(h.control, "staging"))).filter((name) => name.endsWith(".bin"));
    const driveStates = async (): Promise<string[]> =>
        (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && String(record.body["destinationIdentity"]).startsWith("drive:")).map((record) => String(record.body["to"]));

    describe("T16: Drive is bound, unset or failing, and the local archive does not care", () => {
        it("should report drive-not-configured and make no Drive or OAuth request while Drive was never bound", async () => {
            await make([pairDoc("D001")], false);

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ snapshotStatus: "partial", counts: { verified: 2, driveVerified: 0 } });
            expect(summary.reasonCodes).toEqual(["coverage-unverified", "drive-not-configured"]);
            expect(fakes.drive.requests).toHaveLength(0);
            expect(fakes.oauth.tokenRequests).toBe(0);
        });

        it("should mirror the local archive onto Drive byte for byte, keep staging, and walk every artifact through pending to verified", async () => {
            await make([pairDoc("D001")]);

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ snapshotStatus: "partial", counts: { verified: 2, driveVerified: 2, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 } });
            expect(summary.reasonCodes).toEqual(["coverage-unverified"]);
            const tree = await driveTree(h, fakes);
            expect([...tree.keys()].sort()).toEqual((await listFiles(h.archive)).sort());
            for (const [key, bytes] of tree) expect((await fs.readFile(path.join(h.archive, key))).equals(bytes)).toBe(true);
            expect(await stagingBins()).toHaveLength(2);
            const records = await readLedgerRecords(h.control);
            const identity = records.find((record) => record.type === "destination_transition" && String(record.body["destinationIdentity"]).startsWith("drive:"))!.body["artifactIdentity"] as string;
            const driveOnly = records.filter((record) => record.type === "destination_transition" && record.body["artifactIdentity"] === identity && String(record.body["destinationIdentity"]).startsWith("drive:"));
            expect(driveOnly.map((record) => record.body["to"])).toEqual(["pending", "transferring", "verifying", "verified"]);
        });

        it.each([
            ["the refresh token is revoked", "drive-token-invalid", () => fakes.drive.revokeAccess(), () => fakes.oauth.restore()],
            ["the Drive quota is exhausted", "drive-quota", () => fakes.drive.setQuotaExceeded(true), () => fakes.drive.setQuotaExceeded(false)],
            ["Drive refuses every request with 403", "drive-permission", () => { fakes.drive.addFault({ route: "*", action: driveFaults.status(403, "forbidden") }); }, () => fakes.drive.clearFaults()],
        ] as const)("should keep local verified and block only Drive when %s, then upload only to Drive after recovery", async (_name, reason, damage, repair) => {
            await make([pairDoc("D001")]);
            damage();

            const first = await runOnce(h);

            expect(first).toMatchObject({ snapshotStatus: "partial", counts: { verified: 2, driveVerified: 0, driveBlocked: 2 } });
            expect(first.reasonCodes).toContain(reason);
            expect((await fs.readdir(path.join(h.control, "staging"))).length).toBeGreaterThan(0);
            expect(fakes.drive.uploadsCompleted).toBe(1); // only the installation marker from drive-setup
            const requests = h.api.artifactRequests().length;
            const local = await localTransitions();

            repair();
            const second = await runOnce(h);

            expect(second).toMatchObject({ counts: { verified: 2, driveVerified: 2, driveBlocked: 0 } });
            expect(second.reasonCodes).toEqual(["coverage-unverified"]);
            expect(h.api.artifactRequests()).toHaveLength(requests);
            expect(await localTransitions()).toBe(local);
            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(2);
        });
    });

    describe("T24: the artifacts reach Drive but the records do not", () => {
        it("should leave the artifacts Drive-verified and the run partial when the manifest upload fails, then upload only the missing JSON", async () => {
            await make([pairDoc("D001")]);
            const base = fakes.drive.uploadsCompleted;
            fakes.drive.addFault({ route: "uploadStart", match: () => fakes.drive.uploadsCompleted - base >= 2, action: driveFaults.status(503) });

            const first = await runOnce(h);

            expect(first).toMatchObject({ snapshotStatus: "partial", counts: { verified: 2, driveVerified: 2 } });
            expect(first.reasonCodes).toContain("drive-unavailable");
            const tree1 = await driveTree(h, fakes);
            expect(driveKeys(tree1, PDF_KEY)).toHaveLength(2);
            expect(driveKeys(tree1, COMPLETION_KEY)).toEqual([]);
            expect(driveKeys(tree1, MANIFEST_KEY)).toEqual([]);

            fakes.drive.clearFaults();
            const nodesBefore = fakes.drive.nodes().length;
            const pdfNodes = driveKeys(tree1, PDF_KEY).length;
            const uploadsBefore = fakes.drive.uploadsCompleted;
            const second = await runOnce(h);

            expect(second.reasonCodes).toEqual(["coverage-unverified"]);
            const tree2 = await driveTree(h, fakes);
            expect(driveKeys(tree2, PDF_KEY)).toHaveLength(pdfNodes);
            const jsonCount = [...tree2.keys()].filter((key) => JSON_KEY.test(key) && !key.startsWith(".bjj-backup/")).length;
            expect(fakes.drive.uploadsCompleted - uploadsBefore).toBe(jsonCount);
            expect(fakes.drive.nodes().length).toBeGreaterThan(nodesBefore);
            const local = await readCompletions(h.archive);
            const driveCompletions = driveKeys(tree2, COMPLETION_KEY);
            expect(driveCompletions).toHaveLength(local.length);
            for (const completion of local) {
                const onDrive = tree2.get(`eformsign/${COMPANY}/completions/${completion.name}`);
                expect(onDrive?.equals(await fs.readFile(path.join(h.archive, "eformsign", COMPANY, "completions", completion.name)))).toBe(true);
            }
        });
    });

    describe("T24: a completion never reaches Drive before the manifests it names", () => {
        it("should hold the completion back when only the manifest upload is refused, although Drive would take the completion, and publish both next run", async () => {
            await make([pairDoc("D001")]);
            const base = fakes.drive.uploadsCompleted;
            // Exactly one refusal: the third upload of the run, which is the manifest (after the two PDFs).
            fakes.drive.addFault({ route: "uploadStart", times: 1, match: () => fakes.drive.uploadsCompleted - base === 2, action: driveFaults.status(503) });

            const first = await runOnce(h);

            expect(first.reasonCodes).toContain("drive-unavailable");
            const tree1 = await driveTree(h, fakes);
            expect(driveKeys(tree1, PDF_KEY)).toHaveLength(2);
            expect(driveKeys(tree1, MANIFEST_KEY)).toEqual([]);
            expect(driveKeys(tree1, COMPLETION_KEY)).toEqual([]);

            const second = await runOnce(h);

            expect(second.reasonCodes).toEqual(["coverage-unverified"]);
            const tree2 = await driveTree(h, fakes);
            expect(driveKeys(tree2, MANIFEST_KEY)).toHaveLength(1);
            const local = await readCompletions(h.archive);
            expect(driveKeys(tree2, COMPLETION_KEY)).toHaveLength(local.length);
            for (const completion of local) {
                const key = `eformsign/${COMPANY}/completions/${completion.name}`;
                expect(tree2.get(key)?.equals(await fs.readFile(path.join(h.archive, key)))).toBe(true);
            }
        });
    });

    describe("T24: a run inventory that Drive refused is caught up", () => {
        it("should queue the refused inventory and publish its original bytes next run, with no artifact upload", async () => {
            await make([pairDoc("D001")]);
            const base = fakes.drive.uploadsCompleted;
            // 2 PDFs, the manifest and the completion are accepted; the fourth upload, the run inventory, is refused once.
            fakes.drive.addFault({ route: "uploadStart", times: 1, match: () => fakes.drive.uploadsCompleted - base === 4, action: driveFaults.status(503) });

            const first = await runOnce(h);

            const tree1 = await driveTree(h, fakes);
            expect(driveKeys(tree1, RUN_KEY)).toEqual([]);
            expect(driveKeys(tree1, COMPLETION_KEY)).toHaveLength(1);
            const pending = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_record_pending");
            expect(pending.map((record) => record.body["relativeKey"])).toEqual([`eformsign/${COMPANY}/runs/${first.runId}.json`]);
            const localInventory = await fs.readFile(path.join(h.archive, `eformsign/${COMPANY}/runs/${first.runId}.json`));
            expect(pending[0]!.body["sha256"]).toBe(sha256Of(localInventory));
            expect(await fs.readdir(path.join(h.control, DRIVE_OUTBOX_DIR))).toContain(`${sha256Of(localInventory)}.json`);
            const pdfsBefore = driveKeys(tree1, PDF_KEY).length;
            const pdfUploads = fakes.drive.uploadsCompleted;

            const second = await runOnce(h);

            const tree2 = await driveTree(h, fakes);
            expect(tree2.get(`eformsign/${COMPANY}/runs/${first.runId}.json`)?.equals(localInventory)).toBe(true);
            expect(tree2.get(`eformsign/${COMPANY}/runs/${second.runId}.json`)).toBeDefined();
            expect(driveKeys(tree2, PDF_KEY)).toHaveLength(pdfsBefore);
            // Only the earlier inventory, the second completion and the second inventory: no artifact, no manifest.
            expect(fakes.drive.uploadsCompleted - pdfUploads).toBe(3);
        });

        it("should catch up, from the archive, an inventory whose Drive upload was dropped while the Drive gate was closed", async () => {
            await make([singleDoc("D001")]);
            fakes.drive.revokeAccess();
            const first = await runOnce(h);
            expect(first.reasonCodes).toContain("drive-token-invalid");
            expect(driveKeys(await driveTree(h, fakes), RUN_KEY)).toEqual([]);
            fakes.oauth.restore();

            await runOnce(h);

            const tree = await driveTree(h, fakes);
            const mine = await fs.readFile(path.join(h.archive, `eformsign/${COMPANY}/runs/${first.runId}.json`));
            expect(tree.get(`eformsign/${COMPANY}/runs/${first.runId}.json`)?.equals(mine)).toBe(true);
        });
    });

    describe("T29: the root moved or was trashed", () => {
        it("should stop with drive-root-changed and no upload, then re-upload everything under the new revision after a rebind", async () => {
            await make([pairDoc("D001")]);
            await runOnce(h);
            const oldRoot = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_bound").slice(-1)[0]!.body["rootFolderId"] as string;
            fakes.drive.trash(oldRoot);
            const before = { creates: fakes.drive.creates, uploads: fakes.drive.uploadsCompleted, sessions: fakes.drive.sessionsStarted };

            const stopped = await runOnce(h);

            expect(stopped.reasonCodes).toContain("drive-root-changed");
            expect(stopped.counts).toMatchObject({ verified: 2, driveVerified: 2, driveBlocked: 0 });
            expect([fakes.drive.creates, fakes.drive.uploadsCompleted, fakes.drive.sessionsStarted]).toEqual([before.creates, before.uploads, before.sessions]);

            await bindDrive(h, true);
            const rebound = await runOnce(h);

            expect(rebound).toMatchObject({ counts: { verified: 2, driveVerified: 2 } });
            expect(rebound.reasonCodes).toEqual(["coverage-unverified"]);
            const tree = await driveTree(h, fakes);
            // The new root holds exactly what the archive holds, run inventories of the earlier runs included (from the archive's bytes).
            expect([...tree.keys()].sort()).toEqual((await listFiles(h.archive)).sort());
            expect(driveKeys(tree, RUN_KEY)).toHaveLength(3);
            expect(driveKeys(tree, COMPLETION_KEY)).toHaveLength((await readCompletions(h.archive)).length);
            // The old revision's verified entries are not current: the new revision walked its own path.
            const states = await driveStates();
            expect(states.filter((state) => state === "verified")).toHaveLength(4);
        });
    });

    describe("V08: the archive is down, Drive is not", () => {
        it("should upload from staging while the archive is gone, publish a Drive-only completion with the exact document set, and converge when the archive returns", async () => {
            await make([pairDoc("D001")]);
            const away = await swapArchive(h);

            const first = await runOnce(h);

            expect(first).toMatchObject({ snapshotStatus: "blocked", counts: { verified: 0, blocked: 2, driveVerified: 2 } });
            expect(first.reasonCodes).toContain("archive-unavailable");
            expect(await stagingBins()).toHaveLength(2);
            expect(await listFiles(h.archive)).toEqual([]);
            const tree = await driveTree(h, fakes);
            expect(driveKeys(tree, PDF_KEY)).toHaveLength(2);
            expect(driveKeys(tree, MANIFEST_KEY)).toHaveLength(1);
            const completions = driveKeys(tree, COMPLETION_KEY);
            expect(completions).toHaveLength(1);
            const completion = JSON.parse(tree.get(completions[0]!)!.toString("utf8"));
            expect(completion.entries.map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001"]);
            expect(completion.gaps).toEqual([]);
            expect(driveKeys(tree, RUN_KEY)).toHaveLength(1);

            await swapBack(h, away);
            const requests = h.api.artifactRequests().length;
            const pdfUploads = driveKeys(await driveTree(h, fakes), PDF_KEY).length;
            const second = await runOnce(h);

            expect(second).toMatchObject({ counts: { verified: 2, blocked: 0, driveVerified: 2 } });
            expect(h.api.artifactRequests()).toHaveLength(requests);
            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(pdfUploads);
        });

        it("should make no Drive request at all while the control directory is unusable (no room, then a ledger failure)", async () => {
            await make([pairDoc("D001")]);
            const requests = fakes.drive.requests.length;

            const noRoom = await tryRun(h, { probe: probeWith(h, 10 * MIB) });
            expect(noRoom).toMatchObject({ reasonCode: "control-space" });
            expect(fakes.drive.requests.length).toBe(requests);

            let fired = false;
            const broken = await tryRun(h, {
                ledgerFault: (point) => {
                    if (point === "before-fsync" && !fired && h.api.artifactRequests().length >= 1) {
                        fired = true;
                        throw Object.assign(new Error("EIO"), { code: "EIO" });
                    }
                },
            });
            expect(broken).toMatchObject({ reasonCode: "control-unavailable" });
            expect(fakes.drive.requests.length).toBe(requests);
        });
    });

    describe("A3.3: the Drive-only completion is the exact document set, restorable, and survives a refused upload", () => {
        it("should name the documents whose artifacts are all on Drive and list the one that is not, and restore-drive then restore --latest give exactly that set", async () => {
            await make([pairDoc("D001"), pairDoc("D003"), singleDoc("D002")]);
            h.api.addFault({ route: "artifact", times: 100, match: (info) => info.documentId === "D003", fault: { kind: "status", status: 503, code: "unavailable", retryable: true } });
            const away = await swapArchive(h);

            const summary = await runOnce(h);

            expect(summary.reasonCodes).toContain("archive-unavailable");
            const tree = await driveTree(h, fakes);
            const completion = JSON.parse(tree.get(driveKeys(tree, COMPLETION_KEY)[0]!)!.toString("utf8"));
            expect(completion.entries.map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001", "D002"]);
            expect(completion.gaps.map((gap: { documentId: string }) => gap.documentId)).toEqual(["D003"]);

            const out = path.join(h.base, "mirror");
            const lines: string[] = [];
            const errors: string[] = [];
            expect(await runRestoreDriveCli(["--config", h.configPath, "--out", out], { out: (line) => lines.push(line), err: (line) => errors.push(line) })).toBe(0);
            expect(errors).toEqual([]);
            const restored = path.join(h.base, "restored");
            await fs.mkdir(restored, { mode: 0o700 });
            const report = await restoreFromArchive({ archivePath: out, companyId: COMPANY, selector: { latest: true }, outDir: restored });
            expect(report.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002"]);
            await swapBack(h, away);
        }, 120_000);

        it("should publish the original completion bytes from the outbox, with no artifact upload, after a refused completion upload and a restart", async () => {
            await make([pairDoc("D001"), pairDoc("D002")]);
            const away = await swapArchive(h);
            const base = fakes.drive.uploadsCompleted;
            // 4 PDFs and 2 manifests reach Drive, then every further upload is refused.
            fakes.drive.addFault({ route: "uploadStart", match: () => fakes.drive.uploadsCompleted - base >= 6, action: driveFaults.status(503) });

            const first = await runOnce(h);

            expect(first.reasonCodes).toContain("drive-unavailable");
            const tree1 = await driveTree(h, fakes);
            expect(driveKeys(tree1, PDF_KEY)).toHaveLength(4);
            expect(driveKeys(tree1, MANIFEST_KEY)).toHaveLength(2);
            expect(driveKeys(tree1, COMPLETION_KEY)).toEqual([]);
            const outbox = await fs.readdir(path.join(h.control, DRIVE_OUTBOX_DIR));
            expect(outbox.length).toBeGreaterThanOrEqual(1);
            const pending = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_record_pending");
            const completionPending = pending.find((record) => COMPLETION_KEY.test(String(record.body["relativeKey"])))!;
            expect(completionPending).toBeDefined();
            const originalSha = completionPending.body["sha256"] as string;
            expect(outbox).toContain(`${originalSha}.json`);

            const inventoryPending = pending.find((record) => RUN_KEY.test(String(record.body["relativeKey"])))!;
            expect(inventoryPending).toBeDefined();
            const inventorySha = inventoryPending.body["sha256"] as string;
            expect(outbox).toContain(`${inventorySha}.json`);

            fakes.drive.clearFaults();
            const pdfUploads = driveKeys(tree1, PDF_KEY).length;
            await runOnce(h);

            const tree2 = await driveTree(h, fakes);
            const published = driveKeys(tree2, COMPLETION_KEY).map((key) => sha256Of(tree2.get(key)!));
            expect(published).toContain(originalSha);
            expect(driveKeys(tree2, RUN_KEY).map((key) => sha256Of(tree2.get(key)!))).toContain(inventorySha);
            expect(driveKeys(tree2, PDF_KEY)).toHaveLength(pdfUploads);
            expect(fakes.drive.requests.filter((request) => request.method === "POST" && request.path.includes("/upload/")).length).toBeGreaterThan(0);
            await swapBack(h, away);
        }, 120_000);
    });

    describe("A3.3: outbox bytes follow a rebind", () => {
        it("should publish a record that only the outbox holds under the new revision after a rebind", async () => {
            await make([pairDoc("D001")]);
            const away = await swapArchive(h);
            const base = fakes.drive.uploadsCompleted;
            fakes.drive.addFault({ route: "uploadStart", match: () => fakes.drive.uploadsCompleted - base >= 3, action: driveFaults.status(503) });
            const first = await runOnce(h);
            fakes.drive.clearFaults();
            const inventoryKey = `eformsign/${COMPANY}/runs/${first.runId}.json`;
            const pending = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_record_pending" && record.body["relativeKey"] === inventoryKey);
            expect(pending).toHaveLength(1);
            const sha = pending[0]!.body["sha256"] as string;
            await swapBack(h, away);
            await bindDrive(h, true);

            await runOnce(h);

            const tree = await driveTree(h, fakes);
            expect(tree.get(inventoryKey) && sha256Of(tree.get(inventoryKey)!)).toBe(sha);
        }, 120_000);
    });

    describe("V10: the two copies heal each other", () => {
        it("should restage a deleted local file and its staging copy from Drive and publish it locally again, without a download", async () => {
            await make([pairDoc("D001")]);
            await runOnce(h);
            const pdfs = (await listFiles(h.archive)).filter((file) => PDF_KEY.test(file));
            expect(pdfs).toHaveLength(2);
            const victim = pdfs[0]!;
            const original = await fs.readFile(path.join(h.archive, victim));
            await fs.unlink(path.join(h.archive, victim));
            for (const name of await stagingBins()) {
                if (sha256Of(await fs.readFile(path.join(h.control, "staging", name))) === sha256Of(original)) await fs.unlink(path.join(h.control, "staging", name));
            }
            // The export cannot serve it any more: the only remaining copy is the one on Drive.
            h.api.addFault({ route: "artifact", times: 100, fault: { kind: "status", status: 503, code: "unavailable", retryable: true } });
            const requests = h.api.artifactRequests().length;

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ counts: { verified: 2, blocked: 0, integrityError: 0, terminalUnavailable: 0, driveVerified: 2 } });
            expect(h.api.artifactRequests()).toHaveLength(requests);
            expect((await fs.readFile(path.join(h.archive, victim))).equals(original)).toBe(true);
            expect(await stagingBins()).toHaveLength(2);
        });

        it("should restage a Drive-blocked artifact whose staging copy is gone from the local archive and upload it, with zero export downloads", async () => {
            await make([pairDoc("D001")]);
            fakes.drive.revokeAccess();
            await runOnce(h);
            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(0);
            for (const name of await stagingBins()) await fs.unlink(path.join(h.control, "staging", name));
            h.api.addFault({ route: "artifact", times: 100, fault: { kind: "status", status: 503, code: "unavailable", retryable: true } });
            fakes.oauth.restore();
            const requests = h.api.artifactRequests().length;

            const summary = await runOnce(h);

            expect(summary.counts).toMatchObject({ verified: 2, driveVerified: 2 });
            expect(h.api.artifactRequests()).toHaveLength(requests);
            expect(driveKeys(await driveTree(h, fakes), PDF_KEY)).toHaveLength(2);
        });
    });

    describe("V11: no secret reaches any output", () => {
        it("should keep the canary, tokens, client secret and session URL out of stdout, stderr, the ledger, the checkpoint, the run records and the outbox", async () => {
            const canary = "CANARY-SYNTHETIC-7f3a9c";
            await make([pairDoc("D001"), pairDoc("D002")]);
            fakes.drive.addFault({ route: "*", action: driveFaults.canary(canary) });
            fakes.drive.addFault({ route: "uploadPut", times: 1, action: driveFaults.status(503, "backendError") });
            const out: string[] = [];
            const err: string[] = [];

            const code = await runWorkerCli(["run", "--config", h.configPath], environmentFor(h, { out: (line) => out.push(line), err: (line) => err.push(line) }));
            expect(fakes.drive.uploadsCompleted).toBeGreaterThan(4);
            h.api.docs = [...h.api.docs, pairDoc("D003")];
            fakes.drive.setQuotaExceeded(true);
            const code2 = await runWorkerCli(["run", "--config", h.configPath], environmentFor(h, { out: (line) => out.push(line), err: (line) => err.push(line) }));

            expect([code, code2]).toEqual([expect.any(Number), expect.any(Number)]);
            const blocked = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && String(record.body["destinationIdentity"]).startsWith("drive:") && record.body["to"] === "blocked");
            expect(blocked.map((record) => record.body["reasonCode"])).toContain("drive-quota");
            const needles = [canary, fakes.oauth.refreshToken, fakes.oauth.clientSecret, "fake-access-token-", "upload_id=", fakes.drive.uploadBaseUrl];
            const printed = [...out, ...err].join("\n");
            for (const needle of needles) {
                expect(printed.includes(needle)).toBe(false);
                expect(await treeContains(h.control, needle)).toBe(false);
                expect(await treeContains(h.archive, needle)).toBe(false);
            }
        });
    });

    describe("V10 outside the snapshot: a carried-over local entry is healed from Drive", () => {
        it("should restage a local integrity_error entry that the snapshot no longer lists from the Drive copy and publish it locally, without a download", async () => {
            await make([singleDoc("D001")]);
            await runOnce(h);
            const [victim] = (await listFiles(h.archive)).filter((file) => PDF_KEY.test(file));
            const original = await fs.readFile(path.join(h.archive, victim!));
            const ids = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && !String(record.body["destinationIdentity"]).startsWith("drive:"));
            const identity = ids[0]!.body["artifactIdentity"] as string;
            const store = await LedgerStore.open(h.control, { writeMarker: controlMarkerWriter });
            try {
                const local = new DestinationLedger({ ledger: store, clock: h.clock } as never, store.state.installation!);
                await local.transition(identity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: victim! });
            } finally {
                await store.close();
            }
            await fs.unlink(path.join(h.archive, victim!));
            for (const name of await stagingBins()) await fs.unlink(path.join(h.control, "staging", name));
            h.api.docs = [];
            const requests = h.api.artifactRequests().length;

            const summary = await runOnce(h);

            expect(h.api.artifactRequests()).toHaveLength(requests);
            expect((await fs.readFile(path.join(h.archive, victim!))).equals(original)).toBe(true);
            expect(await transitionPath(h.control, identity)).toEqual(expect.arrayContaining(["integrity_error", "verified"]));
            expect(summary.counts).toMatchObject({ integrityError: 0, driveIntegrityError: 0, driveBlocked: 0 });
        });
    });

    describe("a Drive run never changes what a local-only run would have done", () => {
        it("should leave Drive untouched and the ledger free of Drive transitions when a bound run has nothing new on a later run", async () => {
            await make([singleDoc("D001")]);
            await runOnce(h);
            const before = (await driveStates()).length;
            const uploads = fakes.drive.uploadsCompleted;

            await runOnce(h);

            expect((await driveStates()).length).toBe(before);
            // Only this run's own records (its completion and inventory) are new on Drive.
            expect(fakes.drive.uploadsCompleted - uploads).toBeLessThanOrEqual(2);
            expect(new Set(driveKeys(await driveTree(h, fakes), COMPLETION_KEY).map((key) => key.split("/").pop()!.slice(0, 12))).size).toBe((await readCompletions(h.archive)).length);
        });
    });
});

describe("record publication integrity (BJJ-456 U5-F1), phase with a stubbed Drive", () => {
    let rig: PhaseRig;
    afterEach(async () => { await rig.cleanup(); });
    const refuse503 = { ok: false, failure: { kind: "http", httpStatus: 503, reason: null, retryAfterSeconds: null } };

    it("should not publish a pending manifest after a rebind until every artifact it names is verified on the current revision", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        const oldRevision = `drive-layout-v1:${rigUuid(4)}`;
        rig.knowArtifact(doc);
        rig.setEntry(doc, "drive:rootFolder001", oldRevision, "verified");
        rig.host.stagedUsable = async () => false;
        await writeOutbox(rig.dir, doc.manifest.bytes);
        rig.state().driveRecordsPending.set(driveStateKey(oldRevision, doc.manifestKey), doc.manifest.sha256);

        await rig.phase.processWork([]);
        await rig.phase.publishRecords();

        expect(rig.recordUploads.map((upload) => upload.key)).toEqual([]);
        expect(rig.artifactUploads).toEqual([]);

        rig.setEntry(doc, rig.driveIdentity, rig.revision, "verified");
        await rig.phase.publishRecords();

        expect(rig.recordUploads.map((upload) => upload.key)).toEqual([doc.manifestKey]);
        expect(rig.recordUploads[0]!.bytes.equals(Buffer.from(doc.manifest.bytes))).toBe(true);
    });

    it("should withhold a Drive-only completion while a manifest it names is refused, queue its original bytes, and publish them next run after the manifest", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        rig.knowArtifact(doc);
        rig.setEntry(doc, rig.driveIdentity, rig.revision, "verified");
        rig.host.completionContext = rig.completionContext;
        const publish = rig.destination.publishJson;
        rig.destination.publishJson = async (key: string, bytes: Uint8Array, nodes: unknown) => (key === doc.manifestKey ? refuse503 : publish(key, bytes, nodes));

        await rig.phase.processWork([doc.candidate]);
        await rig.phase.publishRecords();

        expect(rig.recordUploads.filter((upload) => upload.key.includes("/completions/"))).toEqual([]);
        const pending = rig.ledgerRecords.filter((record) => record.type === "drive_record_pending" && String(record.body.relativeKey).includes("/completions/"));
        expect(pending).toHaveLength(1);
        const queued = (await readOutbox(rig.dir, pending[0]!.body.sha256 as string))!;
        expect(JSON.parse(queued.toString("utf8")).entries.map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001"]);

        rig.destination.publishJson = publish;
        rig.host.completionContext = () => null;
        const next = rig.newPhase();
        await next.processWork([]);
        await next.publishRecords();

        const keys = rig.recordUploads.map((upload) => upload.key);
        expect(keys).toEqual([doc.manifestKey, pending[0]!.body.relativeKey]);
        expect(rig.recordUploads[1]!.bytes.equals(queued)).toBe(true);
    });
});

describe("rebind completeness (BJJ-456 U5-F2), phase with a stubbed Drive", () => {
    let rig: PhaseRig;
    afterEach(async () => { await rig.cleanup(); });
    const oldRevision = `drive-layout-v1:${rigUuid(4)}`;

    it("should upload an artifact the snapshot no longer offers, from verified bytes, when the new revision lacks it, and then its manifest and completion from the archive", async () => {
        rig = await makePhaseRig();
        const doc = rigDoc("D001");
        const completion = rig.completionOf(doc);
        rig.knowArtifact(doc);
        rig.setEntry(doc, rig.state().installation.destinationIdentity, rig.state().installation.destinationRevision, "verified");
        rig.setEntry(doc, "drive:rootFolder001", oldRevision, "verified");
        rig.state().manifests.set(doc.manifestKey, { sha256: doc.manifest.sha256, at: "2026-11-02T00:00:00.000Z" });
        rig.state().completions.set(completion.relativeKey, { sha256: completion.sha256, at: "2026-11-02T00:00:00.000Z", sequence: 1 });
        rig.archiveFiles.set(doc.manifestKey, Buffer.from(doc.manifest.bytes));
        rig.archiveFiles.set(completion.relativeKey, Buffer.from(completion.bytes));

        await rig.phase.processWork([]);
        await rig.phase.publishRecords();

        expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
        expect(rig.phase.driveVerified(doc.job.artifactIdentity)).toBe(true);
        expect(rig.recordUploads.map((upload) => upload.key)).toEqual([doc.manifestKey, completion.relativeKey]);
    });

    // BJJ-456 U8-F1 (F2): `recover` records an artifact the archive holds with no length (`byteLength: null`); after `drive-setup --rebind`
    // the Drive phase must still upload it, from the archive bytes whose hash matches the ledger's, never skip it.
    describe("a recovered artifact (ledger length unknown) that the snapshot no longer offers (BJJ-456 U8-F1)", () => {
        const recoveredRig = async (): Promise<{ doc: ReturnType<typeof rigDoc>; sent: Buffer[] }> => {
            rig = await makePhaseRig();
            const doc = rigDoc("D001");
            rig.knowArtifact(doc);
            rig.state().artifacts.set(doc.job.artifactIdentity, { documentId: doc.documentId, artifactType: doc.job.artifactType, sha256: doc.job.sha256, byteLength: null });
            rig.setEntry(doc, rig.state().installation.destinationIdentity, rig.state().installation.destinationRevision, "verified");
            const sent: Buffer[] = [];
            const upload = rig.destination.uploadArtifact;
            rig.destination.uploadArtifact = async (input: unknown, parent: unknown, nodes: unknown, open: (offset: number) => AsyncIterable<Uint8Array>) => {
                const chunks: Buffer[] = [];
                for await (const chunk of open(0)) chunks.push(Buffer.from(chunk));
                sent.push(Buffer.concat(chunks));
                return upload(input, parent, nodes, open);
            };
            return { doc, sent };
        };

        it("should upload it once, with the archive's verified bytes, when the new Drive revision lacks it", async () => {
            const { doc, sent } = await recoveredRig();
            rig.archiveFiles.set(doc.job.relativeKey, Buffer.from(doc.pdf));

            await rig.phase.processWork([]);

            expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
            expect(sent).toHaveLength(1);
            expect(sha256Of(sent[0]!)).toBe(doc.job.sha256);
            expect(rig.phase.driveVerified(doc.job.artifactIdentity)).toBe(true);
        });

        // U8-F2: the length is resolved in one place for every Drive path; a first transient failure must not strand the artifact.
        const driveEntry = (doc: ReturnType<typeof rigDoc>): { state: string; nextRetryAt: string | null } =>
            rig.state().destinations.get(destinationKey(doc.job.artifactIdentity, rig.driveIdentity, rig.revision));

        it("should upload it on the next run after a transient failure (retry_wait, null length) once the retry time has passed, exactly once", async () => {
            const { doc, sent } = await recoveredRig();
            rig.archiveFiles.set(doc.job.relativeKey, Buffer.from(doc.pdf));
            const upload = rig.destination.uploadArtifact;
            let attempts = 0;
            rig.destination.uploadArtifact = async (...args: unknown[]) => {
                attempts += 1;
                if (attempts === 1) return { ok: false, failure: { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null } };
                return (upload as (...a: unknown[]) => unknown)(...args);
            };

            await rig.phase.processWork([]);
            expect(driveEntry(doc).state).toBe("retry_wait");
            expect(rig.state().artifacts.get(doc.job.artifactIdentity).byteLength).toBeNull();

            const retryAt = Date.parse(driveEntry(doc).nextRetryAt!);
            rig.deps.clock.now = () => new Date(retryAt + 1000);
            const next = rig.newPhase();
            await next.recoverInterrupted();
            await next.processWork([]);

            expect(attempts).toBe(2);
            expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
            expect(sent).toHaveLength(1); // the failed first attempt never streamed; this is the one object sent
            expect(sha256Of(sent[0]!)).toBe(doc.job.sha256);
            expect(driveEntry(doc).state).toBe("verified");
        });

        it("should not retry before the retry time even though the length is derivable (guards kept)", async () => {
            const { doc } = await recoveredRig();
            rig.archiveFiles.set(doc.job.relativeKey, Buffer.from(doc.pdf));
            let attempts = 0;
            rig.destination.uploadArtifact = async () => { attempts += 1; return { ok: false, failure: { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null } }; };

            await rig.phase.processWork([]);
            const next = rig.newPhase();
            await next.processWork([]);

            expect(attempts).toBe(1);
            expect(driveEntry(doc).state).toBe("retry_wait");
        });

        it("should take the length from a staged copy on record when it hashes to the artifact, even with the archive copy gone", async () => {
            const { doc } = await recoveredRig();
            rig.state().staged.set(doc.job.artifactIdentity, { sha256: doc.job.sha256, byteLength: doc.pdf.length, at: "2026-11-02T00:00:00.000Z" });

            await rig.phase.processWork([]);

            expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
        });

        it.each(["transferring", "verifying"])("should settle a crashed %s Drive entry of a recovered artifact by asking Drive, not by uploading again", async (state) => {
            const { doc } = await recoveredRig();
            rig.archiveFiles.set(doc.job.relativeKey, Buffer.from(doc.pdf));
            rig.setEntry(doc, rig.driveIdentity, rig.revision, state);
            rig.state().driveNodes.set(driveStateKey(rig.revision, doc.job.relativeKey), { kind: "file", fileId: "artifact00001", parentFileId: "parent000001", status: "created" });
            const asked: unknown[] = [];
            rig.destination.verifyRemote = async (_fileId: string, expected: unknown) => { asked.push(expected); return { ok: true, value: "ok" }; };

            await rig.phase.recoverInterrupted();
            await rig.phase.processWork([]);

            expect(asked).toHaveLength(1);
            expect((asked[0] as { byteLength: number }).byteLength).toBe(doc.pdf.length);
            expect(rig.artifactUploads).toEqual([]);
            expect(driveEntry(doc).state).toBe("verified");
        });

        it.each([
            ["the archive no longer has the bytes", (): Buffer | null => null],
            ["the archive bytes do not match the recorded hash", (): Buffer | null => Buffer.from("%PDF-1.4\nsomething else\n%%EOF\n")],
        ])("should not upload and not throw when %s", async (_name, bytes) => {
            const { doc, sent } = await recoveredRig();
            const content = bytes();
            if (content !== null) rig.archiveFiles.set(doc.job.relativeKey, content);

            await expect(rig.phase.processWork([])).resolves.toBeUndefined();

            expect(rig.artifactUploads).toEqual([]);
            expect(sent).toEqual([]);
            expect(rig.phase.driveVerified(doc.job.artifactIdentity)).toBe(false);
        });
    });

    it("should copy records an earlier revision published from the outbox (archive down) to the new revision, manifest before completion, with the original bytes", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        const completion = rig.completionOf(doc);
        for (const [key, bytes] of [[doc.manifestKey, doc.manifest.bytes], [completion.relativeKey, completion.bytes]] as const) {
            await writeOutbox(rig.dir, bytes);
            rig.state().driveRecords.set(driveStateKey(oldRevision, key), { sha256: hashOf(bytes), fileId: "oldRecord001" });
        }
        rig.knowArtifact(doc);

        await rig.phase.processWork([doc.candidate]);
        await rig.phase.publishRecords();

        expect(rig.recordUploads.map((upload) => upload.key)).toEqual([doc.manifestKey, completion.relativeKey]);
        expect(rig.recordUploads[1]!.bytes.equals(Buffer.from(completion.bytes))).toBe(true);
    });

    it("should not copy an outbox record whose bytes do not match what the earlier revision published", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        rig.knowArtifact(doc);
        await writeOutbox(rig.dir, doc.manifest.bytes);
        rig.state().driveRecords.set(driveStateKey(oldRevision, doc.manifestKey), { sha256: "f".repeat(64), fileId: "oldRecord001" });

        await rig.phase.processWork([doc.candidate]);
        await rig.phase.publishRecords();

        expect(rig.recordUploads.filter((upload) => upload.key === doc.manifestKey)).toHaveLength(1); // only this run's own manifest
    });
});

describe("history whose bytes are only staged (BJJ-456 PF2), phase with a stubbed Drive", () => {
    let rig: PhaseRig;
    afterEach(async () => { await rig.cleanup(); });
    const oldRevision = `drive-layout-v1:${rigUuid(4)}`;
    const AT = "2026-11-02T00:00:00.000Z";
    type Setup = { local?: "verified" | "blocked" | "none"; localReason?: string; previousDrive?: boolean; knownLength?: boolean; staged?: "on-record" | "none" | "wrong-length" };

    /** An artifact the snapshot no longer offers, the archive is down, and the ledger holds what an archive outage leaves behind. */
    const stagedHistory = (doc: RigDoc, setup: Setup = {}): void => {
        const { local = "blocked", localReason = "archive-unavailable", previousDrive = true, knownLength = true, staged = "on-record" } = setup;
        const installation = rig.state().installation;
        rig.knowArtifact(doc);
        if (!knownLength) rig.state().artifacts.set(doc.job.artifactIdentity, { documentId: doc.documentId, artifactType: doc.job.artifactType, sha256: doc.job.sha256, byteLength: null });
        if (local !== "none") {
            rig.setEntry(doc, installation.destinationIdentity, installation.destinationRevision, local);
            rig.state().destinations.get(destinationKey(doc.job.artifactIdentity, installation.destinationIdentity, installation.destinationRevision)).reasonCode = local === "blocked" ? localReason : null;
        }
        if (previousDrive) rig.setEntry(doc, "drive:rootFolder001", oldRevision, "verified");
        if (staged !== "none") {
            rig.state().staged.set(doc.job.artifactIdentity, { sha256: doc.job.sha256, byteLength: staged === "wrong-length" ? doc.pdf.length + 1 : doc.pdf.length, at: AT });
        }
    };
    const currentEntry = (doc: RigDoc): { state: string } | undefined => rig.state().destinations.get(destinationKey(doc.job.artifactIdentity, rig.driveIdentity, rig.revision));
    const queueManifest = async (doc: RigDoc): Promise<void> => {
        await writeOutbox(rig.dir, doc.manifest.bytes);
        await rig.deps.ledger.append("drive_record_pending", { destinationRevision: rig.revision, relativeKey: doc.manifestKey, sha256: doc.manifest.sha256 }, AT);
    };
    /** A phase over the same rig whose staged copy is exactly `bytes`. */
    const phaseStagedAs = (bytes: Buffer): DriveRunPhase => DriveRunPhase.forRun(
        rig.deps, rig.state().installation,
        { readArchiveFile: async () => null, openStaged: () => (async function* () { yield bytes; })(), reverify: async () => "ok" } as never,
        { path: rig.dir } as never, rig.host,
    )!;

    describe.each([
        ["known length", true],
        ["recovered, null length", false],
    ])("%s", (_name, knownLength) => {
        it.each<[string, Setup]>([
            ["its local entry is blocked (non-terminal) and an earlier Drive revision had it", { local: "blocked", previousDrive: true }],
            ["its local entry is blocked (non-terminal), no earlier Drive revision", { local: "blocked", previousDrive: false }],
            ["no local entry at all, but an earlier Drive revision had it", { local: "none", previousDrive: true }],
            ["its local entry is blocked on a transient reason and no earlier Drive revision had it", { local: "blocked", localReason: "network-timeout", previousDrive: false }],
        ])("should upload it once to the new revision from the staged bytes, then publish the manifest it was waiting for, when %s", async (_case, setup) => {
            rig = await makePhaseRig({ archiveOk: false });
            const doc = rigDoc("D001");
            stagedHistory(doc, { ...setup, knownLength });
            await queueManifest(doc);

            await rig.phase.processWork([]);

            expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
            expect(currentEntry(doc)?.state).toBe("verified");
            expect(rig.phase.driveVerified(doc.job.artifactIdentity)).toBe(true);
            // The manifest waited for the artifact and only now goes out, with the bytes the outbox kept.
            expect(rig.recordUploads).toEqual([]);
            await rig.phase.publishRecords();
            expect(rig.recordUploads.map((upload) => upload.key)).toEqual([doc.manifestKey]);
            expect(rig.recordUploads[0]!.bytes.equals(Buffer.from(doc.manifest.bytes))).toBe(true);
            expect(rig.state().driveRecords.get(driveStateKey(rig.revision, doc.manifestKey))?.sha256).toBe(doc.manifest.sha256);
            expect(rig.state().driveRecordsPending.has(driveStateKey(rig.revision, doc.manifestKey))).toBe(false);
            // The earlier revision's verified entry is neither reused nor changed.
            expect(rig.state().destinations.get(destinationKey(doc.job.artifactIdentity, "drive:rootFolder001", oldRevision))?.state).toBe(setup.previousDrive ? "verified" : undefined);
        });

        it("should keep the manifest pending while the artifact is not verified on the new revision", async () => {
            rig = await makePhaseRig({ archiveOk: false });
            const doc = rigDoc("D001");
            stagedHistory(doc, { knownLength });
            await queueManifest(doc);

            await rig.phase.publishRecords();

            expect(rig.recordUploads).toEqual([]);
            expect(rig.state().driveRecordsPending.has(driveStateKey(rig.revision, doc.manifestKey))).toBe(true);
        });

        it.each<[string, Setup]>([
            ["no staged copy is on record", { staged: "none" }],
            ["the staged record names another length", { staged: "wrong-length" }],
            ["its local entry is terminal and no earlier Drive revision had it", { local: "blocked", localReason: "exact-bytes-unavailable", previousDrive: false }],
            ["there is neither a local entry nor an earlier Drive revision", { local: "none", previousDrive: false }],
        ])("should select nothing when %s", async (_case, setup) => {
            rig = await makePhaseRig({ archiveOk: false });
            const doc = rigDoc("D001");
            stagedHistory(doc, { ...setup, knownLength });

            await expect(rig.phase.processWork([])).resolves.toBeUndefined();

            expect(rig.artifactUploads).toEqual([]);
            expect(currentEntry(doc)).toBeUndefined();
        });

        it.each([["not halted", false], ["halted by an earlier artifact", true]])("should make no upload, no entry and no crash when the staged bytes are missing or corrupt and the archive is unavailable (%s)", async (_label, halted) => {
            rig = await makePhaseRig({ archiveOk: false });
            const doc = rigDoc("D001");
            stagedHistory(doc, { knownLength });
            let setAside = 0;
            rig.host.setStagingAside = async (job: { artifactIdentity: string }) => { if (job.artifactIdentity === doc.job.artifactIdentity) setAside += 1; };
            let phase: DriveRunPhase = rig.phase;
            let snapshot: Array<RigDoc["candidate"]> = [];
            if (halted) {
                const other = rigDoc("D002");
                rig.knowArtifact(other);
                snapshot = [other.candidate];
                rig.destination.uploadArtifact = async () => ({ ok: false, failure: { kind: "http", httpStatus: 403, reason: "forbidden", retryAfterSeconds: null } });
            }

            for (const variant of ["missing", "corrupt"] as const) {
                if (variant === "missing") rig.host.stagedUsable = async (job: { artifactIdentity: string }) => job.artifactIdentity !== doc.job.artifactIdentity;
                else {
                    rig.host.stagedUsable = async () => true;
                    phase = phaseStagedAs(Buffer.from("%PDF-1.4\nnot the artifact\n%%EOF\n"));
                }
                await expect(phase.processWork(snapshot)).resolves.toBeUndefined();
                expect(rig.artifactUploads).toEqual([]);
                expect(currentEntry(doc)).toBeUndefined();
                expect(setAside).toBe(0); // a corrupt staged copy found at discovery is left exactly as it is
            }
            if (halted) expect(rig.state().destinations.get(destinationKey(rigDoc("D002").job.artifactIdentity, rig.driveIdentity, rig.revision))?.state).toBe("blocked");
        });
    });

    it("should upload a locally verified history artifact exactly once, even though it also has staged bytes and an earlier Drive revision", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        stagedHistory(doc, { local: "verified", previousDrive: true });

        await rig.phase.processWork([]);
        await rig.phase.processWork([]);

        expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
        expect(currentEntry(doc)?.state).toBe("verified");
    });

    it("should still upload a locally verified artifact with no staged copy from the archive, as before", async () => {
        rig = await makePhaseRig();
        const doc = rigDoc("D001");
        stagedHistory(doc, { local: "verified", previousDrive: false, staged: "none" });
        rig.archiveFiles.set(doc.job.relativeKey, Buffer.from(doc.pdf));
        let usable = false;
        rig.host.stagedUsable = async () => usable;
        rig.host.restage = async () => { usable = true; return { ok: true }; };

        await rig.phase.processWork([]);

        expect(rig.artifactUploads).toEqual([doc.job.relativeKey]);
    });
});

describe("control readiness and outbox durability (BJJ-456 U5-F3), phase with a stubbed Drive", () => {
    let rig: PhaseRig;
    afterEach(async () => { await rig.cleanup(); });

    it("should make no Drive request once the control directory has fallen below the ledger's reserve, whichever Drive operation comes first", async () => {
        rig = await makePhaseRig();
        const doc = rigDoc("D001");
        rig.knowArtifact(doc);
        await assertLedgerRoom(rig.deps); // the run's preflight passed; the space then went during the local phase
        rig.controlFree.bytes = 10 * MIB;

        await expect(rig.phase.processWork([doc.candidate])).rejects.toMatchObject({ reasonCode: "control-space" });
        expect(rig.calls).toEqual([]);
    });

    it("should check control space before the recovery of an interrupted entry and before a record upload", async () => {
        rig = await makePhaseRig();
        const doc = rigDoc("D001");
        rig.knowArtifact(doc);
        rig.setEntry(doc, rig.driveIdentity, rig.revision, "transferring");
        rig.state().driveNodes.set(driveStateKey(rig.revision, doc.job.relativeKey), { kind: "file", fileId: "artifact00001", parentFileId: "parent000001", status: "created" });
        rig.controlFree.bytes = 10 * MIB;

        await expect(rig.phase.recoverInterrupted()).rejects.toMatchObject({ reasonCode: "control-space" });
        expect(rig.calls).toEqual([]);

        rig.state().driveRecordsPending.set(driveStateKey(rig.revision, doc.manifestKey), doc.manifest.sha256);
        rig.setEntry(doc, rig.driveIdentity, rig.revision, "verified");
        await writeOutbox(rig.dir, doc.manifest.bytes);
        await expect(rig.newPhase().publishRecords()).rejects.toMatchObject({ reasonCode: "control-space" });
        expect(rig.calls).toEqual([]);
    });

    it("should sync the control directory, which holds the new outbox directory's entry, before the first record is queued in the ledger", async () => {
        rig = await makePhaseRig({ archiveOk: false });
        const doc = rigDoc("D001");
        rig.knowArtifact(doc);
        rig.setEntry(doc, rig.driveIdentity, rig.revision, "verified");
        rig.host.completionContext = rig.completionContext;
        const events: string[] = [];
        const append = rig.deps.ledger.append;
        rig.deps.ledger.append = async (type: string, body: unknown, at: string) => { events.push(`append:${type}`); await append(type, body, at); };
        const originalOpen = fs.open;
        (fs as { open: unknown }).open = async function (target: string, ...args: unknown[]) {
            const handle = await (originalOpen as (...a: unknown[]) => Promise<{ sync: () => Promise<void> }>).call(this, target, ...args);
            const sync = handle.sync.bind(handle);
            handle.sync = async () => { events.push(`sync:${path.relative(rig.dir, target) || "."}`); return sync(); };
            return handle;
        };
        try {
            await rig.phase.processWork([doc.candidate]);
            await rig.phase.publishRecords();
        } finally {
            (fs as { open: unknown }).open = originalOpen;
        }

        const firstPending = events.indexOf("append:drive_record_pending");
        expect(firstPending).toBeGreaterThan(-1);
        expect(events.slice(0, firstPending)).toContain("sync:.");
        expect(events.slice(0, firstPending)).toContain("sync:drive-outbox");
    });
});
