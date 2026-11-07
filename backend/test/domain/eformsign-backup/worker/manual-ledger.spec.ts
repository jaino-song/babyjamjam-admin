import {
    applyLedgerRecord, emptyLedgerState, ledgerStateFromJson, ledgerStateToJson, encodeLedgerLine, decodeLedgerLine,
    manualSelectionDigest, manualDocumentResultDigest, manualAggregateResultDigest, buildManualAggregateResult,
    type LedgerState, type LedgerBodies, type LedgerRecord, type LedgerRecordType, type ManualSelectedCandidate,
    type ManualExecutionScope, type ManualDocumentResult, type ManualAggregateResult,
} from "domain/eformsign-backup/worker";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (c: string) => c.repeat(64);
const at = "2026-11-06T00:00:00Z";
const runId = id(3);
const candidate: ManualSelectedCandidate = { ordinal: 1, documentId: "doc-1", classification: "included", reasons: [],
    statusType: "003", documentKind: "contract", metadataRevision: h("a"), artifacts: [
        { artifactType: "document", artifactIdentity: h("b"), sha256: h("c"), byteLength: 100 },
        { artifactType: "audit-trail", artifactIdentity: h("d"), sha256: h("e"), byteLength: 20 },
    ] };
function fixture(candidates = [candidate]) {
    const selection = { jobId: id(1), companyId: "company-1", branchId: id(2), scopeRevision: "scope-v1", policyRevision: "policy-v1", candidates };
    const scope: ManualExecutionScope = { kind: "manual", jobId: id(1), attemptId: `${id(1)}.attempt-1`, companyId: "company-1", branchId: id(2), selectionDigest: manualSelectionDigest(selection) };
    const ready = { runId, scopeRevision: "scope-v1", policyRevision: "policy-v1", candidateCount: candidates.length, selectionDigest: scope.selectionDigest };
    const local: ManualDocumentResult["local"] = { destinationIdentity: "local-1", destinationRevision: "rev-1", state: "verified", manifestStatus: "verified",
        artifacts: candidate.artifacts.map((a) => ({ artifactIdentity: a.artifactIdentity, state: "verified", reasonCode: null })), reasons: [] };
    const result: ManualDocumentResult = { receiptId: id(4), runId, scope, documentId: candidate.documentId,
        classification: "included", expectedArtifactIdentities: [h("b"), h("d")], observedAtSequence: 4, local, drive: { ...local, destinationIdentity: "drive-1" }, reasons: [] };
    return { selection, scope, ready, result };
}
function append<T extends LedgerRecordType>(state: LedgerState, type: T, body: LedgerBodies[T]): LedgerState {
    const record = { v: 1, seq: state.lastSeq + 1, at, type, body } as LedgerRecord;
    const decoded = decodeLedgerLine(encodeLedgerLine(record));
    if (!decoded.ok) throw new Error("fixture-codec");
    return applyLedgerRecord(state, decoded.record);
}
function started(f = fixture()): LedgerState {
    let state = append(emptyLedgerState(), "installed", { installationId: "installation-1", archiveId: "archive-1", archiveDev: 1, archiveIno: 2, destinationIdentity: "local-1", destinationRevision: "rev-1" });
    state = append(state, "run_started", { runId, scheduledFor: null, startedAt: at, executionScope: f.scope });
    return state;
}
function selected(f = fixture()): LedgerState {
    let state = started(f);
    for (const c of f.selection.candidates) state = append(state, "manual_candidate_selected", { runId, candidate: c });
    return append(state, "manual_selection_ready", f.ready);
}
const documentBody = (payload: ManualDocumentResult) => ({ payload, digest: manualDocumentResultDigest(payload) });
const aggregateBody = (payload: ManualAggregateResult) => ({ payload, digest: manualAggregateResultDigest(payload) });
function aggregated() {
    const f = fixture();
    let state = append(selected(f), "manual_document_result", documentBody(f.result));
    const aggregate = buildManualAggregateResult({ receiptId: id(5), runId, scope: f.scope, selection: f.selection, results: [f.result], status: "partial", reasons: [] });
    const body = aggregateBody(aggregate);
    state = append(state, "manual_result_ready", body);
    return { state, body, f, callback: { runId, receiptId: id(5), digest: body.digest } };
}
const finishBody: LedgerBodies["run_finished"] = { runId, finishedAt: at, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [],
    counts: { candidates: 1, included: 1, verified: 1, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0, driveVerified: 1, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 } };
