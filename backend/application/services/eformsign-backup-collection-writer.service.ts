import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";

import {
    evaluateCollectionReceipt,
    type CollectionAssessment,
    type CollectionReceipt,
    type PageReceipt,
} from "domain/eformsign-backup/collection-receipt";
import { assertCount, assertIdentifier, assertSha256 } from "domain/eformsign-backup/source-evidence";
import {
    EFORMSIGN_BACKUP_COLLECTION_REPOSITORY,
    type IEformsignBackupCollectionRepository,
    type CollectionOutcome,
    type CollectionPageObservation,
    type CollectionRunContext,
    type CollectionScanObservation,
    type CollectionScanSummary,
    type CollectionScanSummaryV1,
    type EformsignCollectionObserver,
} from "domain/repositories/eformsign-backup-collection.repository.interface";

const incomplete = (): CollectionAssessment => ({ observedScan: "incomplete", companyCoverage: "unverified",
    reasons: ["persistence-unhealthy", "provider-consistency-unverified"] });

/** Inactive until a separately reviewed migration + real-DB gate allows module binding. */
@Injectable()
export class EformsignBackupCollectionWriter {
    private readonly logger = new Logger(EformsignBackupCollectionWriter.name);
    constructor(
        @Inject(EFORMSIGN_BACKUP_COLLECTION_REPOSITORY)
        private readonly repository: IEformsignBackupCollectionRepository,
    ) {}

