import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { isWorkerReasonCode, WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { hex64, identifier, isoUtc } from "domain/eformsign-backup/worker/schema-fields";
import {
    buildManualAggregateResult, manualAggregateResultDigest, manualDocumentResultDigest, manualSelectionDigest,
    normalizeManualDocumentResult, normalizeManualSelection, sameManualValue,
    type ManualSelection, type ManualDocumentResult,
} from "domain/eformsign-backup/worker/manual-protocol";
import { ManualControlFailure, type ManualClaim, type ManualControlClient, type ManualLease } from "./manual-control-client";
import type { ManualDeliveryBinding, ManualDeliveryStore } from "./manual-delivery-store";
import { copyManualClaim, ManualBackupLeaseFence } from "./manual-lease";
import { awaitExecutionSignal } from "../execution-effect-fence";
import { prepareManualRun } from "./manual-run-scope";
import type { ExportPort, RunnerDependencies, WorkerRunnerPort } from "./runner-types";

export type ManualPendingClient = Pick<ManualControlClient, "claim" | "renew" | "validate" | "listCandidates" | "openArtifact" | "writeDocumentResults" | "finish">;
export type ManualBindingPort = Pick<ManualDeliveryStore, "put" | "list" | "remove">;
export type ManualPendingDependencies = Pick<RunnerDependencies, "config" | "clock"> & {
    ledger: Pick<RunnerDependencies["ledger"], "status" | "state" | "append">;
    credentialFingerprint: string;
};
export interface ManualPendingOptions {
    deps: ManualPendingDependencies;
    runner: Pick<WorkerRunnerPort, "run">;
    client: ManualPendingClient;
    bindings: ManualBindingPort;
    lockGuard: () => Promise<void>;
    maxJobs?: number;
}
export interface ManualPendingSummary {
    outcome: "finished" | "disabled";
    counts: { claimed: number; acknowledged: number; pending: number; rejected: number };
}
const inconsistent = (): never => { throw new WorkerError("ledger-inconsistent"); };
const refuse = (): never => { throw new WorkerError("export-response-invalid"); };
function copy<T>(value: T): T { return JSON.parse(canonicalJson(value)) as T; }
function leaseOf(claim: ManualClaim): ManualLease { return { runId: claim.executionScope.jobId, leaseToken: claim.leaseToken }; }
function claimOf(binding: ManualDeliveryBinding): ManualClaim {
    return copyManualClaim({ executionScope: binding.executionScope, snapshot: binding.snapshot, leaseToken: binding.leaseToken,
        leaseDurationMs: binding.leaseDurationMs, leaseExpiresAtUTC: binding.leaseExpiresAtUTC });
}
function bindingCopy(value: unknown, deps: ManualPendingDependencies): ManualDeliveryBinding {
    try {
        const b = copy(value) as ManualDeliveryBinding;
        const claim = copyManualClaim(claimOf(b));
        const expected: ManualDeliveryBinding = { version: 1, ...claim, installationId: identifier.parse(b.installationId),
            credentialFingerprint: hex64.parse(b.credentialFingerprint), createdAtUTC: isoUtc.parse(b.createdAtUTC) };
        if (!Number.isFinite(Date.parse(expected.createdAtUTC)) || !sameManualValue(b, expected)
            || b.installationId !== deps.ledger.state.installation?.installationId || b.executionScope.companyId !== deps.config.companyId
            || b.credentialFingerprint !== deps.credentialFingerprint) inconsistent();
        return expected;
    } catch { throw new WorkerError("control-unavailable"); }
}
const forbidden = (): never => refuse();

/** A per-run source capability: only an exact fixed candidate artifact can reach the manual endpoint. */
function fixedExport(client: ManualPendingClient, claim: ManualClaim, selection: ManualSelection, fence: ManualBackupLeaseFence): ExportPort {
    const allowed = new Map(selection.candidates.flatMap(c => c.artifacts.map(a => [a.artifactIdentity, { documentId: c.documentId, artifact: a }] as const)));
    return {
        createSnapshot: forbidden, getSnapshot: forbidden, listCandidates: forbidden,
        async openArtifact(snapshotId, value) {
            const artifact = copy(value);
            const selected = allowed.get(artifact.artifactIdentity);
            if (snapshotId !== claim.snapshot.snapshotId || !selected || artifact.sha256 !== selected.artifact.sha256
                || artifact.byteLength !== selected.artifact.byteLength || Object.keys(artifact).length !== 3) throw new WorkerError("export-response-invalid");
            await fence.assertActive(selected.documentId);
            const stream = await client.openArtifact(leaseOf(claim), selected.documentId, artifact, fence.signal);
            await fence.assertActive(selected.documentId);
            return stream;
        },
    };
}

/** Immutable C1 facts only; no shared current-artifact state contributes to a delivery. */
function readyReceipt(deps: ManualPendingDependencies, binding: ManualDeliveryBinding) {
    const matches = [...(deps.ledger.state.manualAttempts ?? new Map()).entries()]
        .filter(([, attempt]) => sameManualValue(attempt.scope, binding.executionScope));
    if (matches.length > 1) inconsistent();
    const match = matches[0];
    if (!match || !match[1].aggregate) return null;
    const [runId, attempt] = match;
    if (!attempt.ready || !attempt.delivery) inconsistent();
    const selection = normalizeManualSelection({ jobId: attempt.scope.jobId, companyId: attempt.scope.companyId, branchId: attempt.scope.branchId,
        scopeRevision: attempt.ready.scopeRevision, policyRevision: attempt.ready.policyRevision,
        candidates: [...attempt.candidates.values()].map(c => copy(c)) });
    if (attempt.ready.runId !== runId || attempt.ready.candidateCount !== selection.candidates.length
        || attempt.ready.selectionDigest !== binding.executionScope.selectionDigest || manualSelectionDigest(selection) !== binding.executionScope.selectionDigest) inconsistent();
    const results = [...attempt.results.values()].map(item => {
        const payload = normalizeManualDocumentResult(copy(item.payload));
        if (manualDocumentResultDigest(payload) !== item.digest) inconsistent();
        return { payload, digest: item.digest };
    });
    const aggregate = copy(attempt.aggregate!);
    const rebuilt = buildManualAggregateResult({ receiptId: aggregate.payload.receiptId, runId, scope: binding.executionScope,
        status: aggregate.payload.status, reasons: aggregate.payload.reasons, selection, results: results.map(r => r.payload) });
    return { runId, selection, results, aggregate, rebuilt, delivery: attempt.delivery };
}

/** Document batches account for the complete transport body, including private lease/company keys. */
function batches(companyId: string, lease: ManualLease, items: { payload: ManualDocumentResult; digest: string }[]) {
    const chunks: typeof items[] = [];
    let chunk: typeof items = [];
    const fits = (values: typeof items) => Buffer.byteLength(canonicalJson({ companyId, leaseToken: lease.leaseToken, items: values })) <= 64 * 1024;
    for (const item of items) {
        if (!fits([item])) inconsistent();
        if (chunk.length === 100 || !fits([...chunk, item])) { chunks.push(chunk); chunk = []; }
        chunk.push(item);
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
}
function rejection(error: unknown): "lease-lost" | "not-found" | "conflict" | null {
    try {
        if (!(error instanceof ManualControlFailure) || [401, 403].includes(error.httpStatus)) return null;
        if (error.code === "LEASE_LOST") return "lease-lost";
        if (error.code === "NOT_FOUND") return "not-found";
        if (["INVALID_REPORT", "IDEMPOTENCY_CONFLICT"].includes(error.code)) return "conflict";
    } catch { /* Unknown is pending, never a destructive closure. */ }
    return null;
}
function documentsPending(error: unknown): boolean {
    try { return error instanceof ManualControlFailure && ![401, 403].includes(error.httpStatus) && error.code === "DOCUMENT_RESULTS_PENDING"; }
    catch { return false; }
}

/** Independent control lifetime: terminal replay must survive an aborted source/effect fence. */
async function controlRequest<T>(timeout: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new ManualControlFailure(0, "ABORTED")); controller.abort(); }, Math.min(timeout, 10_000));
    });
    try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expired]); }
    finally { clearTimeout(timer); controller.abort(); }
}

