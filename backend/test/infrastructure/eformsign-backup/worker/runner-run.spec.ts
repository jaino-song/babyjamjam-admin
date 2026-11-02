import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError, bundleIdFor, buildCompletion, buildManifest, manifestKey } from "domain/eformsign-backup/worker";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";
import * as restoreModule from "infrastructure/eformsign-backup/worker/restore";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";

import type { FixtureDoc } from "./helpers/fake-export-api";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
import {
    COMPANY, TOKEN, archivePdfs, createHarness, destinationStates, destroyHarness, identityFor, initArchive, listFiles,
    pairDoc, pdfOf, readCompletions, readJsonFile, readLedgerRecords, recordTypes, runOnce, singleDoc, transitionPath, treeContains,
    tryRun, withWorker, type Harness,
} from "./helpers/runner-support";

/** Same pattern as runner-matrix.spec.ts: the archive directory is replaced by an empty one, the real one is kept aside. */
async function swapArchive(h: Harness): Promise<string> {
    const away = `${h.archive}.away`;
    await fs.rename(h.archive, away);
    await fs.mkdir(h.archive, { mode: 0o700 });
    return away;
}
async function swapBack(h: Harness, away: string): Promise<void> {
    await fs.rename(h.archive, `${h.archive}.new`);
    await fs.rename(away, h.archive);
}

const mix = (): FixtureDoc[] => [
    pairDoc("D001"), pairDoc("D002"), singleDoc("D004"),
    { documentId: "D005", classification: "unknown_template", documentKind: null },
    { documentId: "D006", classification: "excluded_by_policy", statusType: "060" },
];