function rejected<T extends LedgerRecordType>(state: LedgerState, type: T, body: LedgerBodies[T]) {
    const before = ledgerStateToJson(state);
    expect(() => append(state, type, body)).toThrow("ledger-inconsistent");
    expect(ledgerStateToJson(state)).toEqual(before);
}

it("accepts the six manual records, identical replay, pending callback retry and ACK after finish", () => {
    const { f } = aggregated();
    let state = selected(f);
    state = append(state, "manual_candidate_selected", { runId, candidate });
    state = append(state, "manual_selection_ready", f.ready);
    state = append(state, "manual_document_result", documentBody(f.result));
    state = append(state, "manual_document_result", documentBody(f.result));
    const { body, callback } = aggregated();
    state = append(state, "manual_result_ready", body);
    state = append(state, "manual_result_ready", body);
    expect(state.manualAttempts!.get(runId)!.delivery).toBe("pending");
    state = append(state, "run_finished", finishBody);
    state = append(state, "manual_result_acknowledged", callback);
    state = append(state, "manual_result_acknowledged", callback);
    expect(state.lastSeq).toBe(13);
    expect(state.manualAttempts!.get(runId)!.delivery).toBe("acknowledged");
    expect(ledgerStateToJson(ledgerStateFromJson(ledgerStateToJson(state)))).toEqual(ledgerStateToJson(state));
    rejected(state, "manual_result_rejected", { ...callback, reason: "conflict" });
});

it("records rejection independently, replays it, forbids ACK and altered callback identities", () => {
    const { state, callback } = aggregated();
    const finished = append(state, "run_finished", finishBody);
    let next = append(finished, "manual_result_rejected", { ...callback, reason: "lease-lost" });
    next = append(next, "manual_result_rejected", { ...callback, reason: "lease-lost" });
    expect(next.manualAttempts!.get(runId)).toMatchObject({ delivery: "rejected", rejectionReason: "lease-lost" });
    rejected(next, "manual_result_acknowledged", callback);
    rejected(next, "manual_result_rejected", { ...callback, reason: "not-found" });
    rejected(state, "manual_result_acknowledged", { ...callback, receiptId: id(9) });
    rejected(state, "manual_result_acknowledged", { ...callback, digest: h("f") });
    rejected(state, "manual_result_acknowledged", { ...callback, runId: id(9) });
});

it("rejects missing ready, duplicate/conflicting candidates, changed ready and post-ready additions", () => {
    const f = fixture();
    let state = started(f);
    rejected(state, "manual_document_result", documentBody(f.result));
    rejected(state, "manual_selection_ready", f.ready);
    rejected(state, "manual_candidate_selected", { runId: id(9), candidate });
    state = append(state, "manual_candidate_selected", { runId, candidate });
    rejected(state, "manual_candidate_selected", { runId, candidate: { ...candidate, documentId: "other" } });
    rejected(state, "manual_candidate_selected", { runId, candidate: { ...candidate, ordinal: 2 } });
    rejected(state, "manual_selection_ready", { ...f.ready, candidateCount: 2 });
    rejected(state, "manual_selection_ready", { ...f.ready, policyRevision: "other" });
    rejected(state, "manual_selection_ready", { ...f.ready, selectionDigest: h("f") });
    state = append(state, "manual_selection_ready", f.ready);
    rejected(state, "manual_selection_ready", { ...f.ready, scopeRevision: "other" });
    rejected(state, "manual_candidate_selected", { runId, candidate: { ...candidate, ordinal: 2, documentId: "other" } });
    rejected(state, "manual_candidate_selected", { runId, candidate: { ...candidate, reasons: ["changed"] } });
});

it("requires a manual run and blocks new immutable records after finish", () => {
    const f = fixture();
    let state = started();
    state = append(state, "run_started", { runId: id(9), scheduledFor: null, startedAt: at });
    rejected(state, "manual_candidate_selected", { runId: id(9), candidate });
    const done = aggregated();
    state = append(done.state, "run_finished", finishBody);
    rejected(state, "manual_candidate_selected", { runId, candidate });
    rejected(state, "manual_selection_ready", f.ready);
    rejected(state, "manual_document_result", documentBody(f.result));
    rejected(state, "manual_result_ready", done.body);
});