/** Effect and delivery heartbeats share a renewal queue isolated to each job. */
function serializedRenew(client: ManualPendingClient): ManualPendingClient["renew"] {
    let tail: Promise<void> = Promise.resolve();
    return (lease, signal) => {
        const target = copy(lease);
        const result = tail.then(() => {
            if (signal?.aborted) throw new ManualControlFailure(0, "ABORTED");
            return client.renew(target, signal);
        });
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
}

export async function processPending(options: ManualPendingOptions): Promise<ManualPendingSummary> {
    try {
        const deps = { ...options.deps, config: copy(options.deps.config) };
        return await processPendingInternal({ ...options, deps });
    } catch (error) {
        try { if (error instanceof WorkerError && isWorkerReasonCode(error.reasonCode)) throw new WorkerError(error.reasonCode); }
        catch (closed) { if (closed instanceof WorkerError) throw closed; }
        throw new WorkerError("export-unavailable");
    }
}

async function processPendingInternal(options: ManualPendingOptions): Promise<ManualPendingSummary> {
    const { deps, client, bindings, runner, lockGuard } = options;
    const maxJobs = options.maxJobs ?? 1;
    if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 20) throw new WorkerError("config-invalid");
    const summary: ManualPendingSummary = { outcome: deps.config.enabled ? "finished" : "disabled", counts: { claimed: 0, acknowledged: 0, pending: 0, rejected: 0 } };
    if (!deps.config.enabled) return summary;
    const guard = async () => { try { await lockGuard(); } catch { throw new WorkerError("lock-not-held"); } };
    await guard();
    if (deps.ledger.status !== "ok" || !deps.ledger.state.installation) throw new WorkerError("not-initialized");
    const listed = (await bindings.list()).map(b => bindingCopy(b, deps));
    // A missing capability is operator evidence, never permission to regenerate/restart an attempt.
    for (const attempt of deps.ledger.state.manualAttempts?.values() ?? []) {
        if (attempt.aggregate && attempt.delivery === "pending" && !listed.some(b => sameManualValue(b.executionScope, attempt.scope))) inconsistent();
    }
    let attempted = 0;
    const deliver = async (binding: ManualDeliveryBinding, renew = serializedRenew(client)): Promise<boolean> => {
        const receipt = readyReceipt(deps, binding);
        if (!receipt) return true;
        const { aggregate, runId, results, selection } = receipt;
        if (!sameManualValue(receipt.rebuilt, aggregate.payload) || manualAggregateResultDigest(aggregate.payload) !== aggregate.digest) inconsistent();
        // Reuse C2's complete pure selection/snapshot preflight, without invoking any capability.
        const inert = { signal: new AbortController().signal, assertActive: async () => undefined };
        prepareManualRun({ executionScope: binding.executionScope, selection, snapshot: binding.snapshot,
            exportPort: { createSnapshot: forbidden, getSnapshot: forbidden, listCandidates: forbidden, openArtifact: forbidden }, fence: inert }, deps.config.companyId);
        if (receipt.delivery !== "pending") { await bindings.remove(binding); return true; }
        const callback = { runId, receiptId: aggregate.payload.receiptId, digest: aggregate.digest };
        const claim = claimOf(binding);
        const lease = leaseOf(claim);
        let deliveryFence: ManualBackupLeaseFence | undefined;
        try {
            await guard();
            try { await controlRequest(deps.config.requestTimeoutMs, signal => client.finish(lease, aggregate.payload, aggregate.digest, signal)); }
            catch (error) {
                if (!documentsPending(error)) throw error;
                await guard();
                const requestStart = performance.now();
                const renewed = copy(await controlRequest(deps.config.requestTimeoutMs, signal => renew(lease, signal)));
                await guard();
                // A delivery-only heartbeat has no source validation or artifact capability.
                deliveryFence = new ManualBackupLeaseFence({ client: { renew, validate: (...args) => client.validate(...args) },
                    claim: { ...claim, ...renewed }, claimStartedAtMono: requestStart, beforeCheck: guard });
                deliveryFence.start();
                for (const chunk of batches(deps.config.companyId, lease, results)) {
                    if (deliveryFence.signal.aborted) throw new WorkerError("export-unavailable");
                    await guard();
                    await awaitExecutionSignal(deliveryFence, client.writeDocumentResults(lease, chunk, deliveryFence.signal));
                    await guard();
                    if (deliveryFence.signal.aborted) throw new WorkerError("export-unavailable");
                }
                await guard();
                await controlRequest(deps.config.requestTimeoutMs, signal => client.finish(lease, aggregate.payload, aggregate.digest, signal));
            }
            await guard();
            await deps.ledger.append("manual_result_acknowledged", callback, deps.clock.now().toISOString());
            summary.counts.acknowledged++;
        } catch (error) {
            const reason = rejection(error);
            if (reason === null) { summary.counts.pending++; return false; }
            await deps.ledger.append("manual_result_rejected", { ...callback, reason }, deps.clock.now().toISOString());
            summary.counts.rejected++;
        } finally { deliveryFence?.close(); }
        await bindings.remove(binding);
        return true;
    };
    for (const binding of listed) {
        const receipt = readyReceipt(deps, binding);
        if (!receipt) continue;
        if (receipt.delivery === "pending") {
            if (attempted >= maxJobs) return summary;
            attempted++;
        }
        if (!await deliver(binding)) return summary;
    }
    while (attempted < maxJobs) {
        await guard();
        const startedAt = performance.now();
        let raw: ManualClaim | null;
        try { raw = await controlRequest(deps.config.requestTimeoutMs, signal => client.claim(signal)); } catch { throw new WorkerError("export-unavailable"); }
        await guard();
        if (raw === null) break;
        const claim = copyManualClaim(raw);
        if (claim.executionScope.companyId !== deps.config.companyId) refuse();
        const sameAttempt = (scope: typeof claim.executionScope) => scope.jobId === claim.executionScope.jobId && scope.attemptId === claim.executionScope.attemptId;
        if (listed.some(b => sameAttempt(b.executionScope))
            || [...(deps.ledger.state.manualAttempts?.values() ?? [])].some(a => sameAttempt(a.scope))) inconsistent();
        attempted++; summary.counts.claimed++;
        const binding = bindingCopy({ version: 1, ...claim, installationId: deps.ledger.state.installation.installationId,
            credentialFingerprint: deps.credentialFingerprint, createdAtUTC: deps.clock.now().toISOString() }, deps);
        await bindings.put(binding);
        const renew = serializedRenew(client);
        const fenceClient: Pick<ManualControlClient, "renew" | "validate"> = {
            validate: (...args) => client.validate(...args),
            renew,
        };
        const fence = new ManualBackupLeaseFence({ client: fenceClient, claim, claimStartedAtMono: startedAt, beforeCheck: guard });
        try {
            fence.start();
            const candidates: ManualSelection["candidates"] = [];
            let cursor = 0;
            while (true) {
                await fence.assertActive();
                const page = copy(await awaitExecutionSignal(fence, client.listCandidates(leaseOf(claim), { afterOrdinal: cursor, limit: 100 }, fence.signal)));
                await fence.assertActive();
                if (Object.keys(page).length !== 2 || page.items.length > 100 || page.items.some((c, i) => c.ordinal !== cursor + i + 1)
                    || (page.nextCursor !== null && (page.items.length === 0 || page.nextCursor !== page.items.at(-1)!.ordinal || page.nextCursor <= cursor))) refuse();
                candidates.push(...page.items);
                if (candidates.length > claim.snapshot.counts!.total) refuse();
                if (page.nextCursor === null) break;
                cursor = page.nextCursor;
            }
            const selection = normalizeManualSelection({ jobId: claim.executionScope.jobId, companyId: claim.executionScope.companyId,
                branchId: claim.executionScope.branchId, scopeRevision: claim.snapshot.scopeRevision, policyRevision: claim.snapshot.policyRevision, candidates });
            const exportPort = fixedExport(client, claim, selection, fence);
            const runOptions = { executionScope: claim.executionScope, selection, snapshot: claim.snapshot, exportPort, fence };
            prepareManualRun(runOptions, deps.config.companyId);
            await guard();
            const result = await runner.run(runOptions);
            const receipt = readyReceipt(deps, binding);
            if (!receipt || !result.manualReceipt || result.runId !== receipt.runId || result.manualReceipt.runId !== receipt.runId
                || result.manualReceipt.receiptId !== receipt.aggregate.payload.receiptId || result.manualReceipt.digest !== receipt.aggregate.digest) inconsistent();
            if (!await deliver(binding, renew)) return summary;
        } finally { fence.close(); }
    }
    return summary;
}
