import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import {
    manualSelectionDigest, manualDocumentResultDigest, buildManualAggregateResult, manualAggregateResultDigest,
    ledgerStateToJson, type ManualSelectedCandidate, type ManualExecutionScope, type ManualDocumentResult,
} from "domain/eformsign-backup/worker";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { decodeCheckpoint } from "infrastructure/eformsign-backup/worker/ledger-checkpoint";
import { INSTALL_PARAMS, INSTALL_AT, testMarkerWriter } from "./helpers/ledger-fixtures";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (c: string) => c.repeat(64);
const at = INSTALL_AT;
const runId = id(3);
let root: string;
let counter = 0;
beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "manual-ledger-C1-")));
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function controlDirectory() {
    const dir = path.join(root, `control-${++counter}`);
    await fs.mkdir(dir, { mode: 0o700 });
    return dir;
}
async function seed(control: string) {
    const store = await LedgerStore.open(control, { writeMarker: testMarkerWriter });
    try {
        await store.initialize(INSTALL_PARAMS);
        const candidate: ManualSelectedCandidate = { ordinal: 1, documentId: "doc-1", classification: "included", reasons: [],
            statusType: "003", documentKind: "contract", metadataRevision: h("a"), artifacts: [
                { artifactType: "document", artifactIdentity: h("b"), sha256: h("c"), byteLength: 100 },
                { artifactType: "audit-trail", artifactIdentity: h("d"), sha256: h("e"), byteLength: 10 },
            ] };
        const selection = { jobId: id(1), companyId: "company-1", branchId: id(2), scopeRevision: "scope-v1", policyRevision: "policy-v1", candidates: [candidate] };
        const scope: ManualExecutionScope = { kind: "manual", jobId: id(1), attemptId: `${id(1)}.attempt-1`, companyId: "company-1", branchId: id(2), selectionDigest: manualSelectionDigest(selection) };
        await store.append("run_started", { runId, scheduledFor: null, startedAt: at, executionScope: scope }, at);
        await store.append("manual_candidate_selected", { runId, candidate }, at);
        await store.append("manual_selection_ready", { runId, scopeRevision: "scope-v1", policyRevision: "policy-v1", candidateCount: 1, selectionDigest: scope.selectionDigest }, at);
        const observation: ManualDocumentResult["local"] = { destinationIdentity: "local-1", destinationRevision: "rev-1", state: "verified", manifestStatus: "verified",
            artifacts: candidate.artifacts.map((a) => ({ artifactIdentity: a.artifactIdentity, state: "verified", reasonCode: null })), reasons: [] };
        const result: ManualDocumentResult = { receiptId: id(4), runId, scope, documentId: "doc-1", classification: "included", expectedArtifactIdentities: [h("b"), h("d")],
            observedAtSequence: 4, local: observation, drive: { ...observation, state: "blocked", manifestStatus: "blocked", artifacts: [], reasons: ["drive-permission"] }, reasons: [] };
        await store.append("manual_document_result", { payload: result, digest: manualDocumentResultDigest(result) }, at);
        const aggregate = buildManualAggregateResult({ receiptId: id(5), runId, scope, selection, results: [result], status: "partial", reasons: [] });
        const body = { payload: aggregate, digest: manualAggregateResultDigest(aggregate) };
        await store.append("manual_result_ready", body, at);
        await store.append("run_finished", { runId, finishedAt: at, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [],
            counts: { candidates: 1, included: 1, verified: 1, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0, driveVerified: 0, driveBlocked: 1, driveRetryWait: 0, driveIntegrityError: 0 } }, at);
        return { store, callback: { runId, receiptId: id(5), digest: body.digest } };
    } catch (error) { await store.close(); throw error; }
}

