import { promises as fs } from "node:fs";
import path from "node:path";

import type { DestinationState, WorkerReasonCode } from "domain/eformsign-backup/worker";
import { runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { DestinationLedger, controlMarkerWriter, ledgerDriveNodes } from "infrastructure/eformsign-backup/worker/runner-common";
import { RUNNER_FAULT_POINTS, ZERO_COUNTS, type RunnerDependencies } from "infrastructure/eformsign-backup/worker/runner-types";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { driveFaults, type FakeNode } from "./helpers/fake-drive-server";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
import {
    ARCHIVE_ID, createHarness, destroyHarness, environmentFor, initArchive, readLedgerRecords, treeContains,
    type Harness,
} from "./helpers/runner-support";

interface Captured { code: number; stdout: string[]; stderr: string[] }

const ROOT_NAME = "bjj-eformsign-backup";
const MARKER_KEY = ".bjj-backup/installation.json";

describe("drive-setup (BJJ-456 U4): durable, resumable, idempotent binding of the Drive root", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => {
        fakes = await startDriveFakes();
        h = await createHarness({ docs: [], config: { drive: fakes.config } as never });
        await initArchive(h);
    });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    async function cli(args: string[]): Promise<Captured> {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const code = await runWorkerCli(args, environmentFor(h, { out: (line) => stdout.push(line), err: (line) => stderr.push(line) }));
        return { code, stdout, stderr };
    }
    const setup = (...flags: string[]): Promise<Captured> => cli(["drive-setup", "--config", h.configPath, ...flags]);
    const lines = (captured: Captured): Array<Record<string, unknown>> => captured.stdout.map((line) => JSON.parse(line));
    const roots = (): FakeNode[] => fakes.drive.nodes().filter((node) => node.name === ROOT_NAME && node.parents.includes(fakes.drive.myDriveId));
    const records = async (type: string) => (await readLedgerRecords(h.control)).filter((record) => record.type === type);
    const typesNow = async (): Promise<string[]> => (await readLedgerRecords(h.control)).map((record) => record.type);

    it("should create exactly one root and publish the archive marker, bind it in the ledger and print one drive_bound line", async () => {
        const result = await setup();

        expect(result).toMatchObject({ code: 0, stderr: [] });
        expect(roots()).toHaveLength(1);
        const root = roots()[0]!;
        const [line] = lines(result);
        expect(lines(result)).toHaveLength(1);
        expect(line).toEqual({ event: "drive_bound", rootFolderId: root.id, destinationRevision: expect.stringMatching(/^drive-layout-v1:[0-9a-f-]{36}$/) });

        // The binding is in the ledger, pending first, then ready, with the marker published in between.
        const bound = (await records("drive_bound"))[0]!.body;
        expect(bound).toMatchObject({
            destinationIdentity: `drive:${root.id}`, destinationRevision: line!["destinationRevision"], rootFolderId: root.id,
            rootName: ROOT_NAME, rootParentId: fakes.drive.myDriveId, accountId: fakes.drive.permissionId,
        });
        expect(root.appProperties).toMatchObject({ bjjBindingId: bound["bindingId"] });
        const order = (await typesNow()).filter((type) => type.startsWith("drive_"));
        expect(order.indexOf("drive_bound")).toBeLessThan(order.indexOf("drive_record_published"));
        expect(order.indexOf("drive_record_published")).toBeLessThan(order.indexOf("drive_ready"));
        expect(order.filter((type) => type === "drive_bound" || type === "drive_ready")).toHaveLength(2);

        // The marker on Drive is the local marker, byte for byte, at the same relative key, under the root.
        const localMarker = await fs.readFile(path.join(h.archive, MARKER_KEY));
        const folder = fakes.drive.children(root.id).find((node) => node.name === ".bjj-backup")!;
        const file = fakes.drive.children(folder.id).find((node) => node.name === "installation.json")!;
        expect(fakes.drive.bytesOf(file.id)!.equals(localMarker)).toBe(true);
        expect((await records("drive_record_published"))[0]!.body).toMatchObject({
            destinationRevision: bound["destinationRevision"], relativeKey: MARKER_KEY, fileId: file.id,
        });
        // Root + folder + marker file: nothing else was created.
        expect(fakes.drive.creates).toBe(3);
    });

    it("should be a no-op when the binding is ready and the root is intact: no create, no ledger record, same line", async () => {
        const first = await setup();
        const creates = fakes.drive.creates;
        const before = await readLedgerRecords(h.control);

        const second = await setup();

        expect(second).toMatchObject({ code: 0, stderr: [] });
        expect(lines(second)).toEqual(lines(first));
        expect(fakes.drive.creates).toBe(creates);
        expect(roots()).toHaveLength(1);
        expect((await readLedgerRecords(h.control)).length).toBe(before.length);
        expect(fakes.drive.requests.filter((request) => request.method === "POST")).toHaveLength(3);
    });

    it.each([
        ["renamed", (root: FakeNode) => fakes.drive.rename(root.id, "someone-renamed-this")],
        ["trashed", (root: FakeNode) => fakes.drive.trash(root.id)],
        ["moved", (root: FakeNode) => {
            fakes.drive.seed({ id: "ElsewhereFolder0001", name: "elsewhere" });
            fakes.drive.move(root.id, "ElsewhereFolder0001");
        }],
        ["rebranded with a foreign binding id", (root: FakeNode) => { root.appProperties = { ...root.appProperties, bjjBindingId: "00000000-0000-4000-8000-0000000000ff" }; }],
    ])("should refuse with drive-root-changed (69) when the root was %s, creating and recording nothing", async (_name, damage) => {
        await setup();
        damage(roots()[0] ?? fakes.drive.nodes().find((node) => node.appProperties["bjjBindingId"] !== undefined)!);
        const creates = fakes.drive.creates;
        const before = (await readLedgerRecords(h.control)).length;

        const result = await setup();

        expect(result).toMatchObject({ code: 69, stdout: [], stderr: ["drive-root-changed"] });
        expect(fakes.drive.creates).toBe(creates);
        expect((await readLedgerRecords(h.control)).length).toBe(before);
    });

    it("should bind a new root under a new revision with --rebind, leave the old root untouched, and then be a no-op again", async () => {
        const first = lines(await setup())[0]!;
        const oldRoot = roots()[0]!;
        fakes.drive.rename(oldRoot.id, "renamed-by-someone");
        const oldChildren = fakes.drive.children(oldRoot.id).map((node) => node.id);

        const rebound = await setup("--rebind");

        expect(rebound).toMatchObject({ code: 0, stderr: [] });
        const second = lines(rebound)[0]!;
        expect(second["rootFolderId"]).not.toBe(first["rootFolderId"]);
        expect(second["destinationRevision"]).not.toBe(first["destinationRevision"]);
        expect(roots()).toHaveLength(1);
        expect(roots()[0]!.id).toBe(second["rootFolderId"]);
        expect(fakes.drive.node(oldRoot.id)!.name).toBe("renamed-by-someone");
        expect(fakes.drive.children(oldRoot.id).map((node) => node.id)).toEqual(oldChildren);
        expect((await records("drive_bound")).map((record) => record.body["destinationRevision"])).toEqual([first["destinationRevision"], second["destinationRevision"]]);
        expect(await records("drive_ready")).toHaveLength(2);
        // The marker was published again for the new revision.
        expect((await records("drive_record_published")).map((record) => record.body["destinationRevision"]))
            .toEqual([first["destinationRevision"], second["destinationRevision"]]);
        const marker = await fs.readFile(path.join(h.archive, MARKER_KEY));
        const folder = fakes.drive.children(roots()[0]!.id).find((node) => node.name === ".bjj-backup")!;
        expect(fakes.drive.bytesOf(fakes.drive.children(folder.id)[0]!.id)!.equals(marker)).toBe(true);

        const creates = fakes.drive.creates;
        const again = await setup();
        expect(lines(again)).toEqual(lines(rebound));
        expect(fakes.drive.creates).toBe(creates);
    });

    it("should treat --rebind without any binding as the first setup", async () => {
        const result = await setup("--rebind");
        expect(result).toMatchObject({ code: 0, stderr: [] });
        expect(roots()).toHaveLength(1);
        expect(await records("drive_bound")).toHaveLength(1);
    });

    it("should exit 78 with drive-token-invalid when the refresh token is revoked, before any create or ledger record", async () => {
        fakes.drive.revokeAccess();

        const result = await setup();

        expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["drive-token-invalid"] });
        expect(fakes.drive.creates).toBe(0);
        expect(await records("drive_bound")).toHaveLength(0);
    });

    it("should exit 78 with drive-token-invalid when the token is revoked after the binding is ready", async () => {
        await setup();
        fakes.drive.revokeAccess();
        const before = (await readLedgerRecords(h.control)).length;

        const result = await setup();

        expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["drive-token-invalid"] });
        expect((await readLedgerRecords(h.control)).length).toBe(before);
    });

    it.each([
        ["a 503", driveFaults.status(503), 69, "drive-unavailable"],
        ["a 403 without quota", driveFaults.status(403, "forbidden"), 69, "drive-permission"],
        ["a 403 storageQuotaExceeded", driveFaults.status(403, "storageQuotaExceeded"), 69, "drive-quota"],
        ["a 429", driveFaults.status(429, undefined, 5), 70, "rate-limited"],
    ])("should end drive-setup on %s with exit %i and the reason code only", async (_name, action, code, reason) => {
        const fault = fakes.drive.addFault({ route: "get", action });
        const result = await setup();
        fakes.drive.clearFaults();
        expect(fault.hits).toBeGreaterThan(0);
        expect(result).toMatchObject({ code, stdout: [], stderr: [reason] });
        expect(fakes.drive.creates).toBe(0);
        // Recovery: the same command succeeds once Drive is back.
        expect((await setup()).code).toBe(0);
        expect(roots()).toHaveLength(1);
    });

    it("should still end with one root when the answer to the root create is lost", async () => {
        const fault = fakes.drive.addFault({ route: "create", times: 1, action: driveFaults.lostResponse() });

        const result = await setup();

        expect(fault.hits).toBe(1);
        expect(result).toMatchObject({ code: 0, stderr: [] });
        expect(roots()).toHaveLength(1);
        expect(fakes.drive.creates).toBe(3);
        expect(lines(result)[0]!["rootFolderId"]).toBe(roots()[0]!.id);
        expect(await records("drive_ready")).toHaveLength(1);
    });

    it("should refuse with not-initialized (69) and touch nothing when there is no installation", async () => {
        await destroyHarness(h);
        h = await createHarness({ docs: [], config: { drive: fakes.config } as never });

        expect(await setup()).toMatchObject({ code: 69, stdout: [], stderr: ["not-initialized"] });
        expect(fakes.drive.requests).toHaveLength(0);
        expect(fakes.oauth.tokenRequests).toBe(0);
    });

    it("should exit 69 with archive-unavailable and leave Drive and the ledger untouched when the archive marker cannot be read", async () => {
        await fs.rm(path.join(h.archive, MARKER_KEY));

        const result = await setup();

        expect(result).toMatchObject({ code: 69, stdout: [], stderr: ["archive-unavailable"] });
        expect(fakes.drive.creates).toBe(0);
        expect(await records("drive_bound")).toHaveLength(0);
    });

    it("should resume with the same root id after a kill between drive_bound and the root create, then end ready with one root", async () => {
        const child = spawnUnderFlock(h, ["drive-setup", "--config", h.configPath, "--kill-at", "drive-setup-after-bound"]);
        expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
        const killed = await readLedgerRecords(h.control);
        expect(killed.map((record) => record.type)).toContain("drive_bound");
        expect(killed.map((record) => record.type)).not.toContain("drive_ready");
        expect(fakes.drive.creates).toBe(0);
        const bound = killed.find((record) => record.type === "drive_bound")!.body;

        h.clock.set(new Date(Date.now() + 60_000).toISOString());
        const result = await setup();

        expect(result).toMatchObject({ code: 0, stderr: [] });
        expect(lines(result)[0]).toMatchObject({ rootFolderId: bound["rootFolderId"], destinationRevision: bound["destinationRevision"] });
        expect(roots()).toHaveLength(1);
        expect(roots()[0]!.id).toBe(bound["rootFolderId"]);
        expect(await records("drive_bound")).toHaveLength(1);
        expect(await records("drive_ready")).toHaveLength(1);
        expect(fakes.drive.creates).toBe(3);
    }, 180_000);

    it("should resume with the same root id after a kill between the root create and the marker, creating no second root", async () => {
        const child = spawnUnderFlock(h, ["drive-setup", "--config", h.configPath, "--kill-at", "drive-setup-after-root"]);
        expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
        const killed = await readLedgerRecords(h.control);
        const bound = killed.find((record) => record.type === "drive_bound")!.body;
        expect(killed.map((record) => record.type)).not.toContain("drive_ready");
        expect(roots()).toHaveLength(1);
        expect(roots()[0]!.id).toBe(bound["rootFolderId"]);
        expect(fakes.drive.creates).toBe(1);

        h.clock.set(new Date(Date.now() + 60_000).toISOString());
        const result = await setup();

        expect(result).toMatchObject({ code: 0, stderr: [] });
        expect(roots()).toHaveLength(1);
        expect(roots()[0]!.id).toBe(bound["rootFolderId"]);
        expect(await records("drive_bound")).toHaveLength(1);
        expect(await records("drive_ready")).toHaveLength(1);
        expect(fakes.drive.creates).toBe(3);
        const folder = fakes.drive.children(roots()[0]!.id).find((node) => node.name === ".bjj-backup")!;
        expect(fakes.drive.bytesOf(fakes.drive.children(folder.id)[0]!.id)!.equals(await fs.readFile(path.join(h.archive, MARKER_KEY)))).toBe(true);
    }, 180_000);

    it("should show the Drive binding and counts in inspect, and leave inspect unchanged without a binding", async () => {
        const before = lines(await cli(["inspect", "--config", h.configPath]))[0]!;
        expect(Object.keys(before["counts"] as object).some((key) => key.startsWith("drive"))).toBe(false);

        await setup();
        const after = lines(await cli(["inspect", "--config", h.configPath]))[0]!;

        expect(after["counts"]).toMatchObject({
            ...(before["counts"] as object), driveBound: 1, driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0, stagingReleasable: 0,
        });
    });

    it("should count Drive results of the CURRENT revision only, keep them out of the local counts, and report stagingReleasable", async () => {
        const bound = lines(await setup())[0]!;
        const local = { identity: `local:${ARCHIVE_ID}`, revision: "local-layout-v1" };
        const drive = { identity: `drive:${bound["rootFolderId"] as string}`, revision: bound["destinationRevision"] as string };
        const art = (n: number): string => n.toString(16).padStart(64, "0");
        const reasons: Partial<Record<DestinationState, WorkerReasonCode>> = { blocked: "drive-permission", retry_wait: "rate-limited", integrity_error: "artifact-integrity" };
        let tick = 0;

        const seed = async (): Promise<void> => {
            const ledger = await LedgerStore.open(h.control, { writeMarker: controlMarkerWriter });
            type Edge = [DestinationState | null, DestinationState];
            const toVerifying: Edge[] = [[null, "pending"], ["pending", "transferring"], ["transferring", "verifying"]];
            const chains: Record<"verified" | "integrity_error" | "blocked" | "retry_wait", Edge[]> = {
                verified: [...toVerifying, ["verifying", "verified"]],
                integrity_error: [...toVerifying, ["verifying", "integrity_error"]],
                blocked: [[null, "pending"], ["pending", "blocked"]],
                retry_wait: [[null, "pending"], ["pending", "transferring"], ["transferring", "retry_wait"]],
            };
            const walk = async (to: keyof typeof chains, artifactIdentity: string, where: { identity: string; revision: string }): Promise<void> => {
                for (const [from, next] of chains[to]) {
                    tick += 1;
                    await ledger.append("destination_transition", {
                        artifactIdentity, destinationIdentity: where.identity, destinationRevision: where.revision, from, to: next,
                        reasonCode: reasons[next] ?? null, attempts: 1,
                        nextRetryAt: next === "retry_wait" ? "2030-01-01T00:00:00.000Z" : null, relativeKey: null,
                    }, new Date(Date.UTC(2030, 0, 1, 0, 0, tick)).toISOString());
                }
            };
            try {
                for (const n of [1, 2, 3, 4]) await walk("verified", art(n), local);
                await walk("verified", art(1), drive);
                await walk("blocked", art(2), drive);
                await walk("retry_wait", art(3), drive);
                await walk("integrity_error", art(4), drive);
                await walk("verified", art(5), drive); // Drive only: not releasable
            } finally {
                await ledger.close();
            }
        };
        await seed();

        const counts = lines(await cli(["inspect", "--config", h.configPath]))[0]!["counts"] as Record<string, number>;
        expect(counts).toMatchObject({
            verified: 4, blocked: 0, retryWait: 0, integrityError: 0,
            driveBound: 1, driveVerified: 2, driveBlocked: 1, driveRetryWait: 1, driveIntegrityError: 1, stagingReleasable: 1,
        });

        // After a rebind the old revision's results belong to nobody: the new revision starts from zero.
        h.clock.set("2030-01-02T00:00:00.000Z");
        await setup("--rebind");
        const after = lines(await cli(["inspect", "--config", h.configPath]))[0]!["counts"] as Record<string, number>;
        expect(after).toMatchObject({
            verified: 4, blocked: 0, retryWait: 0, integrityError: 0,
            driveBound: 1, driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0, stagingReleasable: 0,
        });
    });

    describe("runner-common seams", () => {
        const art = "ab".repeat(32);
        async function withStore<T>(use: (deps: RunnerDependencies) => Promise<T>): Promise<T> {
            const ledger = await LedgerStore.open(h.control, { writeMarker: controlMarkerWriter });
            try {
                return await use({ ledger, clock: h.clock } as unknown as RunnerDependencies);
            } finally {
                await ledger.close();
            }
        }

        it("should write destination transitions for the explicit binding, and for the installation's local one by default", async () => {
            const bound = lines(await setup())[0]!;
            const driveIdentity = `drive:${bound["rootFolderId"] as string}`;
            await withStore(async (deps) => {
                const installation = deps.ledger.state.installation!;
                const local = new DestinationLedger(deps, installation);
                const drive = new DestinationLedger(deps, installation, { destinationIdentity: driveIdentity, destinationRevision: bound["destinationRevision"] as string });
                expect([local.destinationIdentity, local.destinationRevision]).toEqual([`local:${ARCHIVE_ID}`, "local-layout-v1"]);
                expect([drive.destinationIdentity, drive.destinationRevision]).toEqual([driveIdentity, bound["destinationRevision"]]);

                await drive.transition(art, "pending");
                expect(drive.entryOf(art)).toMatchObject({ destinationIdentity: driveIdentity, state: "pending" });
                expect(local.entryOf(art)).toBeUndefined();
                await local.transition(art, "pending");
                expect(local.entryOf(art)).toMatchObject({ destinationIdentity: `local:${ARCHIVE_ID}`, state: "pending" });
            });
            const transitions = (await records("destination_transition")).map((record) => record.body["destinationIdentity"]);
            expect(transitions).toEqual([driveIdentity, `local:${ARCHIVE_ID}`]);
        });

        it("should keep Drive nodes in the ledger: reserve, then created, per revision, durable across a reopen", async () => {
            const bound = lines(await setup())[0]!;
            const revision = bound["destinationRevision"] as string;
            const folderId = "NodeFolderId000001";
            const parentId = bound["rootFolderId"] as string;
            await withStore(async (deps) => {
                const nodes = ledgerDriveNodes(deps, revision);
                expect(nodes.current("eformsign")).toBeNull();
                await nodes.reserve("folder", "eformsign", folderId, parentId);
                expect(nodes.current("eformsign")).toEqual({ kind: "folder", fileId: folderId, parentFileId: parentId, status: "reserved" });
                await nodes.created("eformsign", folderId);
                expect(nodes.current("eformsign")).toMatchObject({ status: "created" });
                // Another revision has its own map.
                expect(ledgerDriveNodes(deps, "drive-layout-v1:00000000-0000-4000-8000-0000000000aa").current("eformsign")).toBeNull();
            });
            await withStore(async (deps) => {
                expect(ledgerDriveNodes(deps, revision).current("eformsign")).toMatchObject({ fileId: folderId, status: "created" });
            });
            const recordsNow = await readLedgerRecords(h.control);
            expect(recordsNow.filter((record) => record.body["nodeKey"] === "eformsign").map((record) => record.type)).toEqual(["drive_node_reserved", "drive_node_created"]);
        });

        it("should refuse to reserve a Drive node for a revision that is not the current binding's", async () => {
            await setup();
            await withStore(async (deps) => {
                const stale = ledgerDriveNodes(deps, "drive-layout-v1:00000000-0000-4000-8000-0000000000aa");
                await expect(stale.reserve("folder", "eformsign", "NodeFolderId000002", "ParentFolderId0001")).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
            });
        });
    });

    it("should list the Drive fault points and zero Drive counts for the later units", () => {
        expect(RUNNER_FAULT_POINTS).toEqual(expect.arrayContaining([
            "drive-setup-after-bound", "drive-setup-after-root", "drive-after-reserved-before-create", "drive-after-upload-before-verifying",
            "drive-after-verified", "drive-recover-after-first",
        ]));
        expect(ZERO_COUNTS).toMatchObject({ driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 });
    });

    it("should never print or store the client secret, the refresh token or an access token", async () => {
        const secrets = [fakes.oauth.refreshToken, fakes.oauth.clientSecret];
        const ok = await setup();
        fakes.drive.revokeAccess();
        const failed = await setup();
        for (const needle of secrets) {
            expect([...ok.stdout, ...ok.stderr, ...failed.stdout, ...failed.stderr].join("\n")).not.toContain(needle);
            expect(await treeContains(h.control, needle)).toBe(false);
            expect(await treeContains(h.archive, needle)).toBe(false);
        }
        expect([...ok.stdout, ...ok.stderr, ...failed.stdout, ...failed.stderr].join("\n")).not.toMatch(/Bearer|access_token/);
    });
});