it("rejects cross-run/scope, unknown document, future observation, digest and receipt conflicts without mutation", () => {
    const f = fixture();
    let state = selected(f);
    for (const change of [{ runId: id(9) }, { scope: { ...f.scope, companyId: "other" } },
        { scope: { ...f.scope, branchId: id(9) } }, { scope: { ...f.scope, attemptId: `${id(1)}.attempt-2` } },
        { scope: { ...f.scope, jobId: id(9), attemptId: `${id(9)}.attempt-1` } },
        { scope: { ...f.scope, selectionDigest: h("f") } }, { documentId: "other" }, { observedAtSequence: 5 },
        { classification: "policy_pending" as const }, { expectedArtifactIdentities: [h("b")] }]) {
        rejected(state, "manual_document_result", documentBody({ ...f.result, ...change }));
    }
    rejected(state, "manual_document_result", { payload: f.result, digest: h("f") });
    state = append(state, "manual_document_result", documentBody(f.result));
    rejected(state, "manual_document_result", documentBody({ ...f.result, receiptId: id(8) }));
    rejected(state, "manual_document_result", documentBody({ ...f.result, reasons: ["changed"] }));
});

it("requires PDF plus audit, positive bytes, verified manifest and matching expected identities", () => {
    const f = fixture();
    for (const observation of [
        { ...f.result.local, artifacts: [f.result.local.artifacts[0]!] },
        { ...f.result.local, artifacts: [{ ...f.result.local.artifacts[0]!, artifactIdentity: h("f") }, f.result.local.artifacts[1]!] },
        { ...f.result.local, artifacts: f.result.local.artifacts.map((a) => ({ ...a, state: "verifying" as const })) },
    ]) rejected(selected(f), "manual_document_result", documentBody({ ...f.result, local: observation }));
    expect(() => manualDocumentResultDigest({ ...f.result, local: { ...f.result.local, manifestStatus: "pending" } })).toThrow("ledger-schema");
    expect(() => manualDocumentResultDigest({ ...f.result, local: { ...f.result.local, destinationIdentity: null, destinationRevision: null } })).toThrow("ledger-schema");
    for (const artifacts of [[candidate.artifacts[0]!], candidate.artifacts.map((a) => ({ ...a, byteLength: 0 }))]) {
        const f2 = fixture([{ ...candidate, artifacts }]);
        const result = { ...f2.result, expectedArtifactIdentities: artifacts.map((a) => a.artifactIdentity),
            local: { ...f2.result.local, artifacts: f2.result.local.artifacts.filter((a) => artifacts.some((b) => b.artifactIdentity === a.artifactIdentity)) } };
        rejected(selected(f2), "manual_document_result", documentBody(result));
    }
});

it.each(["inaccessible", "unknown_template", "policy_pending", "excluded_by_policy"] as const)("never treats %s as transfer verified", (classification) => {
    const f = fixture([{ ...candidate, classification }]);
    rejected(selected(f), "manual_document_result", documentBody({ ...f.result, classification }));
});

it("keeps incomplete policy exclusions metadata only and counts one document", () => {
    const excluded = { ...candidate, classification: "excluded_by_policy" as const, artifacts: [], statusType: "001", reasons: ["incomplete-no-file"] };
    const f = fixture([excluded]);
    const metadata: ManualDocumentResult["local"] = { destinationIdentity: "local-1", destinationRevision: "rev-1", state: "metadata_only", manifestStatus: "not_required", artifacts: [], reasons: [] };
    const result: ManualDocumentResult = { ...f.result, classification: "excluded_by_policy", expectedArtifactIdentities: [], local: metadata, drive: { ...metadata, state: "not_required" } };
    const state = append(selected(f), "manual_document_result", documentBody(result));
    const aggregate = buildManualAggregateResult({ receiptId: id(5), runId, scope: f.scope, selection: f.selection, results: [result], status: "unverified", reasons: [] });
    expect(aggregate.counts).toEqual({ selected: 1, localVerified: 0, driveVerified: 0, metadataOnly: 1, attention: 0 });
    expect(append(state, "manual_result_ready", aggregateBody(aggregate)).manualAttempts!.get(runId)!.aggregate!.payload.backupComplete).toBe(false);
    const included = fixture();
    rejected(selected(included), "manual_document_result", documentBody({ ...included.result, local: metadata }));
});

it("rejects premature aggregate, mismatched counts/result digest/scope and second conflicting aggregate", () => {
    const { f, body, state } = aggregated();
    rejected(started(f), "manual_result_ready", body);
    rejected(selected(f), "manual_result_ready", body);
    const documentState = append(selected(f), "manual_document_result", documentBody(f.result));
    for (const change of [{ counts: { ...body.payload.counts, selected: 2 } }, { documentResultCount: 2 },
        { documentResultsDigest: h("f") }, { scope: { ...f.scope, branchId: id(9) } }]) {
        rejected(documentState, "manual_result_ready", aggregateBody({ ...body.payload, ...change }));
    }
    rejected(documentState, "manual_result_ready", { ...body, digest: h("f") });
    rejected(state, "manual_result_ready", aggregateBody({ ...body.payload, receiptId: id(8) }));
});