describe("WorkerRunner.run (fake export server, synthetic archive)", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });

    describe("normal flow (contract section 3)", () => {
        it("should publish every artifact, one manifest per document, one completion and a run inventory", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);

            const summary = await runOnce(h);

            expect(summary).toMatchObject({
                outcome: "finished", snapshotStatus: "partial", historicalCoverage: "unverified", sequence: 1,
                counts: { candidates: 5, included: 3, verified: 5, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 },
            });
            expect(summary.reasonCodes).toEqual(["coverage-unverified", "drive-not-configured"]);
            expect(await archivePdfs(h.archive)).toHaveLength(5);
            const files = await listFiles(h.archive);
            expect(files.filter((file) => file.includes("/manifests/"))).toHaveLength(3);
            expect(files.filter((file) => file.includes("/completions/"))).toHaveLength(1);
            expect(files.filter((file) => file.includes("/runs/"))).toEqual([`eformsign/${COMPANY}/runs/${summary.runId}.json`]);
            const states = await destinationStates(h.control);
            expect(Object.keys(states)).toHaveLength(5);
            expect(Object.values(states).every((state) => state === "verified")).toBe(true);
            expect(h.api.artifactRequests()).toHaveLength(5);

            const records = await readLedgerRecords(h.control);
            const types = recordTypes(records);
            expect(types[0]).toBe("installed");
            expect(types.indexOf("run_started")).toBeLessThan(types.indexOf("snapshot_bound"));
            expect(types.filter((type) => type === "candidate_observed")).toHaveLength(5);
            expect(types.filter((type) => type === "manifest_published")).toHaveLength(3);
            expect(types.filter((type) => type === "completion_published")).toHaveLength(1);
            expect(types[types.length - 1]).toBe("run_finished");
        });

        it("should reuse verified files on the next run: no new download, one more completion, same final files", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            const first = await archivePdfs(h.archive);

            const second = await runOnce(h);

            expect(h.api.artifactRequests()).toHaveLength(5);
            expect(second.sequence).toBe(2);
            expect(await archivePdfs(h.archive)).toEqual(first);
            expect((await readCompletions(h.archive)).map((entry) => entry.value["sequence"])).toEqual([1, 2]);
        });

        it("should keep the token out of the ledger and the archive", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            expect(await treeContains(h.control, TOKEN)).toBe(false);
            expect(await treeContains(h.archive, TOKEN)).toBe(false);
        });

        it("should read candidates page by page through the cursor", async () => {
            h = await createHarness({ docs: mix(), pageSize: 2 });
            await initArchive(h);
            await runOnce(h);
            const observed = (await readLedgerRecords(h.control)).filter((record) => record.type === "candidate_observed");
            expect(observed.map((record) => record.body["ordinal"])).toEqual([1, 2, 3, 4, 5]);
            expect(h.api.requests.filter((request) => request.url.includes("/candidates"))).toHaveLength(3);
        });

        it("should publish a single-artifact document with an incomplete manifest", async () => {
            h = await createHarness({ docs: [singleDoc("D004")] });
            await initArchive(h);
            await runOnce(h);
            const manifest = (await listFiles(h.archive)).find((file) => file.includes("/manifests/"))!;
            expect(await readJsonFile(path.join(h.archive, manifest))).toMatchObject({ consistency: "incomplete", bundleId: null });
        });

        it("should derive the next sequence from the archive's completion names too", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            await fs.writeFile(path.join(h.archive, "eformsign", COMPANY, "completions", `000000000007-${"a".repeat(64)}.json`), "{}", { mode: 0o600 });
            const second = await runOnce(h);
            expect(second.sequence).toBe(8);
        });

        it("should compact the ledger at run start when it is over the threshold and keep working", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            await runOnce(h, { compactionThreshold: 5 });
            expect((await fs.readdir(path.join(h.control, "ledger"))).includes("checkpoint.json")).toBe(true);
            const third = await runOnce(h);
            expect(third.counts?.verified).toBe(5);
        });
    });

    describe("T-WRK-15: repeated runs, clock and the enabled switch", () => {
        it("should keep one file per artifact over three runs, with completion sequences 1, 2, 3", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            for (let run = 0; run < 3; run++) await runOnce(h);

            expect(await archivePdfs(h.archive)).toHaveLength(5);
            const completions = await readCompletions(h.archive);
            expect(completions.map((entry) => entry.value["sequence"])).toEqual([1, 2, 3]);
            expect(new Set(completions.map((entry) => entry.name)).size).toBe(3);
            const bound = (await readLedgerRecords(h.control)).filter((record) => record.type === "snapshot_bound");
            expect(bound.map((record) => record.body["sequence"])).toEqual([1, 2, 3]);
        });

        it("should never write a timestamp earlier than the clock across a midnight boundary and a 3-day gap", async () => {
            h = await createHarness({ docs: mix() });
            h.clock.set("2026-10-19T23:59:59.900Z");
            await initArchive(h);
            await runOnce(h);
            h.clock.set("2026-10-20T00:00:00.100Z");
            await runOnce(h);
            h.clock.advance(3 * 24 * 3600 * 1000);
            const last = await runOnce(h);

            const records = await readLedgerRecords(h.control);
            const stamps = records.map((record) => Date.parse(record.at));
            expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
            const finished = records.filter((record) => record.type === "run_finished");
            expect(finished.map((record) => record.at.slice(0, 10))).toEqual(["2026-10-19", "2026-10-20", "2026-10-23"]);
            expect(last.sequence).toBe(3);
            const inventory = await readJsonFile(path.join(h.archive, "eformsign", COMPANY, "runs", `${last.runId}.json`));
            expect(inventory["startedAt"]).toBe("2026-10-23T00:00:00.100Z");
        });

        it("should only ever judge failed, blocked or partial (T22: there is no complete)", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            const statuses = (await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").map((record) => record.body["snapshotStatus"]);
            for (const status of statuses) expect(["failed", "blocked", "partial"]).toContain(status);
            const inventories = (await listFiles(h.archive)).filter((file) => file.includes("/runs/"));
            for (const file of inventories) expect((await fs.readFile(path.join(h.archive, file), "utf8"))).not.toContain("complete\"");
        });

        it("should do nothing at all when enabled is false, and pick up where it left off when turned on again", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await runOnce(h);
            const { rewriteConfig, treeSignature } = await import("./helpers/runner-support");
            await rewriteConfig(h, { enabled: false });
            const before = [await treeSignature(h.control), await treeSignature(h.archive)];
            const requests = h.api.requests.length;

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ outcome: "disabled", runId: null });
            expect(h.api.requests).toHaveLength(requests);
            expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);

            await rewriteConfig(h, { enabled: true });
            const resumed = await runOnce(h);
            expect(resumed).toMatchObject({ outcome: "finished", sequence: 2 });
            expect(await archivePdfs(h.archive)).toHaveLength(5);
        });
    });

    describe("export error actions (contract section 5)", () => {
        it("should park a 429 in retry_wait for max(retryAfter, backoff), stop downloading, and finish after the wait", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1, pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "status", status: 429, code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 120 } });
            await initArchive(h);

            const first = await runOnce(h);

            expect(h.api.artifactRequests()).toHaveLength(1);
            expect(first.reasonCodes).toContain("rate-limited");
            expect(first.counts).toMatchObject({ retryWait: 1, verified: 0 });
            const id = identityFor(h, d1, "document");
            const park = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && record.body["to"] === "retry_wait");
            expect(park).toHaveLength(1);
            expect(park[0]!.body).toMatchObject({ artifactIdentity: id, reasonCode: "rate-limited", attempts: 1, nextRetryAt: "2026-10-19T00:02:00.000Z" });
            // Nothing is complete, but the omissions are on record: a completion with no entries lists both documents as gaps (FU-13-F1).
            const parked = await readCompletions(h.archive);
            expect(parked).toHaveLength(1);
            expect(parked[0]!.value["entries"]).toEqual([]);
            expect(parked[0]!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "rate-limited" }, { documentId: "D002", reasonCode: "artifact-pending" }]);

            h.clock.advance(121_000);
            const second = await runOnce(h);
            expect(second.counts).toMatchObject({ verified: 4, retryWait: 0 });
            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "retry_wait", "pending", "transferring", "verifying", "verified"]);
        });

        it("should not retry a parked artifact before its time", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1] });
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "status", status: 409, code: "ARTIFACT_PENDING", retryable: true, retryAfterSeconds: 60 } });
            await initArchive(h);
            await runOnce(h);
            const before = h.api.artifactRequests().length;
            h.clock.advance(30_000);
            await runOnce(h);
            // The parked document artifact is not due; the audit trail was fetched in the first run already.
            expect(h.api.artifactRequests().filter((url) => url.includes(identityFor(h, d1, "document")))).toHaveLength(1);
            expect(h.api.artifactRequests().length).toBe(before);
        });

        it("should retry an ARTIFACT_PENDING artifact later and keep going with the others in the same run", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1, pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 1, match: (info) => info.documentId === "D001" && info.fileType === "document", fault: { kind: "status", status: 409, code: "ARTIFACT_PENDING", retryable: true, retryAfterSeconds: 60 } });
            await initArchive(h);

            const first = await runOnce(h);

            expect(first.counts).toMatchObject({ retryWait: 1, verified: 3 });
            expect(first.snapshotStatus).toBe("partial");
            expect(first.reasonCodes).toContain("coverage-unverified");
            // D002 is complete, D001 is not: one manifest and one entry in the completion.
            const [completion] = await readCompletions(h.archive);
            expect(completion!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);

            h.clock.advance(61_000);
            await runOnce(h);
            const completions = await readCompletions(h.archive);
            expect(completions[1]!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001", "D002"]);
        });

        it("should stop downloading after 3 consecutive 503s", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002"), singleDoc("D004")] });
            h.api.addFault({ route: "artifact", times: 99, fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
            await initArchive(h);

            const summary = await runOnce(h);

            expect(h.api.artifactRequests()).toHaveLength(3);
            expect(summary.counts).toMatchObject({ retryWait: 3, verified: 0 });
            expect(summary.reasonCodes).toContain("export-unavailable");
        });

        it("should block VERSION_CHANGED and re-evaluate it in the next run's new snapshot", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1, pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 1, match: (info) => info.documentId === "D001" && info.fileType === "document", fault: { kind: "status", status: 409, code: "VERSION_CHANGED" } });
            await initArchive(h);

            const first = await runOnce(h);

            expect(first.snapshotStatus).toBe("blocked");
            expect(first.reasonCodes).toContain("version-changed");
            expect(first.counts).toMatchObject({ blocked: 1 });
            const id = identityFor(h, d1, "document");
            expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["blocked"]);

            const second = await runOnce(h);
            expect(second.snapshotStatus).toBe("partial");
            expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
        });

        it("should record SOURCE_REMOVED as a permanent gap, list it in the completion and never ask again", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1, pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
            await initArchive(h);

            const first = await runOnce(h);

            expect(first).toMatchObject({ historicalCoverage: "known_gap", counts: { terminalUnavailable: 1 } });
            expect(first.reasonCodes).toContain("source-removed");
            const [completion] = await readCompletions(h.archive);
            expect(completion!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);
            const id = identityFor(h, d1, "audit_trail");
            await runOnce(h);
            expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(1);
            const last = (await readCompletions(h.archive)).pop()!;
            expect(last.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);
        });

        it("should treat a truncated body as a network failure: retry_wait, nothing staged, nothing published", async () => {
            const d1 = singleDoc("D001");
            h = await createHarness({ docs: [d1] });
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "truncate" } });
            await initArchive(h);

            const first = await runOnce(h);

            expect(first.counts).toMatchObject({ retryWait: 1, verified: 0 });
            expect(first.reasonCodes).toContain("network-timeout");
            expect(await archivePdfs(h.archive)).toHaveLength(0);
            expect(await fs.readdir(path.join(h.control, "staging"))).toEqual([]);

            h.clock.advance(61_000);
            await runOnce(h);
            expect(await archivePdfs(h.archive)).toHaveLength(1);
        });

        it("should record transferring -> verifying -> integrity_error for a hash mismatch, then recover on the next run (U1)", async () => {
            const d1 = singleDoc("D001");
            h = await createHarness({ docs: [d1] });
            const good = d1.artifacts![0]!.bytes;
            const bad = Buffer.from(good);
            bad[Math.floor(good.length / 2)] = bad[Math.floor(good.length / 2)]! ^ 0xff;
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "bytes", bytes: bad } });
            await initArchive(h);

            const first = await runOnce(h);

            const id = identityFor(h, d1, "document");
            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "verifying", "integrity_error"]);
            expect(first.counts).toMatchObject({ integrityError: 1, verified: 0 });
            expect(await archivePdfs(h.archive)).toHaveLength(0);

            await runOnce(h);
            expect(await transitionPath(h.control, id)).toEqual([
                "pending", "transferring", "verifying", "integrity_error", "pending", "transferring", "verifying", "verified",
            ]);
        });

        it("should block an artifact as integrity-repeated after three integrity errors and stop asking for it", async () => {
            const d1 = singleDoc("D001");
            h = await createHarness({ docs: [d1] });
            const good = d1.artifacts![0]!.bytes;
            const bad = Buffer.from(good);
            bad[10] = bad[10]! ^ 0xff;
            h.api.addFault({ route: "artifact", times: 99, fault: { kind: "bytes", bytes: bad } });
            await initArchive(h);
            for (let run = 0; run < 3; run++) await runOnce(h);
            const id = identityFor(h, d1, "document");
            expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(3);

            const fourth = await runOnce(h);

            expect(fourth.snapshotStatus).toBe("blocked");
            expect(fourth.reasonCodes).toContain("integrity-repeated");
            expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(3);
            expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["blocked"]);
        });

        it("should stop downloads on SNAPSHOT_EXPIRED without changing the destination for good", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "status", status: 410, code: "SNAPSHOT_EXPIRED" } });
            await initArchive(h);
            const first = await runOnce(h);
            expect(h.api.artifactRequests()).toHaveLength(1);
            expect(first.reasonCodes).toContain("snapshot-expired");
            const second = await runOnce(h);
            expect(second.counts).toMatchObject({ verified: 4 });
        });

        it("should block on a rejected credential during a download and stop", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 99, fault: { kind: "status", status: 401, code: "UNAUTHORIZED" } });
            await initArchive(h);
            const summary = await runOnce(h);
            expect(h.api.artifactRequests()).toHaveLength(1);
            expect(summary.snapshotStatus).toBe("blocked");
            expect(summary.reasonCodes).toContain("credential-rejected");
        });
    });

    describe("snapshot stage", () => {
        it.each([
            ["a 401", { status: 401, code: "UNAUTHORIZED" }, "credential-rejected"],
            ["a 404", { status: 404, code: "NOT_FOUND" }, "credential-rejected"],
            ["a 400", { status: 400, code: "INVALID_REQUEST" }, "export-request-rejected"],
            ["an idempotency conflict", { status: 409, code: "IDEMPOTENCY_CONFLICT" }, "idempotency-conflict"],
        ])("should end the run as failed with an inventory after %s on POST /snapshots", async (_name, fault, reason) => {
            h = await createHarness({ docs: mix() });
            h.api.addFault({ route: "snapshot-post", times: 1, fault: { kind: "status", ...fault } });
            await initArchive(h);

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ snapshotStatus: "failed", reasonCodes: [reason], snapshotId: null, sequence: null });
            expect(h.api.artifactRequests()).toHaveLength(0);
            const inventory = (await listFiles(h.archive)).filter((file) => file.includes("/runs/"));
            expect(inventory).toHaveLength(1);
            expect(await readJsonFile(path.join(h.archive, inventory[0]!))).toMatchObject({ snapshotStatus: "failed", snapshotId: null, sequence: null });
        });

        it("should poll a building snapshot up to 3 times, 5 s apart, then go on when it turns ready", async () => {
            h = await createHarness({ docs: mix() });
            h.api.postStatus = "building";
            h.api.buildingGets = 2;
            const sleeps: number[] = [];
            await initArchive(h);

            const summary = await runOnce(h, { sleep: async (ms) => { sleeps.push(ms); } });

            expect(sleeps).toEqual([5000, 5000, 5000]);
            expect(h.api.requests.filter((request) => request.method === "GET" && /snapshots\/[0-9a-f-]{36}$/.test(request.url))).toHaveLength(3);
            expect(summary.counts?.verified).toBe(5);
        });

        it("should fail with snapshot-not-ready when the snapshot is still building after 3 reads", async () => {
            h = await createHarness({ docs: mix() });
            h.api.postStatus = "building";
            h.api.buildingGets = 99;
            const sleeps: number[] = [];
            await initArchive(h);

            const summary = await runOnce(h, { sleep: async (ms) => { sleeps.push(ms); } });

            expect(sleeps).toEqual([5000, 5000, 5000]);
            expect(summary).toMatchObject({ snapshotStatus: "failed", reasonCodes: ["snapshot-not-ready"], sequence: null });
            expect(h.api.artifactRequests()).toHaveLength(0);
        });

        it("should retry a POST that answers 409 SNAPSHOT_NOT_READY up to 3 times, 5 s apart, and then fail", async () => {
            h = await createHarness({ docs: mix() });
            h.api.addFault({ route: "snapshot-post", times: 9, fault: { kind: "status", status: 409, code: "SNAPSHOT_NOT_READY", retryable: true } });
            const sleeps: number[] = [];
            await initArchive(h);
            const summary = await runOnce(h, { sleep: async (ms) => { sleeps.push(ms); } });
            expect(sleeps).toEqual([5000, 5000, 5000]);
            expect(summary).toMatchObject({ snapshotStatus: "failed", reasonCodes: ["snapshot-not-ready"] });
        });

        it("should wait and retry when the candidate listing answers SNAPSHOT_NOT_READY once", async () => {
            h = await createHarness({ docs: mix() });
            h.api.addFault({ route: "candidates", times: 1, fault: { kind: "status", status: 409, code: "SNAPSHOT_NOT_READY", retryable: true } });
            const sleeps: number[] = [];
            await initArchive(h);
            const summary = await runOnce(h, { sleep: async (ms) => { sleeps.push(ms); } });
            expect(sleeps).toEqual([5000]);
            expect(summary.counts?.verified).toBe(5);
        });

        it("should fail the run when the snapshot answers failed", async () => {
            h = await createHarness({ docs: mix() });
            h.api.postStatus = "failed";
            await initArchive(h);
            const summary = await runOnce(h);
            expect(summary.snapshotStatus).toBe("failed");
            expect(summary.reasonCodes).toEqual(["export-unavailable"]);
        });
    });

    describe("candidate checks before anything becomes a key or a path", () => {
        it("should block a candidate whose announced artifactIdentity differs from the recomputed one (export-response-invalid)", async () => {
            const d1 = pairDoc("D001");
            h = await createHarness({ docs: [d1, pairDoc("D002")] });
            h.api.identityOverrides.set("D001/document", "a".repeat(64));
            await initArchive(h);

            const summary = await runOnce(h);

            expect(summary.snapshotStatus).toBe("blocked");
            expect(summary.reasonCodes).toContain("export-response-invalid");
            expect(summary.counts).toMatchObject({ blocked: 1, verified: 2 });
            expect(h.api.artifactRequests().filter((url) => url.includes("a".repeat(64)))).toHaveLength(0);
            expect((await archivePdfs(h.archive)).filter((file) => file.includes("/D001/"))).toHaveLength(0);
            expect(await treeContains(h.archive, "a".repeat(64))).toBe(false);
        });

        it("should block a 256 character documentId as invalid-path-segment and carry on", async () => {
            const long = "x".repeat(256);
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc(long)] });
            await initArchive(h);

            const summary = await runOnce(h);

            expect(summary.snapshotStatus).toBe("blocked");
            expect(summary.reasonCodes).toContain("invalid-path-segment");
            expect(summary.counts).toMatchObject({ verified: 2, blocked: 1 });
            expect(await archivePdfs(h.archive)).toHaveLength(2);
            expect((await listFiles(h.archive)).some((file) => file.includes(long))).toBe(false);
            const inventory = (await listFiles(h.archive)).find((file) => file.includes("/runs/"))!;
            expect((await readJsonFile(path.join(h.archive, inventory)))["reasonCodes"]).toContain("invalid-path-segment");
        });

        it("should ignore an excluded candidate whose documentId is unusable: only included candidates can change the status (W8)", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), { documentId: "y".repeat(600), classification: "excluded_by_policy", statusType: "060" }] });
            await initArchive(h);

            const summary = await runOnce(h);

            expect(summary).toMatchObject({ snapshotStatus: "partial", counts: { candidates: 2, included: 1, verified: 2, blocked: 0 } });
            expect(summary.reasonCodes).toEqual(["coverage-unverified", "drive-not-configured"]);
        });

        it("should not let a document called completions or runs shadow the archive's own directories", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), singleDoc("completions"), singleDoc("runs")] });
            await initArchive(h);
            const summary = await runOnce(h);
            expect(summary.reasonCodes).toContain("invalid-path-segment");
            expect(await archivePdfs(h.archive)).toHaveLength(2);
        });
    });

    describe("carry-over of non-terminal entries whose document left the snapshot (BJJ-455 P2 3.4-d)", () => {
        const stagedBins = async (): Promise<string[]> =>
            (await fs.readdir(path.join(h.control, "staging"))).filter((name) => name.endsWith(".bin"));
        const destinationTransitions = async (id: string) =>
            (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && record.body["artifactIdentity"] === id);

        it("should block a retry_wait entry with no staged bytes as exact-bytes-unavailable once its document leaves the snapshot, count it and list the gap", async () => {
            const x = singleDoc("D001");
            const keep = pairDoc("D002");
            h = await createHarness({ docs: [x, keep] });
            h.api.addFault({ route: "artifact", times: 1, fault: { kind: "status", status: 429, code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 120 } });
            await initArchive(h);
            const id = identityFor(h, x, "document");

            const first = await runOnce(h);
            expect(first.counts).toMatchObject({ retryWait: 1, verified: 0, terminalUnavailable: 0 });
            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "retry_wait"]);
            expect(await stagedBins()).toEqual([]);

            // Not due yet (retryAfter 120 s, clock unchanged): an unstaged entry has nothing to wait for either way.
            h.api.docs = [keep];
            const second = await runOnce(h);

            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "retry_wait", "blocked"]);
            const settle = (await destinationTransitions(id)).pop()!;
            expect(settle.body).toMatchObject({ from: "retry_wait", to: "blocked", reasonCode: "exact-bytes-unavailable" });
            expect(second.counts).toMatchObject({ retryWait: 0, blocked: 0, terminalUnavailable: 1 });
            expect(second.historicalCoverage).toBe("known_gap");
            const last = (await readCompletions(h.archive)).pop()!;
            expect(last.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "exact-bytes-unavailable" }]);
            // Only the document that is still in the snapshot was fetched again.
            expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(1);

            // Idempotent: the same snapshot again appends nothing for X and keeps the gap.
            const before = (await destinationTransitions(id)).length;
            const third = await runOnce(h);
            expect((await destinationTransitions(id)).length).toBe(before);
            expect(third.counts).toMatchObject({ terminalUnavailable: 1 });
            expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "exact-bytes-unavailable" }]);
        });

        it("should publish a staged, non-terminally blocked entry from staging once its document leaves the snapshot, without asking the source again", async () => {
            const x = singleDoc("D001");
            h = await createHarness({ docs: [x] });
            await initArchive(h);
            const away = await swapArchive(h);
            const id = identityFor(h, x, "document");

            const first = await runOnce(h);
            expect(first.counts).toMatchObject({ blocked: 1, verified: 0 });
            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "blocked"]);
            expect((await destinationTransitions(id)).pop()!.body["reasonCode"]).toBe("archive-unavailable");
            expect(await stagedBins()).toEqual([`${id}.bin`]);
            expect(h.api.artifactRequests()).toHaveLength(1);

            await swapBack(h, away);
            h.api.docs = [pairDoc("D002")];
            const second = await runOnce(h);

            expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
            expect(second.counts).toMatchObject({ blocked: 0, terminalUnavailable: 0 });
            expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(1);
            expect(await archivePdfs(h.archive)).toHaveLength(3);
            expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([]);

            // Idempotent: a verified entry outside the snapshot is left alone.
            const before = (await destinationTransitions(id)).length;
            await runOnce(h);
            expect((await destinationTransitions(id)).length).toBe(before);
        });

        describe("a carried publication stays recoverable (BJJ-455 P2 FU-10, FU-10-F1: 3.4-d x 3.4-f)", () => {
            const manifestsOf = async (doc: string): Promise<string[]> =>
                (await listFiles(h.archive)).filter((file) => file.includes(`/${doc}/manifests/`));
            const manifestRecords = async () =>
                (await readLedgerRecords(h.control)).filter((record) => record.type === "manifest_published");
            const manifestRecordsOf = async (doc: string) =>
                (await manifestRecords()).filter((record) => String(record.body["relativeKey"]).includes(`/${doc}/manifests/`));
            const ledgerDir = (): string => path.join(h.control, "ledger");
            const journals = async (): Promise<string[]> => (await fs.readdir(ledgerDir())).filter((name) => name.startsWith("journal-")).sort();
            const loseLedgerAndRecover = async () => {
                const installationId = (await readJsonFile(path.join(h.archive, ".bjj-backup", "installation.json")))["installationId"];
                await fs.rm(ledgerDir(), { recursive: true });
                return withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
            };
            const verifyAll = () => withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));
            /** Stages D001 while the archive is gone. Returns how to put the archive back. */
            async function stagedWhileArchiveIsGone(doc: FixtureDoc = singleDoc("D001")): Promise<{ restore: () => Promise<void> }> {
                h = await createHarness({ docs: [doc] });
                await initArchive(h);
                const away = await swapArchive(h);
                await runOnce(h);
                return { restore: () => swapBack(h, away) };
            }
            /** Run 1 stages D001 while the archive is gone; run 2 finds the archive again and no longer lists D001. */
            async function carried(): Promise<{ id: string; second: Awaited<ReturnType<typeof runOnce>> }> {
                const x = singleDoc("D001");
                const { restore } = await stagedWhileArchiveIsGone(x);
                const id = identityFor(h, x, "document");
                expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["blocked"]);
                await restore();
                h.api.docs = [pairDoc("D002")];
                const second = await runOnce(h);
                expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                return { id, second };
            }

            it("should be rebuilt by recover from the archive after the ledger is lost, and verify --all should check all three PDFs", async () => {
                const { id, second } = await carried();

                // The carried document has its own manifest, but the snapshot's completion does not claim it.
                expect(await manifestsOf("D001")).toHaveLength(1);
                const completion = (await readCompletions(h.archive)).pop()!;
                expect(completion.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                expect(completion.value["gaps"]).toEqual([]);
                expect(second.counts).toMatchObject({ blocked: 0, terminalUnavailable: 0 });

                const recovered = await loseLedgerAndRecover();

                expect(recovered).toMatchObject({ recovered: 3, unverified: 0, knownGaps: 0 });
                expect((await destinationStates(h.control))[id]).toBe("verified");
                expect(await verifyAll()).toMatchObject({ checked: 3, integrityErrors: 0 });
            });

            it("should publish the manifest once: a later run that still omits the document writes nothing new for it", async () => {
                const { id } = await carried();
                const manifest = (await manifestsOf("D001"))[0]!;
                const manifestBytes = await fs.readFile(path.join(h.archive, manifest));
                const records = (await manifestRecords()).length;
                const transitions = (await destinationTransitions(id)).length;

                const third = await runOnce(h);

                expect(await manifestsOf("D001")).toEqual([manifest]);
                expect((await fs.readFile(path.join(h.archive, manifest))).equals(manifestBytes)).toBe(true);
                expect((await manifestRecords()).length).toBe(records);
                expect((await destinationTransitions(id)).length).toBe(transitions);
                expect(third.counts).toMatchObject({ blocked: 0, terminalUnavailable: 0 });
                expect(await archivePdfs(h.archive)).toHaveLength(3);
            });

            it("should still index the artifact after the archive stayed gone across several bindings and the ledger was compacted", async () => {
                const x = singleDoc("D001");
                const { restore } = await stagedWhileArchiveIsGone(x);
                const id = identityFor(h, x, "document");
                // Two more snapshots without D001 while the archive is still unavailable: the ledger state forgets its observation.
                h.api.docs = [];
                await runOnce(h);
                await runOnce(h);
                await restore();
                h.api.docs = [pairDoc("D002")];

                const compacted = await runOnce(h, { compactionThreshold: 1 });

                expect(await fs.stat(path.join(ledgerDir(), "checkpoint.json")).then(() => true, () => false)).toBe(true);
                expect((await journals()).length).toBeGreaterThanOrEqual(2);
                expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                expect(h.api.artifactRequests().filter((url) => url.includes(id))).toHaveLength(1);
                expect(await manifestsOf("D001")).toHaveLength(1);
                expect(compacted.counts).toMatchObject({ blocked: 0, terminalUnavailable: 0 });
                expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 0 });
                expect(await verifyAll()).toMatchObject({ checked: 3 });
            });

            describe("real SIGKILL at the boundaries of a carried publication", () => {
                const POINTS = ["after-manifest-first-before-record", "after-publish-before-verifying", "after-verified"] as const;
                // Before the manifest-first step a kill at the first point leaves a manifest and no PDF: visible as unverified, never silent.
                const afterKill: Record<typeof POINTS[number], { recovered: number; unverified: number; pdfs: number }> = {
                    "after-manifest-first-before-record": { recovered: 0, unverified: 1, pdfs: 0 },
                    "after-publish-before-verifying": { recovered: 1, unverified: 0, pdfs: 1 },
                    "after-verified": { recovered: 1, unverified: 0, pdfs: 1 },
                };
                const killedRun = async (point: typeof POINTS[number]): Promise<string> => {
                    const x = singleDoc("D001");
                    const { restore } = await stagedWhileArchiveIsGone(x);
                    await restore();
                    h.api.docs = [];
                    const child = spawnUnderFlock(h, ["run", "--config", h.configPath, "--kill-at", point]);
                    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
                    h.clock.set(new Date(Date.now() + 60_000).toISOString());
                    return identityFor(h, x, "document");
                };

                it.each(POINTS)("should leave recovery able to see the artifact when the ledger is lost right after a kill at %s", async (point) => {
                    await killedRun(point);

                    const recovered = await loseLedgerAndRecover();

                    const expected = afterKill[point];
                    expect(recovered).toMatchObject({ recovered: expected.recovered, unverified: expected.unverified });
                    expect(await archivePdfs(h.archive)).toHaveLength(expected.pdfs);
                    expect(await manifestsOf("D001")).toHaveLength(1);
                    expect(await verifyAll()).toMatchObject({ checked: expected.recovered, integrityErrors: 0 });
                }, 180_000);

                it.each(POINTS)("should converge through later bindings after a kill at %s, then survive losing the ledger", async (point) => {
                    const id = await killedRun(point);

                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h);

                    expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                    expect(await archivePdfs(h.archive)).toHaveLength(1);
                    expect(await manifestsOf("D001")).toHaveLength(1);
                    expect(new Set((await manifestRecords()).map((record) => record.body["relativeKey"])).size).toBe((await manifestRecords()).length);
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 1, unverified: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 1 });
                }, 180_000);
            });

            it.each(["after-publish-before-verifying", "after-verified"] as const)(
                "should keep the available half of a pair recoverable after a real kill at %s, with its sibling still unfetched", async (point) => {
                    const pair = pairDoc("D001");
                    h = await createHarness({ docs: [pair] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.fileType === "audit_trail", fault: { kind: "status", status: 429, code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 120 } });
                    await initArchive(h);
                    const away = await swapArchive(h);
                    await runOnce(h);
                    await swapBack(h, away);
                    h.api.docs = [];
                    const child = spawnUnderFlock(h, ["run", "--config", h.configPath, "--kill-at", point]);
                    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });

                    // The manifest was written before the sibling was settled, so the published PDF is not orphaned.
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 1, unverified: 1 });
                    expect(await verifyAll()).toMatchObject({ checked: 1 });
                }, 180_000);

            it("should keep the available half of a pair recoverable and report the missing half, not lose both", async () => {
                const pair = pairDoc("D001");
                h = await createHarness({ docs: [pair, pairDoc("D002")] });
                // Only D001's audit trail is refused by the source; its document is staged while the archive is gone.
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 429, code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 120 } });
                await initArchive(h);
                const away = await swapArchive(h);
                await runOnce(h);
                await swapBack(h, away);
                const documentId = identityFor(h, pair, "document");
                h.api.docs = [pairDoc("D002")];

                const second = await runOnce(h);

                expect((await transitionPath(h.control, documentId)).slice(-1)).toEqual(["verified"]);
                const manifest = await readJsonFile(path.join(h.archive, (await manifestsOf("D001"))[0]!));
                expect(manifest["artifacts"].map((artifact: { artifactType: string }) => artifact.artifactType)).toEqual(["audit-trail", "document"]);
                expect(second.counts).toMatchObject({ terminalUnavailable: 1 });
                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "exact-bytes-unavailable" }]);

                const recovered = await loseLedgerAndRecover();

                expect(recovered).toMatchObject({ recovered: 3, unverified: 1, knownGaps: 1 });
                expect(await verifyAll()).toMatchObject({ checked: 3 });
            });

            it("should index the verified half of a current incomplete pair at once, outside the completion", async () => {
                // The audit trail is gone at the source for good: D001's own PDF verifies, but the pair is never complete.
                const gone = pairDoc("D001");
                h = await createHarness({ docs: [gone, pairDoc("D002")] });
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
                await initArchive(h);
                const id = identityFor(h, gone, "document");

                await runOnce(h);

                expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                const manifest = await readJsonFile(path.join(h.archive, (await manifestsOf("D001"))[0]!));
                expect(manifest["artifacts"]).toHaveLength(2);
                expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                const records = (await manifestRecords()).length;
                await runOnce(h);
                expect(await manifestsOf("D001")).toHaveLength(1);
                expect((await manifestRecords()).length).toBe(records);
                // Recovery finds the document's PDF and D002's pair, and still reports the sibling that never existed.
                expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 1 });
                expect(await verifyAll()).toMatchObject({ checked: 3 });
            });

            describe("a sibling that is only late does not strand the verified half (BJJ-455 P2 FU-10-F4)", () => {
                it("should index the verified half while its sibling waits for a retry, without a completion entry, and keep the manifest when the sibling lands", async () => {
                    const late = pairDoc("D001");
                    h = await createHarness({ docs: [late, pairDoc("D002")] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
                    await initArchive(h);
                    const id = identityFor(h, late, "document");
                    const sibling = identityFor(h, late, "audit_trail");

                    await runOnce(h);

                    expect((await destinationStates(h.control))[sibling]).toBe("retry_wait");
                    expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                    const manifests = await manifestsOf("D001");
                    expect(manifests).toHaveLength(1);
                    expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                    // Recovery finds the verified document and D002's pair, and reports the sibling that never arrived.
                    const lostAndFound = await loseLedgerAndRecover();
                    expect(lostAndFound).toMatchObject({ recovered: 3, unverified: 1 });
                    expect(await verifyAll()).toMatchObject({ checked: 3 });
                });

                it("should publish the same manifest again, byte for byte and without a conflict, when the late sibling lands", async () => {
                    const late = pairDoc("D001");
                    h = await createHarness({ docs: [late, pairDoc("D002")] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
                    await initArchive(h);
                    await runOnce(h);
                    const before = await manifestsOf("D001");
                    expect(before).toHaveLength(1);
                    const bytes = await fs.readFile(path.join(h.archive, before[0]!));

                    h.api.clearFaults();
                    h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    const after = await manifestsOf("D001");
                    expect(after).toEqual(before);
                    expect((await fs.readFile(path.join(h.archive, after[0]!))).equals(bytes)).toBe(true);
                    const entries = (await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId);
                    expect(entries).toContain("D001");
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 4, unverified: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 4 });
                });
            });

            describe("a manifest is named by its content (BJJ-455 P2 FU-10-F5)", () => {
                const lateAudit = (): FixtureDoc => pairDoc("D001");
                const changedAudit = (): FixtureDoc => ({
                    ...lateAudit(),
                    artifacts: lateAudit().artifacts!.map((a) => (a.fileType === "audit_trail" ? { ...a, bytes: pdfOf("new audit bytes while the metadata is unchanged") } : a)),
                });
                /** D001's document verifies and its audit trail waits for a retry; D002 completes. */
                async function earlyIndexed(): Promise<{ early: string; bytes: Buffer }> {
                    h = await createHarness({ docs: [lateAudit(), pairDoc("D002")] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
                    await initArchive(h);
                    await runOnce(h);
                    const files = await manifestsOf("D001");
                    expect(files).toHaveLength(1);
                    h.api.clearFaults();
                    h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
                    return { early: files[0]!, bytes: await fs.readFile(path.join(h.archive, files[0]!)) };
                }
                const completionEntry = async (doc: string) =>
                    (await readCompletions(h.archive)).pop()!.value["entries"].find((entry: { documentId: string }) => entry.documentId === doc);

                it("should name every new manifest by the digest of its own bytes", async () => {
                    const { early, bytes } = await earlyIndexed();
                    const name = path.basename(early);
                    expect(name).toMatch(/^[0-9a-f]{64}-[0-9a-f]{64}\.json$/);
                    expect(name.slice(65, 129)).toBe(createHash("sha256").update(bytes).digest("hex"));
                });

                it("should index a changed sibling claim under the same metadata revision next to the early manifest, and keep it recoverable after the document leaves the snapshot", async () => {
                    const { early, bytes } = await earlyIndexed();
                    h.api.docs = [changedAudit(), pairDoc("D002")];

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    const files = await manifestsOf("D001");
                    expect(files).toHaveLength(2);
                    expect((await fs.readFile(path.join(h.archive, early))).equals(bytes)).toBe(true);
                    const entry = await completionEntry("D001");
                    expect(entry.manifestKey).toBe(files.find((file) => file !== early));
                    expect(entry.manifestKey).toContain(`-${entry.manifestSha256}.json`);

                    // The document leaves the snapshot: the history holds two artifact sets for one revision.
                    h.api.docs = [pairDoc("D002")];
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await manifestsOf("D001")).toEqual(files);

                    // Four PDFs are recoverable; the audit trail that never arrived is the one unverified claim.
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 4, unverified: 1 });
                    expect(await verifyAll()).toMatchObject({ checked: 4 });
                }, 240_000);

                it("should recover both audit trails exactly once when two snapshots each verified another one under one revision", async () => {
                    h = await createHarness({ docs: [lateAudit(), pairDoc("D002")] });
                    await initArchive(h);
                    await runOnce(h);
                    h.api.docs = [changedAudit(), pairDoc("D002")];
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await manifestsOf("D001")).toHaveLength(2);

                    h.api.docs = [pairDoc("D002")];
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 5, unverified: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 5 });
                }, 240_000);

                it("should leave an early manifest of the old name untouched and complete the document under a new one", async () => {
                    h = await createHarness({ docs: [lateAudit(), pairDoc("D002")] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
                    await initArchive(h);
                    await runOnce(h);
                    // What the previous release left behind: the same early manifest under the metadata-only name.
                    const versioned = (await manifestsOf("D001"))[0]!;
                    const manifest = await readJsonFile(path.join(h.archive, versioned));
                    const legacyKey = manifestKey({ companyId: COMPANY, documentId: "D001", metadataRevision: manifest["metadataRevision"] as string });
                    await fs.rename(path.join(h.archive, versioned), path.join(h.archive, legacyKey));
                    const legacyBytes = await fs.readFile(path.join(h.archive, legacyKey));
                    await loseLedgerAndRecover();

                    h.api.clearFaults();
                    h.api.docs = [changedAudit(), pairDoc("D002")];
                    h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    const files = await manifestsOf("D001");
                    expect(files).toHaveLength(2);
                    expect(files).toContain(legacyKey);
                    expect((await fs.readFile(path.join(h.archive, legacyKey))).equals(legacyBytes)).toBe(true);
                    const entry = await completionEntry("D001");
                    expect(entry.manifestKey).not.toBe(legacyKey);
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 4, unverified: 1 });
                    expect(await verifyAll()).toMatchObject({ checked: 4 });
                }, 240_000);

                it("should refuse a well-named manifest whose claim no snapshot ever made, even next to a good one", async () => {
                    const { early } = await earlyIndexed();
                    h.api.docs = [pairDoc("D002")];
                    await runOnce(h); // D001 leaves the snapshot with its audit trail still unverified
                    const manifest = await readJsonFile(path.join(h.archive, early));
                    (manifest["artifacts"] as Array<{ byteLength: number }>)[0]!.byteLength += 1;
                    const forged = Buffer.from(JSON.stringify(manifest));
                    const forgedKey = early.replace(/-[0-9a-f]{64}\.json$/, `-${createHash("sha256").update(forged).digest("hex")}.json`);
                    await fs.writeFile(path.join(h.archive, forgedKey), forged, { mode: 0o600 });

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    expect((await fs.readFile(path.join(h.archive, forgedKey))).equals(forged)).toBe(true);
                    await fs.rm(path.join(h.archive, forgedKey));
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                }, 240_000);
            });

            describe("damage to a bound manifest stays visible next to alternate coverage (BJJ-455 P2 FU-10-F6)", () => {
                const second = (): FixtureDoc => ({ ...singleDoc("D001"), templateId: "T2" });
                const lengthPlusOne = (value: any): void => { value.artifacts[0].byteLength += 1; };
                const reformat = (): void => undefined;
                const state = async () => {
                    const ledger = await LedgerStore.open(h.control, { readOnly: true });
                    const value = ledger.state;
                    await ledger.close();
                    return value;
                };
                /** D001 has two metadata revisions that share one PDF, so each manifest covers the artifact the other lists too. */
                async function twoRevisions(): Promise<string[]> {
                    h = await createHarness({ docs: [singleDoc("D001")] });
                    await initArchive(h);
                    await runOnce(h);
                    h.api.docs = [second()];
                    await runOnce(h);
                    h.api.docs = [pairDoc("D002")];
                    await runOnce(h);
                    const files = (await manifestsOf("D001")).map((name) => path.join(h.archive, name)).sort();
                    expect(files).toHaveLength(2);
                    return files;
                }
                const damage = async (file: string, change: (value: any) => void, pretty: boolean): Promise<{ original: Buffer; damaged: Buffer }> => {
                    const original = await fs.readFile(file);
                    const value = JSON.parse(original.toString("utf8"));
                    change(value);
                    await fs.writeFile(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
                    return { original, damaged: await fs.readFile(file) };
                };
                /** Exit 69 in-process and through the command, independent work published, damaged bytes and verified entries untouched. */
                async function expectVisibleConflict(file: string, damaged: Buffer, original: Buffer): Promise<void> {
                    const id = identityFor(h, singleDoc("D001"), "document");
                    const transitions = (await destinationTransitions(id)).length;
                    h.api.docs = [pairDoc("D002"), pairDoc("D003")];

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                    expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toContain("D003");
                    expect((await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!.body["reasonCodes"]).toContain("archive-conflict");
                    const child = spawnUnderFlock(h, ["run", "--config", h.configPath]);
                    expect(await child.exited).toEqual({ code: 69, signal: null });
                    expect(child.stderr().trim()).toBe("archive-conflict");
                    expect((await fs.readFile(file)).equals(damaged)).toBe(true);
                    expect((await destinationTransitions(id)).length).toBe(transitions);
                    expect((await destinationStates(h.control))[id]).toBe("verified");

                    await fs.writeFile(file, original);
                    h.clock.set(new Date(Date.now() + 60_000).toISOString());
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                }

                it.each([["a longer length claim", lengthPlusOne, false], ["a reformatted file", reformat, true]] as const)(
                    "should end in archive-conflict when %s damages a manifest the ledger acknowledged and a completion names, though the other manifest covers the artifact",
                    async (_name, change, pretty) => {
                        const files = await twoRevisions();
                        const { original, damaged } = await damage(files[0]!, change, pretty);
                        await expectVisibleConflict(files[0]!, damaged, original);
                    }, 240_000);

                it("should end in archive-conflict when the damaged manifest is only named by a completion (the ledger lost its acknowledgement)", async () => {
                    const files = await twoRevisions();
                    await loseLedgerAndRecover();
                    expect((await state()).manifests.size).toBe(0);
                    const { original, damaged } = await damage(files[1]!, reformat, true);
                    await expectVisibleConflict(files[1]!, damaged, original);
                }, 240_000);

                it("should end in archive-conflict when the damaged manifest is only acknowledged (no completion names it), though another one covers the artifact", async () => {
                    h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
                    h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
                    await initArchive(h);
                    await runOnce(h);
                    const early = path.join(h.archive, (await manifestsOf("D001"))[0]!);
                    h.api.clearFaults();
                    h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
                    h.api.docs = [{ ...pairDoc("D001"), artifacts: pairDoc("D001").artifacts!.map((a) => (a.fileType === "audit_trail" ? { ...a, bytes: pdfOf("changed audit") } : a)) }, pairDoc("D002")];
                    await runOnce(h);
                    expect(await manifestsOf("D001")).toHaveLength(2);
                    expect((await state()).manifests.has(path.relative(h.archive, early))).toBe(true);
                    expect((await readCompletions(h.archive)).flatMap((c) => c.value["entries"].map((e: { manifestKey: string }) => e.manifestKey))).not.toContain(path.relative(h.archive, early));
                    h.api.docs = [pairDoc("D002")];
                    await runOnce(h);
                    const { original, damaged } = await damage(early, lengthPlusOne, false);
                    await expectVisibleConflict(early, damaged, original);
                }, 240_000);

                it("should keep an invalid file that nothing binds from conflicting while valid manifests cover its document", async () => {
                    const files = await twoRevisions();
                    const junk = path.join(path.dirname(files[0]!), `${"2".repeat(64)}-${"3".repeat(64)}.json`);
                    await fs.writeFile(junk, "{\"junk\":true}\n", { mode: 0o600 });
                    h.api.docs = [pairDoc("D002"), pairDoc("D003")];

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    expect((await fs.readFile(junk, "utf8"))).toBe("{\"junk\":true}\n");
                }, 240_000);
            });

            describe("a bound manifest never goes missing or damaged silently (BJJ-455 P2 FU-12)", () => {
                const second = (): FixtureDoc => ({ ...singleDoc("D001"), templateId: "T2" });
                const lengthPlusOne = (value: any): void => { value.artifacts[0].byteLength += 1; };
                const keyOf = (file: string): string => path.relative(h.archive, file);
                const manifestReadCount = (spy: jest.SpyInstance): number => spy.mock.calls.filter(([key]) => String(key).includes("/manifests/")).length;
                /** D001 has two metadata revisions that share one PDF; the later snapshot names the second manifest, the earlier one the first. */
                async function twoRevisions(leave: boolean): Promise<string[]> {
                    h = await createHarness({ docs: [singleDoc("D001")] });
                    await initArchive(h);
                    await runOnce(h);
                    h.api.docs = [second()];
                    await runOnce(h);
                    if (leave) {
                        h.api.docs = [pairDoc("D002")];
                        await runOnce(h);
                    }
                    const files = (await manifestsOf("D001")).map((name) => path.join(h.archive, name)).sort();
                    expect(files).toHaveLength(2);
                    return files;
                }
                const dropOldestJournal = async (): Promise<void> => {
                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h, { compactionThreshold: 1 });
                    await fs.rm(path.join(ledgerDir(), (await journals())[0]!));
                };
                const entryOf = async (file: string) =>
                    (await readCompletions(h.archive)).find((completion) => completion.value["entries"].some((e: { manifestKey: string }) => e.manifestKey === keyOf(file)));
                /** The first snapshot's manifest of D001: a bound file the later snapshot no longer names. */
                const older = async (): Promise<string> =>
                    path.join(h.archive, (await readCompletions(h.archive))[0]!.value["entries"].find((e: { documentId: string }) => e.documentId === "D001").manifestKey);
                const lastRunFinished = async () => (await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!;
                const cliVerify = (extra: string[] = []) => spawnUnderFlock(h, ["verify", "--config", h.configPath, ...extra]);

                it("A1: should republish a deleted, acknowledged and completion-named manifest byte for byte when it can be rebuilt, then write nothing more", async () => {
                    const files = await twoRevisions(true);
                    const lost = files[0]!;
                    const original = await fs.readFile(lost);
                    const completion = await entryOf(lost);
                    expect(completion).toBeDefined();
                    await fs.rm(lost);
                    const restoreOut = path.join(h.base, "restored-a1");
                    await expect(restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { snapshotId: completion!.value["snapshotId"] }, outDir: restoreOut }))
                        .rejects.toBeInstanceOf(WorkerError);
                    await fs.rm(restoreOut, { recursive: true, force: true });
                    const records = (await manifestRecords()).length;

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    expect((await fs.readFile(lost)).equals(original)).toBe(true);
                    expect((await manifestRecords()).length).toBe(records);
                    const before = await listFiles(h.archive);
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect((await manifestRecords()).length).toBe(records);
                    expect((await listFiles(h.archive)).filter((file) => file.includes("/manifests/"))).toEqual(before.filter((file) => file.includes("/manifests/")));
                    expect((await fs.readFile(lost)).equals(original)).toBe(true);
                    const report = await restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { snapshotId: completion!.value["snapshotId"] }, outDir: restoreOut });
                    expect(report.documents.map((doc) => doc.documentId)).toContain("D001");
                    await fs.rm(restoreOut, { recursive: true, force: true });
                }, 240_000);

                it("A2: should end in archive-conflict, exit 69 and write nothing at the key when a deleted bound manifest cannot be rebuilt, still publishing independent work", async () => {
                    const files = await twoRevisions(true);
                    await dropOldestJournal();
                    const lost = files[0]!;
                    const original = await fs.readFile(lost);
                    await fs.rm(lost);
                    h.api.docs = [pairDoc("D002"), pairDoc("D003")];

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                    expect(await fs.stat(lost).then(() => true, () => false)).toBe(false);
                    expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toContain("D003");
                    expect((await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!.body["reasonCodes"]).toContain("archive-conflict");
                    const child = spawnUnderFlock(h, ["run", "--config", h.configPath]);
                    expect(await child.exited).toEqual({ code: 69, signal: null });
                    expect(child.stderr().trim()).toBe("archive-conflict");
                    expect(await fs.stat(lost).then(() => true, () => false)).toBe(false);

                    await fs.writeFile(lost, original, { mode: 0o600 });
                    h.clock.set(new Date(Date.now() + 60_000).toISOString());
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                }, 240_000);

                it("A3: should find a deleted bound manifest of a current-snapshot document in the one listing, with no extra manifest reads", async () => {
                    await twoRevisions(false);
                    const lost = await older();
                    const original = await fs.readFile(lost);
                    await fs.rm(lost);
                    const reads = jest.spyOn(LocalDestination.prototype, "readArchiveFile");
                    const listing = jest.spyOn(restoreModule, "listManifestFiles");
                    try {
                        await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                        expect(manifestReadCount(reads)).toBe(0);
                        expect(listing).toHaveBeenCalledTimes(1);
                    } finally {
                        reads.mockRestore();
                        listing.mockRestore();
                    }
                    expect((await fs.readFile(lost)).equals(original)).toBe(true);
                }, 240_000);

                it("F1: should run the ownership guard before republishing and write nothing when it refuses", async () => {
                    await twoRevisions(false);
                    const lost = await older();
                    await fs.rm(lost);
                    const guard = jest.spyOn(LedgerStore.prototype, "guardExternalWrite").mockRejectedValue(new WorkerError("lock-not-held"));
                    try {
                        await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "lock-not-held" });
                        expect(guard).toHaveBeenCalled();
                        expect(await fs.stat(lost).then(() => true, () => false)).toBe(false);
                    } finally {
                        guard.mockRestore();
                    }
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await fs.stat(lost).then(() => true, () => false)).toBe(true);
                }, 240_000);

                it("B1: should leave run alone but make verify --all report an older bound manifest damaged after its document was fully published", async () => {
                    await twoRevisions(false);
                    const damagedFile = await older();
                    const original = await fs.readFile(damagedFile);
                    const value = JSON.parse(original.toString("utf8"));
                    lengthPlusOne(value);
                    await fs.writeFile(damagedFile, JSON.stringify(value));
                    const damaged = await fs.readFile(damagedFile);

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect((await fs.readFile(damagedFile)).equals(damaged)).toBe(true);

                    await expect(verifyAll()).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    // The ledger's record of that verify run carries the finding: it is not indistinguishable from a healthy one.
                    expect((await lastRunFinished()).body["reasonCodes"]).toEqual(["archive-conflict"]);
                    const child = cliVerify(["--all"]);
                    expect(await child.exited).toEqual({ code: 69, signal: null });
                    expect(child.stderr().trim()).toBe("archive-conflict");
                    expect((await fs.readFile(damagedFile)).equals(damaged)).toBe(true);
                    // Without --all the scope is unchanged: PDFs only.
                    await expect(withWorker(h, "verify", (worker) => worker.runner.verify({ all: false }))).resolves.toMatchObject({ integrityErrors: 0 });

                    await fs.writeFile(damagedFile, original);
                    await expect(verifyAll()).resolves.toMatchObject({ integrityErrors: 0 });
                    expect((await lastRunFinished()).body["reasonCodes"]).toEqual([]);
                    expect(await cliVerify(["--all"]).exited).toEqual({ code: 0, signal: null });
                }, 240_000);

                it("B1b: should make verify --all report a deleted bound manifest and never write it", async () => {
                    await twoRevisions(false);
                    const lost = await older();
                    await fs.rm(lost);
                    await expect(verifyAll()).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    expect((await lastRunFinished()).body["reasonCodes"]).toEqual(["archive-conflict"]);
                    expect(await fs.stat(lost).then(() => true, () => false)).toBe(false);
                }, 240_000);

                it("B2: should pass verify --all on a healthy archive, reading each bound manifest once and nothing else", async () => {
                    const files = await twoRevisions(true);
                    const reads = jest.spyOn(LocalDestination.prototype, "readArchiveFile");
                    try {
                        await expect(verifyAll()).resolves.toMatchObject({ integrityErrors: 0 });
                        const bound = (await manifestRecords()).length;
                        expect(manifestReadCount(reads)).toBe(bound);
                        expect(files.length).toBeLessThanOrEqual(bound);
                    } finally {
                        reads.mockRestore();
                    }
                }, 240_000);
            });

            describe("backfill proves the archive file and never skips silently (BJJ-455 P2 FU-10-F2)", () => {
                it("should publish a carried manifest again when the ledger records it but the archive file is gone", async () => {
                    const { id } = await carried();
                    const manifest = (await manifestsOf("D001"))[0]!;
                    const bytes = await fs.readFile(path.join(h.archive, manifest));
                    await fs.rm(path.join(h.archive, manifest));
                    const records = (await manifestRecords()).length;
                    const transitions = (await destinationTransitions(id)).length;

                    await runOnce(h);

                    expect((await fs.readFile(path.join(h.archive, manifest))).equals(bytes)).toBe(true);
                    expect((await manifestRecords()).length).toBe(records);
                    expect((await destinationTransitions(id)).length).toBe(transitions);
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 0, knownGaps: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 3 });
                });

                it("should write nothing once every verified artifact outside the snapshot is listed by a manifest on the archive", async () => {
                    await carried();
                    const before = (await listFiles(h.archive)).sort();
                    const records = (await manifestRecords()).length;

                    await runOnce(h);
                    await runOnce(h);

                    expect((await listFiles(h.archive)).filter((file) => !file.includes("/runs/") && !file.includes("/completions/")).sort())
                        .toEqual(before.filter((file) => !file.includes("/runs/") && !file.includes("/completions/")));
                    expect((await manifestRecords()).length).toBe(records);
                });

                it("should not fail on missing old history while every verified artifact is already indexed", async () => {
                    await carried();
                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h, { compactionThreshold: 1 });
                    await fs.rm(path.join(ledgerDir(), (await journals())[0]!));

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await manifestsOf("D001")).toHaveLength(1);
                });

                /** A normal publication interrupted after `verified`, before any manifest: an orphan whose only evidence is the old journal. */
                async function orphanWithHistoryOnDisk(): Promise<{ id: string; oldest: string; original: Buffer }> {
                    const d1 = singleDoc("D001");
                    h = await createHarness({ docs: [d1] });
                    await initArchive(h);
                    await expect(runOnce(h, { runnerFault: (point) => { if (point === "after-verified") throw new Error("old-order-orphan"); } })).rejects.toThrow("old-order-orphan");
                    const id = identityFor(h, d1, "document");
                    expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                    const away = await swapArchive(h);
                    h.api.docs = [];
                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h, { compactionThreshold: 1 });
                    await swapBack(h, away);
                    const oldest = path.join(ledgerDir(), (await journals())[0]!);
                    return { id, oldest, original: await fs.readFile(oldest) };
                }

                it.each(["corrupt", "missing"] as const)("should finish its other work and then end in ledger-inconsistent when the old journal is %s, then backfill once it is back", async (damage) => {
                    const { id, oldest, original } = await orphanWithHistoryOnDisk();
                    if (damage === "missing") await fs.rm(oldest);
                    else await fs.writeFile(oldest, original.toString("utf8").replace('"documentId":"D001"', '"documentId":"D009"'));
                    const transitions = (await destinationTransitions(id).catch(() => [])).length;
                    h.api.docs = [pairDoc("D002")];

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });

                    // The rest of the run was done and recorded; the verified entry was not touched.
                    expect(await archivePdfs(h.archive)).toHaveLength(3);
                    expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                    // (A missing journal takes its records with it, so only the intact case can show the entry's history.)
                    if (damage === "corrupt") {
                        expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                        expect((await destinationTransitions(id)).length).toBe(transitions);
                    }
                    const finished = (await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!;
                    expect(finished.body["reasonCodes"]).toContain("ledger-inconsistent");
                    expect(await manifestsOf("D001")).toEqual([]);

                    await fs.writeFile(oldest, original, { mode: 0o600 });
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await manifestsOf("D001")).toHaveLength(1);
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 3 });
                });
            });

            describe("indexing needs evidence, not a matching name (BJJ-455 P2 FU-10-F3)", () => {
                const manifestPath = async (doc: string): Promise<string> => path.join(h.archive, (await manifestsOf(doc))[0]!);
                const rewrite = async (file: string, change: (value: any) => void, pretty = false): Promise<Buffer> => {
                    const original = await fs.readFile(file);
                    const value = JSON.parse(original.toString("utf8"));
                    change(value);
                    await fs.writeFile(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
                    return original;
                };
                /**
                 * A schema-valid manifest with a wrong claim, well-named by its own digest and put NEXT to the good one (a name that
                 * carries the digest cannot be forged in place: it would just be a file that is no manifest). `undo` removes it.
                 */
                const forge = async (file: string, change: (value: any) => void): Promise<{ forged: string; bytes: Buffer; undo: () => Promise<void> }> => {
                    const value = JSON.parse(await fs.readFile(file, "utf8"));
                    change(value);
                    const bytes = Buffer.from(JSON.stringify(value));
                    const forged = path.join(path.dirname(file), `${path.basename(file).slice(0, 64)}-${createHash("sha256").update(bytes).digest("hex")}.json`);
                    await fs.writeFile(forged, bytes, { mode: 0o600 });
                    return { forged, bytes, undo: () => fs.rm(forged) };
                };
                /** What the release before FU-10-F5 left: manifests and completions under the metadata-only name. */
                const toLegacyNames = async (): Promise<void> => {
                    for (const name of await fs.readdir(path.join(h.archive, "eformsign", COMPANY))) {
                        if (name === "completions" || name === "runs") continue;
                        const dir = path.join(h.archive, "eformsign", COMPANY, name, "manifests");
                        for (const file of await fs.readdir(dir).catch(() => [] as string[])) {
                            if (file.includes("-")) await fs.rename(path.join(dir, file), path.join(dir, `${file.slice(0, 64)}.json`));
                        }
                    }
                    const directory = path.join(h.archive, "eformsign", COMPANY, "completions");
                    for (const old of await readCompletions(h.archive)) {
                        const value = old.value;
                        const built = buildCompletion({
                            companyId: value["companyId"], sequence: value["sequence"], snapshotId: value["snapshotId"], runId: value["runId"],
                            scopeRevision: value["scopeRevision"], policyRevision: value["policyRevision"], destinationIdentity: value["destinationIdentity"],
                            destinationRevision: value["destinationRevision"], gaps: value["gaps"],
                            entries: value["entries"].map((entry: { documentId: string; metadataRevision: string; manifestSha256: string }) => ({
                                documentId: entry.documentId, metadataRevision: entry.metadataRevision, manifestSha256: entry.manifestSha256,
                            })),
                        });
                        await fs.rm(path.join(directory, old.name));
                        await fs.writeFile(path.join(h.archive, built.relativeKey), built.bytes, { mode: 0o600 });
                    }
                };
                const state = async () => {
                    const ledger = await LedgerStore.open(h.control, { readOnly: true });
                    const value = ledger.state;
                    await ledger.close();
                    return value;
                };
                const dropOldestJournal = async (): Promise<void> => {
                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h, { compactionThreshold: 1 });
                    await fs.rm(path.join(ledgerDir(), (await journals())[0]!));
                };

                it("should end in archive-conflict, exit 69, keep the conflicting file and the verified entry, and still finish independent work", async () => {
                    const { id } = await carried();
                    const forgedFile = await forge(await manifestPath("D001"), (value) => { value.artifacts[0].byteLength += 1; });
                    const file = forgedFile.forged;
                    const tampered = forgedFile.bytes;
                    h.api.docs = [pairDoc("D002"), pairDoc("D003")];
                    const transitions = (await destinationTransitions(id)).length;

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                    expect(await archivePdfs(h.archive)).toHaveLength(5);
                    expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002", "D003"]);
                    expect((await fs.readFile(file)).equals(tampered)).toBe(true);
                    expect((await destinationTransitions(id)).length).toBe(transitions);
                    expect((await transitionPath(h.control, id)).slice(-1)).toEqual(["verified"]);
                    expect((await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!.body["reasonCodes"]).toContain("archive-conflict");
                    // Repeated, and through the real command: the same refusal, exit 69, the file untouched.
                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    const child = spawnUnderFlock(h, ["run", "--config", h.configPath]);
                    expect(await child.exited).toEqual({ code: 69, signal: null });
                    expect(child.stderr().trim()).toBe("archive-conflict");
                    expect((await fs.readFile(file)).equals(tampered)).toBe(true);

                    await forgedFile.undo();
                    h.clock.set(new Date(Date.now() + 60_000).toISOString());
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 5, unverified: 0 });
                    expect(await verifyAll()).toMatchObject({ checked: 5 });
                }, 180_000);

                it("should reject a well-named manifest with a different length when the history is gone, acknowledged or not", async () => {
                    await carried();
                    await dropOldestJournal();
                    const forgedFile = await forge(await manifestPath("D001"), (value) => { value.artifacts[0].byteLength += 1; });
                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    expect((await fs.readFile(forgedFile.forged)).equals(forgedFile.bytes)).toBe(true);
                    await forgedFile.undo();
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                });

                it.each([
                    ["a different digest", (value: any) => { value.artifacts[0].sha256 = "0".repeat(64); }],
                    ["a different type", (value: any) => { value.artifacts[0].artifactType = "audit-trail"; }],
                    ["a different key", (value: any) => { value.artifacts[0].relativeKey = value.artifacts[0].relativeKey.replace("/D001/", "/D777/"); }],
                ])("should reject a manifest file changed in place to %s: it is no manifest, so its artifact is unlisted and cannot be rebuilt", async (_name, change) => {
                    await carried();
                    await dropOldestJournal();
                    // Acknowledged by the ledger: the digest of the file is what counts.
                    const file = await manifestPath("D001");
                    const original = await rewrite(file, change);
                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                    await fs.writeFile(file, original);
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                });

                it("should accept a correct manifest the ledger never acknowledged when the history is gone, writing nothing", async () => {
                    const d1 = singleDoc("D001");
                    h = await createHarness({ docs: [d1] });
                    await initArchive(h);
                    await expect(runOnce(h, { runnerFault: (point) => { if (point === "after-verified") throw new Error("old-order-orphan"); } })).rejects.toThrow("old-order-orphan");
                    const observed = (await readLedgerRecords(h.control)).find((record) => record.type === "candidate_observed")!;
                    const expected = buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: observed.body["metadataRevision"] as string, artifacts: observed.body["artifacts"] as never });
                    const file = path.join(h.archive, manifestKey({ companyId: COMPANY, documentId: "D001", metadataRevision: observed.body["metadataRevision"] as string }));
                    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
                    await fs.writeFile(file, expected.bytes, { mode: 0o600 });
                    h.api.docs = [];
                    await dropOldestJournal();
                    h.api.docs = [pairDoc("D002")];
                    const records = (await manifestRecordsOf("D001")).length;

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    expect((await fs.readFile(file)).equals(expected.bytes)).toBe(true);
                    expect((await manifestRecordsOf("D001")).length).toBe(records);
                    // Wrong evidence is still wrong without an acknowledgement.
                    await rewrite(file, (value) => { value.artifacts[0].byteLength += 1; });
                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                });

                describe("after recover, when the ledger no longer knows the length", () => {
                    it("should accept the unchanged manifest and reject a length-only change, comparing sizes without reading any PDF", async () => {
                        const { id } = await carried();
                        expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3 });
                        expect((await state()).artifacts.get(id)!.byteLength).toBeNull();
                        h.api.docs = [pairDoc("D002")];
                        const reverify = jest.spyOn(LocalDestination.prototype, "reverify");
                        const sizes = jest.spyOn(LocalDestination.prototype, "artifactSize");
                        const reads = jest.spyOn(LocalDestination.prototype, "readArchiveFile");
                        try {
                            await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                            expect(sizes.mock.calls.some(([key]) => key.includes("/D001/"))).toBe(true);
                            expect(reverify.mock.calls.some(([key]) => key.includes("/D001/"))).toBe(false);
                            expect(reads.mock.calls.some(([key]) => key.endsWith(".pdf"))).toBe(false);
                        } finally {
                            jest.restoreAllMocks();
                        }

                        const forgedFile = await forge(await manifestPath("D001"), (value) => { value.artifacts[0].byteLength += 1; });
                        await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
                        await forgedFile.undo();
                        await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    });

                    it("should not accept a manifest that a completion names under other bytes, even when its facts are unchanged", async () => {
                        h = await createHarness({ docs: [singleDoc("D001")] });
                        await initArchive(h);
                        await runOnce(h);
                        // A name that carries the digest already refuses other bytes; the completion binding is what protects a legacy name.
                        await toLegacyNames();
                        expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 1 });
                        h.api.docs = [pairDoc("D002")];
                        const file = await manifestPath("D001");
                        expect(path.basename(file)).toMatch(/^[0-9a-f]{64}\.json$/);
                        const original = await rewrite(file, () => undefined, true);

                        await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                        await fs.writeFile(file, original);
                        await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                        expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 0 });
                    });
                });

                it("should accept two legitimate revisions that share an artifact, each against its own source", async () => {
                    h = await createHarness({ docs: [singleDoc("D001")] });
                    await initArchive(h);
                    await runOnce(h);
                    h.api.docs = [{ ...singleDoc("D001"), templateId: "T2" }];
                    await runOnce(h);
                    expect(await manifestsOf("D001")).toHaveLength(2);
                    h.api.docs = [pairDoc("D002")];
                    const records = (await manifestRecordsOf("D001")).length;

                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });

                    expect(await manifestsOf("D001")).toHaveLength(2);
                    expect((await manifestRecordsOf("D001")).length).toBe(records);
                    expect(await loseLedgerAndRecover()).toMatchObject({ unverified: 0 });
                });

                it("should keep a conflict visible when an earlier manifest of the document is wrong and a later one is right", async () => {
                    h = await createHarness({ docs: [singleDoc("D001")] });
                    await initArchive(h);
                    await runOnce(h);
                    h.api.docs = [{ ...singleDoc("D001"), templateId: "T2" }];
                    await runOnce(h);
                    h.api.docs = [pairDoc("D002")];
                    const files = (await manifestsOf("D001")).map((name) => path.join(h.archive, name)).sort();
                    const seen = await Promise.all(files.map((file) => fs.readFile(file)));
                    // Whichever revision sorts first is the one recovery meets first; give it a second, wrong claim.
                    const forgedFile = await forge(files[0]!, (value) => { value.artifacts[0].byteLength += 1; });

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                    expect((await fs.readFile(files[1]!)).equals(seen[1]!)).toBe(true);
                    expect((await fs.readFile(forgedFile.forged)).equals(forgedFile.bytes)).toBe(true);
                });

                it("should not let an identity listed by another document's manifest count as coverage", async () => {
                    h = await createHarness({ docs: [singleDoc("D001"), singleDoc("D002")] });
                    await initArchive(h);
                    const away = await swapArchive(h);
                    await runOnce(h);
                    await swapBack(h, away);
                    h.api.docs = [pairDoc("D003")];
                    await runOnce(h);
                    const first = await manifestPath("D001");
                    const second = await manifestPath("D002");
                    const donor = JSON.parse((await fs.readFile(first)).toString("utf8"));
                    const secondOriginal = await rewrite(second, (value) => { value.artifacts[0] = donor.artifacts[0]; });
                    const tampered = await fs.readFile(second);

                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

                    expect((await fs.readFile(second)).equals(tampered)).toBe(true);
                    await fs.writeFile(second, secondOriginal);
                    await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                });
            });

            describe("evidence that cannot authorize a publication", () => {
                const d1 = singleDoc("D001");
                /** D001 is staged and blocked; the ledger has been compacted twice so its observation lives only in the oldest journals. */
                async function stagedWithHistoryOnDisk(): Promise<{ id: string }> {
                    const { restore } = await stagedWhileArchiveIsGone(d1);
                    h.api.docs = [];
                    await runOnce(h, { compactionThreshold: 1 });
                    await runOnce(h, { compactionThreshold: 1 });
                    await restore();
                    const id = identityFor(h, d1, "document");
                    // Staged and blocked for the archive, not for missing bytes; the refusal below must leave it that way.
                    expect((await destinationTransitions(id)).pop()!.body["reasonCode"]).toBe("archive-unavailable");
                    return { id };
                }
                const refused = async (id: string): Promise<void> => {
                    await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
                    expect(await archivePdfs(h.archive)).toEqual([]);
                    expect(await manifestsOf("D001")).toEqual([]);
                    expect(await fs.stat(path.join(h.control, "staging", `${id}.bin`)).then((stat) => stat.isFile())).toBe(true);
                };

                it("should refuse, publishing nothing, when a retained journal has been damaged", async () => {
                    const { id } = await stagedWithHistoryOnDisk();
                    const oldest = path.join(ledgerDir(), (await journals())[0]!);
                    const text = (await fs.readFile(oldest, "utf8")).split("\n");
                    const index = text.findIndex((line) => line.includes('"candidate_observed"'));
                    text[index] = text[index]!.replace('"documentId":"D001"', '"documentId":"D009"');
                    await fs.writeFile(oldest, text.join("\n"));

                    await refused(id);
                });

                it("should refuse, publishing nothing, when an old journal is missing", async () => {
                    const { id } = await stagedWithHistoryOnDisk();
                    await fs.rm(path.join(ledgerDir(), (await journals())[0]!));

                    await refused(id);
                });

                it("should refuse, publishing nothing, when an old journal is a symlink", async () => {
                    const { id } = await stagedWithHistoryOnDisk();
                    const oldest = path.join(ledgerDir(), (await journals())[0]!);
                    const copy = path.join(h.base, "journal-copy");
                    await fs.copyFile(oldest, copy);
                    await fs.rm(oldest);
                    await fs.symlink(copy, oldest);

                    await refused(id);
                });

                it("should block the artifact as archive-conflict, publishing no PDF, when another manifest already sits at the key", async () => {
                    const { restore } = await stagedWhileArchiveIsGone(d1);
                    const id = identityFor(h, d1, "document");
                    const observed = (await readLedgerRecords(h.control)).find((record) => record.type === "candidate_observed")!;
                    await restore();
                    // The key is the manifest's own digest: other bytes sitting exactly there are what blocks it.
                    const expected = buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: observed.body["metadataRevision"] as string, artifacts: observed.body["artifacts"] as never });
                    const sitting = path.join(h.archive, manifestKey({
                        companyId: COMPANY, documentId: "D001", metadataRevision: observed.body["metadataRevision"] as string, manifestSha256: expected.sha256,
                    }));
                    await fs.mkdir(path.dirname(sitting), { recursive: true, mode: 0o700 });
                    await fs.writeFile(sitting, "{\"other\":true}\n", { mode: 0o600 });
                    h.api.docs = [];

                    const run = await runOnce(h);

                    expect(run.reasonCodes).toContain("archive-conflict");
                    expect(await archivePdfs(h.archive)).toEqual([]);
                    expect((await destinationTransitions(id)).pop()!.body).toMatchObject({ to: "blocked", reasonCode: "archive-conflict" });
                    expect(await fs.stat(path.join(h.control, "staging", `${id}.bin`)).then((stat) => stat.isFile())).toBe(true);
                });
            });
        });

        it("should settle a pending entry made by crash recovery as exact-bytes-unavailable once its document leaves the snapshot", async () => {
            const x = singleDoc("D001");
            h = await createHarness({ docs: [x, pairDoc("D002")] });
            await initArchive(h);
            const id = identityFor(h, x, "document");
            // Run 1 dies right after the transferring record: nothing is staged and the entry is left in flight.
            await expect(runOnce(h, { runnerFault: async (point) => {
                if (point === "after-transferring") throw new Error("simulated-crash");
            } })).rejects.toThrow("simulated-crash");
            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring"]);
            expect(await stagedBins()).toEqual([]);

            // Run 2: crash recovery requeues it (transferring -> retry_wait -> pending); X is no longer in the snapshot.
            h.api.docs = [pairDoc("D002")];
            const second = await runOnce(h);

            expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "retry_wait", "pending", "blocked"]);
            expect((await destinationTransitions(id)).pop()!.body).toMatchObject({ from: "pending", to: "blocked", reasonCode: "exact-bytes-unavailable" });
            expect(second.counts).toMatchObject({ retryWait: 0, blocked: 0, terminalUnavailable: 1 });
            expect(second.historicalCoverage).toBe("known_gap");
            expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "exact-bytes-unavailable" }]);
        });

        describe("blocked entries that must not be carried over", () => {
            const untouched = async (id: string, reasonCode: string, expectedGaps: unknown[], terminalUnavailable: number, omit: () => void, gapsWhileIncluded: unknown[] = expectedGaps): Promise<void> => {
                expect((await destinationTransitions(id)).pop()!.body["reasonCode"]).toBe(reasonCode);
                // Baseline BEFORE the document leaves the snapshot, so a transition made by that very run is seen.
                const before = await destinationTransitions(id);
                const gapsBefore = (await readCompletions(h.archive)).pop()!.value["gaps"];
                omit();

                for (let run = 0; run < 2; run++) {
                    const result = await runOnce(h);
                    expect(await destinationTransitions(id)).toEqual(before);
                    expect(result.counts).toMatchObject({ terminalUnavailable });
                    expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual(expectedGaps);
                }
                expect(gapsBefore).toEqual(gapsWhileIncluded);
            };

            it("should leave a source-removed entry untouched on the first run that omits it and on the next", async () => {
                const gone = pairDoc("D001");
                h = await createHarness({ docs: [gone, pairDoc("D002")] });
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
                await initArchive(h);
                const id = identityFor(h, gone, "audit_trail");
                await runOnce(h);

                await untouched(id, "source-removed", [{ documentId: "D001", reasonCode: "source-removed" }], 1, () => { h.api.docs = [pairDoc("D002")]; });
            });

            it("should leave an integrity-repeated entry untouched on the first run that omits it and on the next", async () => {
                const gone = singleDoc("D001");
                h = await createHarness({ docs: [gone, pairDoc("D002")] });
                const bad = Buffer.from(gone.artifacts![0]!.bytes);
                bad[10] = bad[10]! ^ 0xff;
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001", fault: { kind: "bytes", bytes: bad } });
                await initArchive(h);
                const id = identityFor(h, gone, "document");
                // Three integrity errors, then the fourth run blocks it for good.
                for (let run = 0; run < 4; run++) await runOnce(h);

                // While the snapshot still includes D001 its completion lists the omission (FU-13); once it leaves, there is nothing to list.
                await untouched(id, "integrity-repeated", [], 0, () => { h.api.docs = [pairDoc("D002")]; }, [{ documentId: "D001", reasonCode: "integrity-repeated" }]);
            });
        });
    });

    describe("a completion never drops an included document silently (BJJ-455 P2 FU-13 F1, M4)", () => {
        const gapsOf = async () => (await readCompletions(h.archive)).map((completion) => ({
            documents: completion.value["entries"].map((entry: { documentId: string }) => entry.documentId),
            gaps: completion.value["gaps"],
        }));
        const restoreLatest = async () => {
            const outDir = path.join(h.base, `restored-${Math.random().toString(36).slice(2)}`);
            try {
                return await restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { latest: true }, outDir });
            } finally {
                await fs.rm(outDir, { recursive: true, force: true });
            }
        };

        it("F1: should list an included, intact document whose bound manifest conflicts as an archive-conflict gap, exit 69 and report the gap on restore --latest", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
            await initArchive(h);
            await runOnce(h);
            expect(await gapsOf()).toEqual([{ documents: ["D001", "D002"], gaps: [] }]);
            const file = path.join(h.archive, (await listFiles(h.archive)).find((name) => name.includes("/D001/manifests/"))!);
            const damaged = JSON.parse(await fs.readFile(file, "utf8"));
            damaged.artifacts[0].byteLength += 1;
            await fs.writeFile(file, JSON.stringify(damaged));

            await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });

            expect(await gapsOf()).toEqual([
                { documents: ["D001", "D002"], gaps: [] },
                { documents: ["D002"], gaps: [{ documentId: "D001", reasonCode: "archive-conflict" }] },
            ]);
            const report = await restoreLatest();
            expect(report.documents.map((doc) => doc.documentId)).toEqual(["D002"]);
            expect(report.gaps).toEqual([{ documentId: "D001", reasonCode: "archive-conflict" }]);
        }, 240_000);

        it("M4: should list a document whose pair is incomplete as a gap with the reason the ledger holds, and drop the gap once the pair completes", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
            await initArchive(h);
            await runOnce(h);

            expect(await gapsOf()).toEqual([{ documents: ["D002"], gaps: [{ documentId: "D001", reasonCode: "export-unavailable" }] }]);
            const report = await restoreLatest();
            expect(report.gaps).toEqual([{ documentId: "D001", reasonCode: "export-unavailable" }]);

            h.api.clearFaults();
            h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
            await runOnce(h);
            expect((await gapsOf()).pop()).toEqual({ documents: ["D001", "D002"], gaps: [] });
        }, 240_000);

        describe("omission gaps stay truthful through recovery and cover every included document (BJJ-455 P2 FU-13-F1)", () => {
            const audit503 = () => h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 503, code: "EXPORT_UNAVAILABLE", retryable: true } });
            const loseLedgerAndRecover = async () => {
                const installationId = (await readJsonFile(path.join(h.archive, ".bjj-backup", "installation.json")))["installationId"];
                await fs.rm(path.join(h.control, "ledger"), { recursive: true });
                return withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
            };
            const restoreSelected = async (selector: { latest: true } | { snapshotId: string }) => {
                const outDir = path.join(h.base, `restored-${Math.random().toString(36).slice(2)}`);
                try {
                    return await restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector, outDir });
                } finally {
                    await fs.rm(outDir, { recursive: true, force: true });
                }
            };
            const heal = (): void => {
                h.api.clearFaults();
                h.clock.set(new Date(Date.now() + 3_600_000).toISOString());
            };

            it("should not turn a transient omission into a permanent known gap on recover, and a healthy run afterwards lists the document without a stale gap", async () => {
                h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
                audit503();
                await initArchive(h);
                await runOnce(h);
                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "export-unavailable" }]);

                expect(await loseLedgerAndRecover()).toMatchObject({ knownGaps: 0 });
                heal();
                const summary = await runOnce(h);

                const last = (await readCompletions(h.archive)).pop()!.value;
                expect(last["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001", "D002"]);
                expect(last["gaps"]).toEqual([]);
                expect(summary.historicalCoverage).toBe("unverified");
            }, 240_000);

            it("should not bring an old transient omission back when recover runs after a healthy completion", async () => {
                h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
                audit503();
                await initArchive(h);
                await runOnce(h);
                heal();
                await runOnce(h);
                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([]);

                expect(await loseLedgerAndRecover()).toMatchObject({ knownGaps: 0 });
                const summary = await runOnce(h);

                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([]);
                expect(summary.historicalCoverage).toBe("unverified");
            }, 240_000);

            it("should keep a permanent gap (the source removed the bytes) through recovery, as before", async () => {
                h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
                await initArchive(h);
                await runOnce(h);
                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);

                expect(await loseLedgerAndRecover()).toMatchObject({ knownGaps: 1 });
                const summary = await runOnce(h);

                expect(summary.historicalCoverage).toBe("known_gap");
                expect((await readCompletions(h.archive)).pop()!.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);
            }, 240_000);

            it("should publish a gap-only completion when every included document is omitted, and restore it (latest and by snapshot) with its gaps and no documents", async () => {
                h = await createHarness({ docs: [pairDoc("D002")] });
                await initArchive(h);
                await runOnce(h);
                h.api.docs = [pairDoc("D001")];
                audit503();

                await runOnce(h);

                const last = (await readCompletions(h.archive)).pop()!;
                expect(last.value["entries"]).toEqual([]);
                expect(last.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "export-unavailable" }]);
                const latest = await restoreSelected({ latest: true });
                expect(latest.documents).toEqual([]);
                expect(latest.gaps).toEqual([{ documentId: "D001", reasonCode: "export-unavailable" }]);
                const bySnapshot = await restoreSelected({ snapshotId: last.value["snapshotId"] });
                expect(bySnapshot.documents).toEqual([]);
                expect(bySnapshot.gaps).toEqual(latest.gaps);
            }, 240_000);

            it("should list an included document that has no artifacts at all as a gap (artifact-pending) next to a healthy one", async () => {
                h = await createHarness({ docs: [{ ...pairDoc("D001"), artifacts: [] }, pairDoc("D002")] });
                await initArchive(h);

                await runOnce(h);

                const last = (await readCompletions(h.archive)).pop()!.value;
                expect(last["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                expect(last["gaps"]).toEqual([{ documentId: "D001", reasonCode: "artifact-pending" }]);
                expect((await restoreSelected({ latest: true })).gaps).toEqual([{ documentId: "D001", reasonCode: "artifact-pending" }]);
            }, 240_000);
        });
    });

    describe("an older valid manifest variant is no conflict after archive-only recovery (BJJ-455 P2 FU-14)", () => {
        const loseLedgerAndRecover = async () => {
            const installationId = (await readJsonFile(path.join(h.archive, ".bjj-backup", "installation.json")))["installationId"];
            await fs.rm(path.join(h.control, "ledger"), { recursive: true });
            return withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
        };
        const manifestsOf = async (doc: string): Promise<string[]> => (await listFiles(h.archive)).filter((file) => file.includes(`/${doc}/manifests/`));
        /**
         * D001's audit trail is gone at the source in the first snapshot (a permanent gap, and an early manifest of the old set);
         * the second snapshot offers other bytes for both PDFs under the same metadata revision (a second, valid manifest).
         */
        async function changedClaimsThenLostLedger(): Promise<void> {
            h = await createHarness({ docs: [pairDoc("D001", "old"), pairDoc("D002")] });
            h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
            await initArchive(h);
            await runOnce(h);
            h.api.clearFaults();
            h.api.docs = [pairDoc("D001", "new"), pairDoc("D002")];
            await runOnce(h);
            expect(await manifestsOf("D001")).toHaveLength(2);
            await loseLedgerAndRecover();
        }

        it("should index both variants, keep the permanent gap and write nothing on a repeat run", async () => {
            await changedClaimsThenLostLedger();

            const summary = await runOnce(h);

            expect(summary.historicalCoverage).toBe("known_gap");
            const last = (await readCompletions(h.archive)).pop()!.value;
            expect(last["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001", "D002"]);
            expect(last["gaps"]).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);
            const before = await listFiles(h.archive);
            const manifests = (await manifestsOf("D001")).length;
            await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
            expect(await manifestsOf("D001")).toHaveLength(manifests);
            expect((await listFiles(h.archive)).filter((file) => !file.includes("/completions/") && !file.includes("/runs/")))
                .toEqual(before.filter((file) => !file.includes("/completions/") && !file.includes("/runs/")));
        }, 240_000);

        it("should still end in archive-conflict for an older variant whose length contradicts the recovered evidence", async () => {
            await changedClaimsThenLostLedger();
            const [first] = await manifestsOf("D001");
            const files = await manifestsOf("D001");
            const completion = (await readCompletions(h.archive)).pop()!.value["entries"].find((entry: { documentId: string }) => entry.documentId === "D001");
            const older = files.find((file) => file !== completion.manifestKey) ?? first!;
            const manifest = await readJsonFile(path.join(h.archive, older));
            // The old PDF of the document exists and was recovered; the old audit trail never did.
            (manifest["artifacts"] as Array<{ artifactType: string; byteLength: number }>).find((artifact) => artifact.artifactType === "document")!.byteLength += 1;
            const forged = Buffer.from(JSON.stringify(manifest));
            const forgedKey = older.replace(/-[0-9a-f]{64}\.json$/, `-${createHash("sha256").update(forged).digest("hex")}.json`);
            await fs.writeFile(path.join(h.archive, forgedKey), forged, { mode: 0o600 });

            await expect(runOnce(h)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
            expect((await fs.readFile(path.join(h.archive, forgedKey))).equals(forged)).toBe(true);
            await fs.rm(path.join(h.archive, forgedKey));
            await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
        }, 240_000);
    });

    describe("a manifest's artifact identities must derive from its own claims (BJJ-455 P2 FU-14-F1)", () => {
        const FAKE = "0".repeat(64);
        /** D001's manifest with its audit trail's identity replaced; the bundle and the file name are made consistent, so only the identity is false. */
        async function forgedSibling(legacy: boolean): Promise<{ key: string; bytes: Buffer }> {
            const original = (await listFiles(h.archive)).find((file) => file.includes("/D001/manifests/"))!;
            const manifest = await readJsonFile(path.join(h.archive, original));
            (manifest["artifacts"] as Array<{ artifactType: string; artifactIdentity: string }>).find((artifact) => artifact.artifactType === "audit-trail")!.artifactIdentity = FAKE;
            manifest["bundleId"] = bundleIdFor(manifest["companyId"] as string, manifest["documentId"] as string, manifest["metadataRevision"] as string, manifest["artifacts"] as never);
            const bytes = Buffer.from(JSON.stringify(manifest));
            const key = manifestKey({
                companyId: COMPANY, documentId: "D001", metadataRevision: manifest["metadataRevision"] as string,
                ...(legacy ? {} : { manifestSha256: createHash("sha256").update(bytes).digest("hex") }),
            });
            await fs.writeFile(path.join(h.archive, key), bytes, { mode: 0o600 });
            return { key, bytes };
        }
        const loseLedgerAndRecover = async () => {
            const installationId = (await readJsonFile(path.join(h.archive, ".bjj-backup", "installation.json")))["installationId"];
            await fs.rm(path.join(h.control, "ledger"), { recursive: true });
            return withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
        };

        it.each([["a versioned", false], ["a legacy", true]] as const)(
            "should treat %s manifest with a forged sibling identity as no manifest: no bogus recovered identity, verify --all checks the 4 real PDFs, later runs succeed",
            async (_name, legacy) => {
                h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
                await initArchive(h);
                await runOnce(h);
                const forged = await forgedSibling(legacy);
                h.api.docs = [pairDoc("D002")];

                await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                expect((await fs.readFile(path.join(h.archive, forged.key))).equals(forged.bytes)).toBe(true);

                expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 4 });
                const recovered = (await readLedgerRecords(h.control)).filter((record) => record.type === "recovered_verified").map((record) => record.body["artifactIdentity"]);
                expect(recovered).toHaveLength(4);
                expect(recovered).not.toContain(FAKE);
                await expect(withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }))).resolves.toMatchObject({ checked: 4, integrityErrors: 0 });
                await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
                await fs.rename(path.join(h.archive, forged.key), path.join(h.base, "forged-aside.json"));
                await expect(runOnce(h)).resolves.toMatchObject({ outcome: "finished" });
            }, 240_000);

        it("should refuse to restore a snapshot whose completion names a manifest with a forged identity (artifact-integrity)", async () => {
            h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
            await initArchive(h);
            await runOnce(h);
            const forged = await forgedSibling(false);
            const last = (await readCompletions(h.archive)).pop()!.value;
            const entries = last["entries"].map((entry: { documentId: string; metadataRevision: string; manifestKey: string; manifestSha256: string }) =>
                entry.documentId === "D001" ? { ...entry, manifestKey: forged.key, manifestSha256: createHash("sha256").update(forged.bytes).digest("hex") } : entry);
            const completion = buildCompletion({
                companyId: COMPANY, sequence: last["sequence"] + 1, snapshotId: "forged-snapshot", runId: last["runId"], scopeRevision: last["scopeRevision"],
                policyRevision: last["policyRevision"], destinationIdentity: last["destinationIdentity"], destinationRevision: last["destinationRevision"], entries, gaps: [],
            });
            await fs.writeFile(path.join(h.archive, completion.relativeKey), completion.bytes, { mode: 0o600 });
            const outDir = path.join(h.base, "restored-forged");

            await expect(restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { latest: true }, outDir })).rejects.toMatchObject({ reasonCode: "artifact-integrity" });
        }, 240_000);
    });

    describe("preconditions", () => {
        it("should refuse run before init with not-initialized", async () => {
            h = await createHarness({ docs: mix() });
            expect(await tryRun(h)).toMatchObject({ reasonCode: "not-initialized" });
            expect(h.api.requests).toHaveLength(0);
        });

        it("should refuse run with recovery-required when the archive marker names another installation, changing nothing", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            const marker = path.join(h.archive, ".bjj-backup", "installation.json");
            const body = await readJsonFile(marker);
            await fs.writeFile(marker, `${JSON.stringify({ ...body, installationId: "someone-else" })}\n`);
            const { treeSignature } = await import("./helpers/runner-support");
            const before = await treeSignature(h.control);

            const error = await tryRun(h);

            expect(error).toBeInstanceOf(WorkerError);
            expect(error).toMatchObject({ reasonCode: "recovery-required" });
            expect(await treeSignature(h.control)).toBe(before);
            expect(h.api.requests).toHaveLength(0);
        });

        it("should refuse a second init and an init over an existing .bjj-backup", async () => {
            h = await createHarness({ docs: mix() });
            await initArchive(h);
            await expect(initArchive(h)).rejects.toBeInstanceOf(WorkerError);
        });
    });
});
