import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { manualSelectionDigest, type ManualSelection } from "domain/eformsign-backup/worker/manual-protocol";
import { runWorkerCli, type WorkerEnvironment } from "infrastructure/eformsign-backup/worker/cli";
import { createRealFsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";
import type { ManualDeliveryBinding } from "infrastructure/eformsign-backup/worker/manual-delivery-store";
import {
    createHarness, destroyHarness, environmentFor, initArchive, lockedProbe, pdfOf, readLedgerRecords, rewriteConfig,
    runIdOf, sha256Of, treeSignature, TOKEN, type Harness,
} from "./helpers/runner-support";

describe("process-pending CLI with synthetic private store and loopback manual control", () => {
    let h: Harness;
    let server: Server | undefined;
    let stored: ManualDeliveryBinding[];
    let factory: NonNullable<WorkerEnvironment["manualBindingStoreFactory"]>;
    beforeEach(async () => {
        h = await createHarness({ startServer: false }); stored = [];
        factory = options => ({ list: async () => stored,
            put: async binding => { await options.beforeWrite(); stored.push(JSON.parse(JSON.stringify(binding))); },
            remove: async binding => { await options.beforeWrite(); stored = stored.filter(b => b.executionScope.attemptId !== binding.executionScope.attemptId); } });
    });
    afterEach(async () => {
        if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; }
        if (h) await destroyHarness(h);
    });
    async function cli(flags: string[] = [], extra: WorkerEnvironment = {}) {
        const stdout: string[] = [], stderr: string[] = [];
        const code = await runWorkerCli(["process-pending", "--config", h.configPath, ...flags], environmentFor(h, {
            manualBindingStoreFactory: factory, out: line => stdout.push(line), err: line => stderr.push(line), ...extra,
        }));
        return { code, stdout: stdout.map(line => JSON.parse(line) as Record<string, unknown>), stderr, raw: [...stdout, ...stderr].join("\n") };
    }
    async function control(mode: "normal" | "lost" | "empty" = "normal") {
        const bytes = [pdfOf("synthetic document"), pdfOf("synthetic audit")];
        const selection: ManualSelection = { jobId: runIdOf(900), companyId: h.config.companyId, branchId: runIdOf(901),
            scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
            candidates: [{ ordinal: 1, documentId: "fixed-document", classification: "included", reasons: [], statusType: "003", documentKind: "contract", metadataRevision: "a".repeat(64),
                artifacts: bytes.map((b, i) => ({ artifactType: i === 0 ? "document" as const : "audit-trail" as const,
                    artifactIdentity: artifactIdentity({ companyId: h.config.companyId, documentId: "fixed-document", artifactKind: i === 0 ? "document" : "audit-trail",
                        contentSha256: sha256Of(b), byteLength: b.length }), sha256: sha256Of(b), byteLength: b.length })) }] };
        const scope = { kind: "manual" as const, jobId: selection.jobId, companyId: selection.companyId, branchId: selection.branchId,
            attemptId: `${selection.jobId}.attempt-1`, selectionDigest: manualSelectionDigest(selection) };
        const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
        let claimed = false, documents = false, lost = false;
        server = createServer((request, response) => {
            void (async () => {
                expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`);
                const pieces: Buffer[] = []; for await (const part of request) pieces.push(Buffer.from(part));
                const body = JSON.parse(Buffer.concat(pieces).toString()) as Record<string, unknown>;
                const url = request.url!; requests.push({ url, body });
                const json = (value: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
                expect(url).toMatch(/^\/internal\/eformsign-backup\/v1\/manual-runs\//);
                if (url.endsWith("/claim")) {
                    if (mode === "empty" || claimed) return json(null);
                    claimed = true;
                    return json({ executionScope: scope, leaseToken: runIdOf(902), leaseDurationMs: 180000, leaseExpiresAt: "2000-01-01T00:00:00.000Z",
                        snapshot: { snapshotId: manualBackupSnapshotId(scope), status: "ready", companyId: scope.companyId,
                            scopeRevision: selection.scopeRevision, policyRevision: selection.policyRevision, createdAt: "2026-10-19T00:00:00.000Z", readyAt: "2026-10-19T00:00:00.000Z", expiresAt: null,
                            counts: { total: 1, included: 1, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0 },
                            coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false } });
                }
                expect(body["leaseToken"]).toBe(runIdOf(902)); expect(body["companyId"]).toBe(h.config.companyId);
                expect(url).toContain(`/${scope.jobId}/`);
                if (url.endsWith("/validate")) return json({ valid: true });
                if (url.endsWith("/candidates")) { expect(stored).toHaveLength(1); return json({ items: selection.candidates, nextCursor: null }); }
                if (url.endsWith("/renew")) return json({ leaseDurationMs: 180000, leaseExpiresAt: "2000-01-01T00:00:00.000Z" });
                if (url.endsWith("/artifact")) {
                    expect(body["documentId"]).toBe("fixed-document");
                    const index = selection.candidates[0]!.artifacts.findIndex(a => a.artifactIdentity === body["artifactIdentity"]);
                    expect(index).toBeGreaterThanOrEqual(0); const data = bytes[index]!, artifact = selection.candidates[0]!.artifacts[index]!;
                    response.writeHead(200, { "content-length": String(data.length), "x-artifact-identity": artifact.artifactIdentity, "x-content-sha256": artifact.sha256 });
                    response.end(data); return;
                }
                if (url.endsWith("/document-results")) { documents = true; return json({ accepted: true }); }
                if (url.endsWith("/finish")) {
                    if (!documents) return json({ code: "DOCUMENT_RESULTS_PENDING" }, 409);
                    if (mode === "lost" && !lost) { lost = true; response.destroy(); return; }
                    return json({ accepted: true });
                }
                return json({ code: "NOT_FOUND" }, 404);
            })().catch(() => { response.writeHead(500); response.end(); });
        });
        await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
        const address = server.address() as AddressInfo;
        await rewriteConfig(h, { exportBaseUrl: `http://127.0.0.1:${address.port}/internal/eformsign-backup/v1` });
        return { requests, scope };
    }
    it.each(["0", "21", "01", "+1", "1.0", "1e1", "1.5", "", "NaN"])("rejects noncanonical max-jobs %s before opening anything", async value => {
        const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
        const result = await cli(["--max-jobs", value], { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["config-invalid"] }); expect(fetchImpl).not.toHaveBeenCalled();
        expect(await fs.readdir(h.control)).toEqual(["worker.lock"]);
    });
    it.each([["--max-jobs"], ["--max-jobs", "1", "--max-jobs", "2"], ["--all"], ["--rebind"], ["--scheduled-for", "2026-10-19T00:00:00Z"], ["--unknown", "x"]])(
        "rejects missing/repeated/misplaced flags %j", async (...flags: string[]) => { expect(await cli(flags)).toMatchObject({ code: 78, stderr: ["config-invalid"] }); });
    it("rejects max-jobs on the ordinary command", async () => {
        const err: string[] = []; expect(await runWorkerCli(["run", "--config", h.configPath, "--max-jobs", "1"], { err: line => err.push(line) })).toBe(78);
        expect(err).toEqual(["config-invalid"]);
    });
    it("disabled has no lock/token/ledger/store/network/archive effect, while config remains strict", async () => {
        await rewriteConfig(h, { enabled: false }); await fs.rm(h.tokenPath); await fs.rm(h.lockPath);
        const create = jest.fn(factory), fetchImpl = jest.fn();
        expect(await cli([], { manualBindingStoreFactory: create, fetchImpl })).toMatchObject({ code: 0, stdout: [{ event: "disabled" }], stderr: [] });
        expect(create).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled(); expect(await fs.readdir(h.control)).toEqual([]);
        const config = JSON.parse(await fs.readFile(h.configPath, "utf8")); config.unknown = true; await fs.writeFile(h.configPath, JSON.stringify(config));
        expect(await cli()).toMatchObject({ code: 78, stderr: ["config-invalid"] });
    });
    it("proves the lock before reading an invalid token or opening store/ledger/network", async () => {
        await fs.rm(h.tokenPath); const create = jest.fn(factory), fetchImpl = jest.fn();
        expect(await cli([], { probe: createRealFsProbe(), manualBindingStoreFactory: create, fetchImpl })).toMatchObject({ code: 78, stdout: [], stderr: ["lock-not-held"] });
        expect(create).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled(); expect(await fs.readdir(h.control)).toEqual(["worker.lock"]);
    });
    it("refuses invalid token permissions before a claim", async () => {
        await initArchive(h); await fs.chmod(h.tokenPath, 0o644); const fetchImpl = jest.fn();
        expect(await cli([], { fetchImpl })).toMatchObject({ code: 78, stderr: ["token-file-invalid"] }); expect(fetchImpl).not.toHaveBeenCalled();
    });
    it("uses the production store by default: Linux exercises it, other platforms refuse before claim", async () => {
        await initArchive(h); const fake = await control("empty");
        const result = await cli([], { manualBindingStoreFactory: undefined });
        if (process.platform === "linux") expect(result).toMatchObject({ code: 0, stdout: [{ event: "manual_runs_processed", counts: { claimed: 0, acknowledged: 0, pending: 0, rejected: 0 } }] });
        else { expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["unsupported-filesystem"] }); expect(fake.requests).toHaveLength(0); }
    });
    it("no pending backend job performs no archive work", async () => {
        await initArchive(h); const fake = await control("empty"); const before = await treeSignature(h.archive);
        expect(await cli(["--max-jobs", "20"])).toMatchObject({ code: 0, stdout: [{ event: "manual_runs_processed", counts: { claimed: 0, acknowledged: 0, pending: 0, rejected: 0 } }] });
        expect(fake.requests.map(r => r.url.split("/").at(-1))).toEqual(["claim"]); expect(await treeSignature(h.archive)).toBe(before);
    });
    it("connects real C2/C1 to manual transport, fixed source and private binding without public capability leaks", async () => {
        await initArchive(h); const fake = await control(); const result = await cli();
        expect(result).toMatchObject({ code: 0, stderr: [], stdout: [{ event: "manual_runs_processed", counts: { claimed: 1, acknowledged: 1, pending: 0, rejected: 0 } }] });
        expect(stored).toEqual([]);
        expect(fake.requests.filter(r => r.url.endsWith("/artifact"))).toHaveLength(2);
        const journal = await readLedgerRecords(h.control);
        expect(journal.filter(r => r.type === "manual_result_acknowledged")).toHaveLength(1);
        const payload = journal.find(r => r.type === "manual_result_ready")!.body["payload"] as { runId: string; scope: { jobId: string } };
        expect(payload.scope.jobId).toBe(fake.scope.jobId); expect(payload.runId).not.toBe(fake.scope.jobId);
        for (const forbidden of [TOKEN, runIdOf(902), h.base, "leaseToken", "credentialFingerprint", "destinationIdentity"]) {
            expect(result.raw).not.toContain(forbidden);
            if (forbidden !== "destinationIdentity") expect(JSON.stringify(journal)).not.toContain(forbidden);
        }
        const endpoints = fake.requests.map(r => r.url.split("/").at(-1));
        const finish = endpoints.indexOf("finish"); expect(endpoints.slice(finish, finish + 3)).toEqual(["finish", "renew", "document-results"]);
    });
    it("replays an accepted lost finish with no renewal/new claim/source on the next invocation", async () => {
        await initArchive(h); const fake = await control("lost");
        expect(await cli(["--max-jobs", "20"])).toMatchObject({ code: 0, stdout: [{ event: "manual_runs_processed", counts: { claimed: 1, acknowledged: 0, pending: 1, rejected: 0 } }] });
        expect(stored).toHaveLength(1); const before = fake.requests.length;
        const original = fake.requests.filter(r => r.url.endsWith("/finish")).at(-1)!.body;
        expect(await cli()).toMatchObject({ code: 0, stdout: [{ event: "manual_runs_processed", counts: { claimed: 0, acknowledged: 1, pending: 0, rejected: 0 } }] });
        expect(fake.requests.slice(before).map(r => r.url.split("/").at(-1))).toEqual(["finish"]);
        expect(fake.requests.at(-1)!.body).toEqual(original); expect(stored).toEqual([]);
    });
    it("rechecks lock after durable binding and prevents page/engine effects on loss", async () => {
        await initArchive(h); const fake = await control(); let lost = false; const probe = lockedProbe(h.lockPath);
        const wrapped: typeof factory = options => { const port = factory(options); return { ...port, put: async binding => { await port.put(binding); lost = true; } }; };
        const result = await cli([], { manualBindingStoreFactory: wrapped, probe: { ...probe, readProcLocks: () => lost ? Promise.resolve("") : probe.readProcLocks() } });
        expect(result.code).not.toBe(0); expect(stored).toHaveLength(1);
        expect(fake.requests.map(r => r.url.split("/").at(-1))).toEqual(["claim"]);
        expect((await readLedgerRecords(h.control)).some(r => r.type === "run_started")).toBe(false);
    });
});
