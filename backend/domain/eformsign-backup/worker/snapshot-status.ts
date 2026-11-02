import type { DestinationState } from "./destination-transitions";
import type { LedgerState } from "./ledger-state";
import type { WorkerReasonCode } from "./worker-error";

/**
 * Every status the design knows. `complete` and `no_known_gap` are listed for completeness only: this cycle
 * has no freshness setting, coverage stays `unverified` and Drive is `not_configured`, so no function in this
 * file can return them (contract W8, T22).
 */
export const SNAPSHOT_STATUSES = ["complete", "partial", "blocked", "failed", "skipped_overlap"] as const;
export type SnapshotStatus = typeof SNAPSHOT_STATUSES[number];
export const HISTORICAL_COVERAGES = ["no_known_gap", "known_gap", "unverified"] as const;
export type HistoricalCoverage = typeof HISTORICAL_COVERAGES[number];

/** What the worker itself can judge. `skipped_overlap` is flock exit 75, never a worker record. */
export const JUDGED_SNAPSHOT_STATUSES = ["failed", "blocked", "partial"] as const;
export type JudgedSnapshotStatus = typeof JUDGED_SNAPSHOT_STATUSES[number];
export const JUDGED_HISTORICAL_COVERAGES = ["known_gap", "unverified"] as const;
export type JudgedHistoricalCoverage = typeof JUDGED_HISTORICAL_COVERAGES[number];

export interface SnapshotJudgementInput {
    /** The snapshot could not be created or read (401, 404, 400, snapshot `failed`): the reason code, else null. */
    snapshotFailure: WorkerReasonCode | null;
    /** The control side (ledger, staging) failed and the run stopped: the reason code, else null. */
    controlFailure: WorkerReasonCode | null;
    /** The local destination state of every included artifact. */
    localEntries: ReadonlyArray<{ state: DestinationState; reasonCode: WorkerReasonCode | null }>;
    /**
     * The Google Drive destination (BJJ-456). Omitted, or `bound: false`, judges exactly as before: Drive is `drive-not-configured`.
     * Drive is a second, independent destination, so nothing in here can make a run `blocked` or `failed`.
     */
    drive?: {
        bound: boolean;
        /** The Drive phase as a whole did not run to its end (token rejected, root changed, ...): the reason code, else null. */
        phaseFailure: WorkerReasonCode | null;
        /** The reason codes of the Drive entries that ended in blocked, retry_wait or integrity_error. */
        entryReasons: readonly WorkerReasonCode[];
    };
}

export interface SnapshotJudgement {
    snapshotStatus: JudgedSnapshotStatus;
    reasonCodes: WorkerReasonCode[];
}

function sortedUnique(codes: Iterable<WorkerReasonCode>): WorkerReasonCode[] {
    return [...new Set(codes)].sort();
}

/** Contract W8: `failed` > `blocked` > `partial`. All-verified is still `partial`; a bound Drive destination swaps `drive-not-configured` for its own reasons. */
export function judgeSnapshotStatus(input: SnapshotJudgementInput): SnapshotJudgement {
    if (input.snapshotFailure !== null) {
        return { snapshotStatus: "failed", reasonCodes: [input.snapshotFailure] };
    }
    const blockedEntries = input.localEntries.filter((entry) => entry.state === "blocked");
    if (input.controlFailure !== null || blockedEntries.length > 0) {
        const codes: WorkerReasonCode[] = [];
        if (input.controlFailure !== null) codes.push(input.controlFailure);
        for (const entry of blockedEntries) if (entry.reasonCode !== null) codes.push(entry.reasonCode);
        if (codes.length === 0) codes.push("archive-unavailable");
        return { snapshotStatus: "blocked", reasonCodes: sortedUnique(codes) };
    }
    const drive = input.drive;
    if (drive?.bound) {
        const codes: WorkerReasonCode[] = ["coverage-unverified", ...drive.entryReasons];
        if (drive.phaseFailure !== null) codes.push(drive.phaseFailure);
        return { snapshotStatus: "partial", reasonCodes: sortedUnique(codes) };
    }
    return { snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-not-configured"] };
}

/** Contract W8: any recorded gap makes it `known_gap`; otherwise `unverified`. `no_known_gap` needs coverage proof. */
export function judgeHistoricalCoverage(state: Pick<LedgerState, "gaps">): JudgedHistoricalCoverage {
    return state.gaps.length > 0 ? "known_gap" : "unverified";
}

/** `skipped_overlap` and every non-`complete` status are not a successful run. */
export function isSuccessfulSnapshotStatus(status: SnapshotStatus): boolean {
    return status === "complete";
}
