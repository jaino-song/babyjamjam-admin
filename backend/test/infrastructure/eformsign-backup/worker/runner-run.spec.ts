import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";

import type { FixtureDoc } from "./helpers/fake-export-api";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
import {
    COMPANY, TOKEN, archivePdfs, createHarness, destinationStates, destroyHarness, identityFor, initArchive, listFiles,
    pairDoc, readCompletions, readJsonFile, readLedgerRecords, recordTypes, runOnce, singleDoc, transitionPath, treeContains,
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
            expect(await readCompletions(h.archive)).toHaveLength(0);

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

            it("should write the missing manifest of an already-verified artifact whose document left the snapshot, without a destination transition", async () => {
                // The audit trail is gone at the source for good, so the document's own PDF is verified but its revision never got a manifest.
                const gone = pairDoc("D001");
                h = await createHarness({ docs: [gone, pairDoc("D002")] });
                h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
                await initArchive(h);
                const id = identityFor(h, gone, "document");
                await runOnce(h);
                expect(await manifestsOf("D001")).toEqual([]);
                const transitions = (await destinationTransitions(id)).length;
                h.api.docs = [pairDoc("D002")];

                await runOnce(h);

                expect(await manifestsOf("D001")).toHaveLength(1);
                expect((await destinationTransitions(id)).length).toBe(transitions);
                expect((await readCompletions(h.archive)).pop()!.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
                const records = (await manifestRecords()).length;
                await runOnce(h);
                expect(await manifestsOf("D001")).toHaveLength(1);
                expect((await manifestRecords()).length).toBe(records);
                expect(await loseLedgerAndRecover()).toMatchObject({ recovered: 3, unverified: 1 });
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
                    await fs.mkdir(path.join(h.archive, "eformsign", COMPANY, "D001", "manifests"), { recursive: true, mode: 0o700 });
                    await fs.writeFile(path.join(h.archive, "eformsign", COMPANY, "D001", "manifests", `${observed.body["metadataRevision"]}.json`), "{\"other\":true}\n", { mode: 0o600 });
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
            const untouched = async (id: string, reasonCode: string, expectedGaps: unknown[], terminalUnavailable: number, omit: () => void): Promise<void> => {
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
                expect(gapsBefore).toEqual(expectedGaps);
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

                await untouched(id, "integrity-repeated", [], 0, () => { h.api.docs = [pairDoc("D002")]; });
            });
        });
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