it("preserves manual selection across later company snapshots and clones nested state", () => {
    const { state, f } = aggregated();
    let next = append(state, "snapshot_bound", { runId, snapshotId: "snapshot-1", sequence: 1, scopeRevision: "s", policyRevision: "p", counts: {} });
    next = append(next, "snapshot_bound", { runId, snapshotId: "snapshot-2", sequence: 2, scopeRevision: "s", policyRevision: "p", counts: {} });
    expect(next.manualAttempts!.get(runId)!.candidates.get("doc-1")).toEqual(candidate);
    next.manualAttempts!.get(runId)!.candidates.get("doc-1")!.reasons.push("mutated");
    next.runs.get(runId)!.executionScope!.companyId = "mutated";
    expect(state.manualAttempts!.get(runId)!.candidates.get("doc-1")!.reasons).toEqual([]);
    expect(state.runs.get(runId)!.executionScope).toEqual(f.scope);
});

it("validates checkpoint references, duplicates, scopes, counts and immutable digests", () => {
    const { state } = aggregated();
    const json = ledgerStateToJson(state);
    const mutations: Array<(j: any) => void> = [
        (j) => j.manualAttempts.push(j.manualAttempts[0]),
        (j) => j.runs.push(j.runs[0]),
        (j) => j.manualAttempts[0].candidates.push(j.manualAttempts[0].candidates[0]),
        (j) => j.manualAttempts[0].results.push(j.manualAttempts[0].results[0]),
        (j) => j.manualAttempts[0].runId = id(9),
        (j) => j.manualAttempts[0].scope.companyId = "other",
        (j) => j.manualAttempts[0].ready.runId = id(9),
        (j) => j.manualAttempts[0].ready.candidateCount = 2,
        (j) => j.manualAttempts[0].ready = null,
        (j) => j.manualAttempts[0].results[0].payload.runId = id(9),
        (j) => j.manualAttempts[0].results[0].payload.scope.branchId = id(9),
        (j) => j.manualAttempts[0].results[0].payload.observedAtSequence = j.lastSeq,
        (j) => j.manualAttempts[0].results[0].digest = h("f"),
        (j) => j.manualAttempts[0].aggregate.payload.counts.localVerified = 2,
        (j) => j.manualAttempts[0].aggregate.digest = h("f"),
        (j) => j.manualAttempts[0].aggregate = null,
        (j) => j.manualAttempts[0].delivery = null,
        (j) => j.manualAttempts[0].rejectionReason = "conflict",
        (j) => delete j.manualAttempts,
        (j) => delete j.runs[0].executionScope,
    ];
    for (const mutate of mutations) {
        const broken = structuredClone(json);
        mutate(broken);
        expect(() => ledgerStateFromJson(broken)).toThrow("ledger-inconsistent");
    }
    expect(ledgerStateToJson(ledgerStateFromJson(json))).toEqual(json);
    const broken = structuredClone(json);
    (broken.manualAttempts![0] as any).token = "private";
    expect(() => ledgerStateFromJson(broken)).toThrow("ledger-schema");
});

it("keeps legacy run objects/checkpoints and journal bytes unchanged", () => {
    const record: LedgerRecord = { v: 1, seq: 2, type: "run_started", at, body: { runId, scheduledFor: null, startedAt: at } };
    expect(encodeLedgerLine(record)).toBe(LEGACY_LINE);
    let state = started();
    state = append(state, "run_started", { runId: id(9), scheduledFor: null, startedAt: at });
    const legacy = state.runs.get(id(9))!;
    expect(Object.prototype.hasOwnProperty.call(legacy, "executionScope")).toBe(false);
    const emptyJson = ledgerStateToJson(emptyLedgerState());
    expect(Object.prototype.hasOwnProperty.call(emptyJson, "manualAttempts")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ledgerStateFromJson(emptyJson), "manualAttempts")).toBe(false);
    expect(ledgerStateToJson(ledgerStateFromJson(emptyJson))).toEqual(emptyJson);
});
const LEGACY_LINE = "{\"at\":\"2026-11-06T00:00:00Z\",\"body\":{\"runId\":\"00000000-0000-4000-8000-000000000003\",\"scheduledFor\":null,\"startedAt\":\"2026-11-06T00:00:00Z\"},\"seq\":2,\"sum\":\"b5f723100bc9448a0d579a050cbbd7ba4bde3f71ddbb1236c2ca05433242b27e\",\"type\":\"run_started\",\"v\":1}\n";

