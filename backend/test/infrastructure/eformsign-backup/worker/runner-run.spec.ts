import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";

import type { FixtureDoc } from "./helpers/fake-export-api";
import {
    COMPANY, TOKEN, archivePdfs, createHarness, destinationStates, destroyHarness, identityFor, initArchive, listFiles,
    pairDoc, readCompletions, readJsonFile, readLedgerRecords, recordTypes, runOnce, singleDoc, transitionPath, treeContains,
    tryRun, type Harness,
} from "./helpers/runner-support";

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