    async begin(context: CollectionRunContext): Promise<EformsignCollectionObserver> {
        const id = randomUUID();
        let companyId: string | null = null;
        try { assertIdentifier(context.configuredCompanyId); companyId = context.configuredCompanyId; } catch { /* unknown */ }
        const scans: CollectionScanSummary[] = (["01", "03", "04"] as const).flatMap(documentType =>
            ([1, 2] as const).map(pass => ({ documentType, pass, outcome: "pending", distinctIdCount: null,
                documentIdSetSha256: null, expectedPageCount: null, persistedPageCount: 0, failureCode: null })));
        const pages = new Map<string, Map<number, CollectionPageObservation>>();
        let healthy = true;
        let started = false;
        let closed = false;
        let result = incomplete();
        let queue = Promise.resolve();
        const summary = (): CollectionScanSummaryV1 => ({ version: 1, scans: scans.map(scan => ({ ...scan })), assessment: incomplete() });
        const failure = () => {
            healthy = false;
            this.logger.warn("Eformsign collection receipt persistence-unhealthy");
        };
        const serialize = (operation: () => Promise<void>): Promise<void> => {
            const next = queue.then(operation).catch(failure);
            queue = next;
            return next;
        };
        try {
            await this.repository.begin({ id, configuredCompanyId: companyId, trigger: context.trigger,
                lockMode: context.lockMode, startedAt: new Date(), scanSummary: summary() });
            started = true;
        } catch { failure(); }
        const findScan = (value: { documentType: string; pass: number }) => scans.find(scan =>
            scan.documentType === value.documentType && scan.pass === value.pass)!;
        const assess = (outcome: CollectionOutcome, finalAck: "pending" | "acknowledged"): CollectionAssessment => {
            if (!healthy || !started) return incomplete();
            const unknownPage = [...pages.values()].some(scanPages => [...scanPages.values()].some(page =>
                page.returnedCount === null || page.totalCount === null || page.terminal === null));
            if (!companyId || unknownPage || scans.some(scan => scan.outcome !== "succeeded")) {
                // Unknown failed attempts and unresolved companies are not valid 1A
                // inputs. Represent their incompleteness without inventing any values.
                const reasons: CollectionAssessment["reasons"] = ["scan-set-incomplete", "provider-consistency-unverified"];
                if (!companyId) reasons.push("company-visibility-unknown");
                if (unknownPage) reasons.push("page-failed");
                if (outcome !== "succeeded") reasons.push(outcome === "interrupted" ? "run-interrupted" : "run-failed");
                if (finalAck === "pending") reasons.push("persistence-unhealthy");
                return { observedScan: "incomplete", companyCoverage: "unverified", reasons };
            }
            const receipt: CollectionReceipt = { companyId, visibility: "unknown", outcome,
                startAck: started ? "acknowledged" : "failed", finalAck,
                scans: scans.map(scan => ({ documentType: scan.documentType, pass: scan.pass,
                    distinctIdCount: scan.distinctIdCount!, documentIdSetSha256: scan.documentIdSetSha256!,
                    pages: [...(pages.get(`${scan.documentType}/${scan.pass}`)?.values() ?? [])]
                        .map(page => ({ ...page, persistenceAck: "acknowledged" } as PageReceipt)),
                })),
            };
            return evaluateCollectionReceipt(receipt);
        };
        return {
            page: (input: CollectionPageObservation) => serialize(async () => {
                if (closed) return;
                const { documentType, pass, ordinal, startOffset, requestedLimit, returnedCount, totalCount, terminal,
                    outcome, failureCode } = input;
                if (!["01", "03", "04"].includes(documentType) || ![1, 2].includes(pass)) throw new Error("Invalid receipt");
                for (const count of [ordinal, startOffset, requestedLimit]) assertCount(count);
                if (requestedLimit === 0) throw new Error("Invalid receipt");
                if (returnedCount !== null) assertCount(returnedCount);
                if (totalCount !== null) assertCount(totalCount);
                if (terminal !== null && typeof terminal !== "boolean") throw new Error("Invalid receipt");
                if (!["succeeded", "failed", "interrupted"].includes(outcome)
                    || (failureCode !== null && !["fetch-failed", "invalid-page", "run-failed", "lease-lost",
                        "persistence-unhealthy", "company-unconfigured", "scan-unfinished"].includes(failureCode))) throw new Error("Invalid receipt");
                const page = { documentType, pass, ordinal, startOffset, requestedLimit, returnedCount, totalCount,
                    terminal, outcome, failureCode };
                const key = `${documentType}/${pass}`;
                const scan = findScan(page);
                const observed = pages.get(key) ?? new Map<number, CollectionPageObservation>();
                const previous = observed.get(ordinal);
                if (previous && JSON.stringify(previous) !== JSON.stringify(page)) throw new Error("Receipt conflict");
                // Keep observed evidence even when this or an earlier page cannot
                // be persisted. The unhealthy latch still forbids further appends.
                observed.set(ordinal, page);
                pages.set(key, observed);
                if (outcome !== "succeeded") { scan.outcome = outcome; scan.failureCode = failureCode; }
                if (!healthy || !started) return;
                await this.repository.append(id, page, { isHealthy: () => healthy && !closed });
                if (!previous) scan.persistedPageCount += 1;
            }),
            scan: (input: CollectionScanObservation) => serialize(async () => {
                if (closed) return;
                assertCount(input.distinctIdCount);
                assertSha256(input.documentIdSetSha256);
                const scan = findScan(input);
                scan.distinctIdCount = input.distinctIdCount;
                scan.documentIdSetSha256 = input.documentIdSetSha256;
                scan.expectedPageCount = pages.get(`${input.documentType}/${input.pass}`)?.size ?? 0;
                scan.outcome = "succeeded";
                if (scan.persistedPageCount !== scan.expectedPageCount) scan.failureCode = "persistence-unhealthy";
            }),
            finish: async (outcome: CollectionOutcome, shouldContinue?: () => boolean) => {
                await serialize(async () => {
                    if (closed) return;
                    // The serialized guard prevents racing append/finalize; repository guards
                    // and DB-owned transaction deadlines protect the final update itself.
                    closed = true;
                    if (shouldContinue?.() === false) outcome = "interrupted";
                    for (const scan of scans) {
                        if (scan.outcome === "pending") { scan.outcome = outcome === "interrupted" ? outcome : "failed";
                            scan.failureCode = "scan-unfinished"; }
                    }
                    const candidate = assess(outcome, "pending");
                    // Pending final acknowledgement is expected here; all other
                    // blocking evidence prevents the completed outcome as well.
                    const eligible = healthy && companyId && outcome === "succeeded"
                        && candidate.reasons.every(reason => ["persistence-unhealthy", "company-visibility-unknown",
                            "provider-consistency-unverified"].includes(reason))
                        && scans.every(scan => scan.outcome === "succeeded");
                    if (!started) return;
                    try {
                        await this.repository.finish({ id, outcome: eligible
                            ? "completed" : outcome === "interrupted" ? "interrupted" : "failed",
                        finishedAt: new Date(), failureCode: !healthy ? "persistence-unhealthy"
                            : !companyId ? "company-unconfigured" : outcome === "succeeded" ? eligible ? null : "scan-unfinished"
                                : outcome === "interrupted" ? "lease-lost" : "run-failed",
                        scanSummary: { ...summary(), assessment: candidate } },
                        { isHealthy: () => healthy && shouldContinue?.() !== false });
                        // No finalAck is invented for the persisted candidate. Only a resolved
                        // repository transaction establishes this caller's acknowledgement.
                        result = shouldContinue?.() === false ? incomplete() : assess(outcome, "acknowledged");
                    } catch { failure(); }
                });
                return result;
            },
        };
    }
}