it("roundtrips unfinished selection/result stages and validates raw manual records without mutation", () => {
    const f = fixture();
    const stages = [started(f), selected(f), append(selected(f), "manual_document_result", documentBody(f.result))];
    for (const state of stages) {
        expect(ledgerStateToJson(ledgerStateFromJson(ledgerStateToJson(state)))).toEqual(ledgerStateToJson(state));
    }
    const state = started(f);
    const before = ledgerStateToJson(state);
    const invalid = { v: 1, seq: state.lastSeq + 1, at, type: "manual_candidate_selected", body: { runId, candidate: { ...candidate, ordinal: 0 } } } as LedgerRecord;
    expect(() => applyLedgerRecord(state, invalid)).toThrow("ledger-inconsistent");
    expect(ledgerStateToJson(state)).toEqual(before);
    rejected(state, "manual_result_acknowledged", { runId, receiptId: id(5), digest: h("f") });
});

it("accepts a zero-document defensive lifecycle without inventing document outcomes", () => {
    const f = fixture([]);
    const aggregate = buildManualAggregateResult({ receiptId: id(5), runId, scope: f.scope, selection: f.selection, results: [], status: "failed", reasons: ["unattempted"] });
    const state = append(selected(f), "manual_result_ready", aggregateBody(aggregate));
    expect(state.manualAttempts!.get(runId)!.results.size).toBe(0);
    expect(state.manualAttempts!.get(runId)!.aggregate!.payload).toMatchObject({ status: "failed", backupComplete: false, coverage: "unverified", documentResultCount: 0 });
    expect(ledgerStateToJson(ledgerStateFromJson(ledgerStateToJson(state)))).toEqual(ledgerStateToJson(state));
});

it("rejects duplicate receipt ids across selected documents", () => {
    const second = { ...candidate, ordinal: 2, documentId: "doc-2" };
    const f = fixture([candidate, second]);
    const state = append(selected(f), "manual_document_result", documentBody(f.result));
    rejected(state, "manual_document_result", documentBody({ ...f.result, documentId: "doc-2" }));
});

it("detaches exported run scopes from live state and other exports without breaking the next manual transition", () => {
    const f = fixture();
    const state = selected(f);
    const run = state.runs.get(runId);
    if (!run?.executionScope) throw new Error("fixture-manual-scope");
    const originalScope = run.executionScope;
    const originalValue = { ...originalScope };
    const first = ledgerStateToJson(state).runs.find((entry) => entry.runId === runId)?.executionScope;
    const second = ledgerStateToJson(state).runs.find((entry) => entry.runId === runId)?.executionScope;
    if (!first || !second) throw new Error("fixture-exported-scope");

    Object.assign(first, { kind: "changed-kind", companyId: "changed-company", branchId: id(9),
        jobId: id(8), attemptId: `${id(8)}.attempt-2`, selectionDigest: h("f") });

    expect(run.executionScope).toBe(originalScope);
    expect(run.executionScope).toEqual(originalValue);
    expect(first).not.toBe(originalScope);
    expect(second).not.toBe(originalScope);
    expect(second).not.toBe(first);
    expect(second).toEqual(originalValue);
    const next = append(state, "manual_document_result", documentBody(f.result));
    expect(next.lastSeq).toBe(state.lastSeq + 1);
    expect(next.manualAttempts?.get(runId)?.results.get(candidate.documentId)?.payload).toEqual(f.result);
});

it("exports legacy runs without an executionScope own property and preserves their encoded bytes", () => {
    const record: LedgerRecord = { v: 1, seq: 2, type: "run_started", at, body: { runId, scheduledFor: null, startedAt: at } };
    const installed = append(emptyLedgerState(), "installed", { installationId: "installation-1", archiveId: "archive-1", archiveDev: 1, archiveIno: 2, destinationIdentity: "local-1", destinationRevision: "rev-1" });
    const state = applyLedgerRecord(installed, record);
    const exported = ledgerStateToJson(state).runs[0];

    expect(Object.prototype.hasOwnProperty.call(exported, "executionScope")).toBe(false);
    expect(JSON.stringify(exported)).toBe(`{"runId":"${runId}","scheduledFor":null,"startedAt":"${at}","status":"open","snapshotId":null,"sequence":null,"finishedAt":null,"snapshotStatus":null,"historicalCoverage":null,"reasonCodes":[],"counts":null}`);
    expect(encodeLedgerLine(record)).toBe(LEGACY_LINE);
});
