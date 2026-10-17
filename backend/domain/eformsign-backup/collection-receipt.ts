import { assertCount, assertIdentifier, assertSha256, canonicalJson, evidenceDigest, EVIDENCE_DOMAINS } from "./source-evidence";

type PersistenceAck = "acknowledged" | "pending" | "failed";
type Outcome = "succeeded" | "failed" | "interrupted";
export interface PageReceipt {
    ordinal: number;
    startOffset: number;
    requestedLimit: number;
    returnedCount: number;
    totalCount: number;
    terminal: boolean;
    outcome: Outcome;
    persistenceAck: PersistenceAck;
    totalChangeReason?: "provider-total-changed";
}
export interface ScanReceipt {
    documentType: "01" | "03" | "04";
    pass: 1 | 2;
    distinctIdCount: number;
    documentIdSetSha256: string;
    pages: PageReceipt[];
}
export interface CollectionReceipt {
    companyId: string;
    visibility: "unknown" | "declared-company-wide";
    outcome: Outcome;
    startAck: PersistenceAck;
    finalAck: PersistenceAck;
    scans: ScanReceipt[];
}
export type ReceiptReason = "malformed-receipt" | "company-visibility-unknown" | "provider-consistency-unverified"
    | "run-failed" | "run-interrupted" | "persistence-unhealthy" | "scan-set-incomplete"
    | "page-failed" | "page-interrupted" | "page-sequence-invalid" | "terminal-evidence-missing"
    | "total-changed" | "count-mismatch" | "repeat-set-mismatch";
export interface CollectionAssessment {
    observedScan: "complete" | "incomplete";
    companyCoverage: "unverified";
    reasons: ReceiptReason[];
}

export function documentIdSetDigest(documentIds: readonly string[]): string {
    if (!Array.isArray(documentIds)) throw new Error("Invalid evidence");
    canonicalJson(documentIds);
    for (const id of documentIds) assertIdentifier(id);
    return evidenceDigest(EVIDENCE_DOMAINS.documentIdSet, [...new Set(documentIds)].sort());
}
function requireValue(condition: boolean): void {
    if (!condition) throw new Error("Invalid evidence");
}
function validateReceipt(receipt: CollectionReceipt): void {
    assertIdentifier(receipt.companyId);
    requireValue(["unknown", "declared-company-wide"].includes(receipt.visibility));
    requireValue(["succeeded", "failed", "interrupted"].includes(receipt.outcome));
    requireValue(["acknowledged", "pending", "failed"].includes(receipt.startAck));
    requireValue(["acknowledged", "pending", "failed"].includes(receipt.finalAck));
    requireValue(Array.isArray(receipt.scans));
    for (const scan of receipt.scans) {
        requireValue(["01", "03", "04"].includes(scan.documentType) && [1, 2].includes(scan.pass));
        assertCount(scan.distinctIdCount);
        assertSha256(scan.documentIdSetSha256);
        requireValue(Array.isArray(scan.pages));
        for (const page of scan.pages) {
            for (const count of [page.ordinal, page.startOffset, page.requestedLimit, page.returnedCount, page.totalCount]) assertCount(count);
            requireValue(page.requestedLimit > 0 && page.returnedCount <= page.requestedLimit);
            requireValue(typeof page.terminal === "boolean");
            requireValue(["succeeded", "failed", "interrupted"].includes(page.outcome));
            requireValue(["acknowledged", "pending", "failed"].includes(page.persistenceAck));
            requireValue(page.totalChangeReason === undefined || page.totalChangeReason === "provider-total-changed");
        }
    }
}
function assessScan(scan: ScanReceipt, reasons: Set<ReceiptReason>): void {
    let offset = 0;
    let previousTotal: number | undefined;
    scan.pages.forEach((page, ordinal) => {
        if (page.outcome !== "succeeded") reasons.add(page.outcome === "failed" ? "page-failed" : "page-interrupted");
        if (page.persistenceAck !== "acknowledged") reasons.add("persistence-unhealthy");
        if (page.ordinal !== ordinal || page.startOffset !== offset) reasons.add("page-sequence-invalid");
        if (previousTotal !== undefined && previousTotal !== page.totalCount) reasons.add("total-changed");
        offset += page.returnedCount;
        if (!Number.isSafeInteger(offset)) reasons.add("count-mismatch");
        const last = ordinal === scan.pages.length - 1;
        // Explicit last-page assertion must also agree with observable count evidence.
        if (page.terminal !== last || (last && offset !== page.totalCount) || (!last && (page.returnedCount === 0 || offset >= page.totalCount))) {
            reasons.add("terminal-evidence-missing");
        }
        previousTotal = page.totalCount;
    });
    if (scan.pages.length === 0) reasons.add("terminal-evidence-missing");
    if (offset !== scan.distinctIdCount) reasons.add("count-mismatch");
    if (scan.distinctIdCount === 0 && scan.documentIdSetSha256 !== documentIdSetDigest([])) reasons.add("count-mismatch");
}

/** Supplied acknowledgements are assertions; this pure function cannot establish durability. */
export function evaluateCollectionReceipt(input: unknown): CollectionAssessment {
    const reasons = new Set<ReceiptReason>();
    try {
        // Validate JSON before reading fields: accessors and non-JSON values are never executed/accepted.
        const receipt: CollectionReceipt = JSON.parse(canonicalJson(input));
        validateReceipt(receipt);
        if (receipt.visibility === "unknown") reasons.add("company-visibility-unknown");
        if (receipt.outcome !== "succeeded") reasons.add(receipt.outcome === "failed" ? "run-failed" : "run-interrupted");
        if (receipt.startAck !== "acknowledged" || receipt.finalAck !== "acknowledged") reasons.add("persistence-unhealthy");
        const scans = new Map<string, ScanReceipt>();
        for (const scan of receipt.scans) {
            const key = `${scan.documentType}/${scan.pass}`;
            if (scans.has(key)) reasons.add("scan-set-incomplete");
            scans.set(key, scan);
            assessScan(scan, reasons);
        }
        for (const type of ["01", "03", "04"]) {
            const first = scans.get(`${type}/1`), second = scans.get(`${type}/2`);
            if (!first || !second) reasons.add("scan-set-incomplete");
            else if (first.distinctIdCount !== second.distinctIdCount || first.documentIdSetSha256 !== second.documentIdSetSha256) reasons.add("repeat-set-mismatch");
        }
    } catch {
        reasons.add("malformed-receipt");
    }
    const blocking = [...reasons].some(reason => reason !== "company-visibility-unknown");
    reasons.add("provider-consistency-unverified");
    return { observedScan: blocking ? "incomplete" : "complete", companyCoverage: "unverified", reasons: [...reasons].sort() };
}