it.each(["acknowledged", "rejected"] as const)("replays pending callback, compacts and reopens %s after finished", async (delivery) => {
    const control = await controlDirectory();
    const seeded = await seed(control);
    let store = seeded.store;
    try {
        const pending = ledgerStateToJson(store.state);
        expect(store.state.manualAttempts!.get(runId)!.delivery).toBe("pending");
        expect(await store.compactIfNeeded(1)).toBe(true);
        await store.close();
        store = await LedgerStore.open(control);
        expect(store.status).toBe("ok");
        expect(ledgerStateToJson(store.state)).toEqual(pending);
        expect(store.state.runs.get(runId)!.status).toBe("finished");
        // A lost HTTP response leaves the aggregate immutable and pending until explicit acknowledgement.
        if (delivery === "acknowledged") {
            await store.append("manual_result_acknowledged", seeded.callback, at);
            await store.append("manual_result_acknowledged", seeded.callback, at);
        } else {
            await store.append("manual_result_rejected", { ...seeded.callback, reason: "lease-lost" }, at);
            await store.append("manual_result_rejected", { ...seeded.callback, reason: "lease-lost" }, at);
            await expect(store.append("manual_result_acknowledged", seeded.callback, at)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
        }
        const delivered = ledgerStateToJson(store.state);
        await store.close();
        store = await LedgerStore.open(control);
        expect(store.status).toBe("ok");
        expect(ledgerStateToJson(store.state)).toEqual(delivered);
        expect(await store.compactIfNeeded(1)).toBe(true);
        await store.close();
        store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(ledgerStateToJson(store.state)).toEqual(delivered);
        expect(store.state.manualAttempts!.get(runId)).toMatchObject({ delivery, rejectionReason: delivery === "rejected" ? "lease-lost" : null });
        expect(store.state.manualAttempts!.get(runId)!.aggregate!.payload.counts)
            .toEqual({ selected: 1, localVerified: 1, driveVerified: 0, metadataOnly: 0, attention: 1 });
    } finally { await store.close(); }
});

it("rejects invalid append without journal or state mutation, then reopens pending from journal", async () => {
    const control = await controlDirectory();
    const seeded = await seed(control);
    let store = seeded.store;
    try {
        const journal = path.join(control, "ledger", "journal-000000000001.jsonl");
        const bytes = await fs.readFile(journal);
        const before = ledgerStateToJson(store.state);
        await expect(store.append("manual_result_acknowledged", { ...seeded.callback, digest: h("f") }, at)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
        expect(await fs.readFile(journal)).toEqual(bytes);
        expect(ledgerStateToJson(store.state)).toEqual(before);
        await store.close();
        store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(ledgerStateToJson(store.state)).toEqual(before);
        expect(store.state.manualAttempts!.get(runId)!.delivery).toBe("pending");
    } finally { await store.close(); }
});

it("compacts a selection and immutable receipts beyond both old checkpoint limits, reopens pending and ACKs", async () => {
    const control = await controlDirectory();
    let store = await LedgerStore.open(control, { writeMarker: testMarkerWriter });
    try {
        await store.initialize(INSTALL_PARAMS);
        const reasons = Array.from({ length: 64 }, (_, n) => `reason-${String(n).padStart(3, "0")}-synthetic`);
        const candidates: ManualSelectedCandidate[] = Array.from({ length: 400 }, (_, n) => ({
            ordinal: n + 1, documentId: `doc-${n + 1}`, classification: "included", reasons,
            statusType: "003", documentKind: "contract", metadataRevision: h("a"), artifacts: [
                { artifactType: "document", artifactIdentity: h("b"), sha256: h("c"), byteLength: 100 },
                { artifactType: "audit-trail", artifactIdentity: h("d"), sha256: h("e"), byteLength: 10 },
            ],
        }));
        const selection = { jobId: id(1), companyId: "company-1", branchId: id(2), scopeRevision: "scope-v1", policyRevision: "policy-v1", candidates };
        const scope: ManualExecutionScope = { kind: "manual", jobId: id(1), attemptId: `${id(1)}.attempt-1`, companyId: "company-1", branchId: id(2), selectionDigest: manualSelectionDigest(selection) };
        await store.append("run_started", { runId, scheduledFor: null, startedAt: at, executionScope: scope }, at);
        for (const candidate of candidates) await store.append("manual_candidate_selected", { runId, candidate }, at);
        await store.append("manual_selection_ready", { runId, scopeRevision: "scope-v1", policyRevision: "policy-v1", candidateCount: candidates.length, selectionDigest: scope.selectionDigest }, at);
        const results: ManualDocumentResult[] = [];
        for (const candidate of candidates) {
            const observation: ManualDocumentResult["local"] = { destinationIdentity: "local-1", destinationRevision: "rev-1", state: "verified", manifestStatus: "verified",
                artifacts: candidate.artifacts.map((a) => ({ artifactIdentity: a.artifactIdentity, state: "verified", reasonCode: null })), reasons };
            const result: ManualDocumentResult = { receiptId: id(candidate.ordinal + 100), runId, scope,
                documentId: candidate.documentId, classification: "included", expectedArtifactIdentities: [h("b"), h("d")],
                observedAtSequence: store.state.lastSeq, local: observation,
                drive: { ...observation, destinationIdentity: "drive-1", state: "blocked", manifestStatus: "blocked", artifacts: [] }, reasons };
            results.push(result);
            await store.append("manual_document_result", { payload: result, digest: manualDocumentResultDigest(result) }, at);
        }
        const payload = buildManualAggregateResult({ receiptId: id(6), runId, scope, selection, results, status: "partial", reasons: [] });
        const digest = manualAggregateResultDigest(payload);
        await store.append("manual_result_ready", { payload, digest }, at);
        const before = ledgerStateToJson(store.state);
        const countNodes = (value: unknown): number => 1 + (value !== null && typeof value === "object"
            ? Object.values(value).reduce<number>((count, child) => count + countNodes(child), 0) : 0);
        expect(countNodes(before)).toBeGreaterThan(100_000);
        expect(Buffer.byteLength(JSON.stringify(before))).toBeGreaterThan(1_048_576);
        expect(() => canonicalJson(before)).toThrow("Invalid evidence");
        expect(await store.compactIfNeeded(1)).toBe(true);
        const checkpoint = await fs.readFile(path.join(control, "ledger", "checkpoint.json"));
        expect(ledgerStateToJson(decodeCheckpoint(checkpoint)!)).toEqual(before);
        const corrupted = JSON.parse(checkpoint.toString());
        corrupted.state.manualAttempts[0].results[0].payload.reasons = ["corrupted"];
        expect(decodeCheckpoint(Buffer.from(JSON.stringify(corrupted)))).toBeNull();
        await store.close();
        store = await LedgerStore.open(control);
        expect(store.status).toBe("ok");
        expect(ledgerStateToJson(store.state)).toEqual(before);
        expect(store.state.manualAttempts!.get(runId)!.delivery).toBe("pending");
        await store.append("manual_result_acknowledged", { runId, receiptId: payload.receiptId, digest }, at);
        expect(await store.compactIfNeeded(0)).toBe(true);
        await store.close();
        store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        const attempt = store.state.manualAttempts!.get(runId)!;
        expect(attempt.delivery).toBe("acknowledged");
        expect(attempt.candidates.size).toBe(400);
        expect([...attempt.results.values()].map((entry) => entry.payload)).toEqual(results);
        expect(attempt.aggregate).toEqual({ payload, digest });
    } finally { await store.close(); }
}, 120_000);
