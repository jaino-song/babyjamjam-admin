import { CarrierResultState, MessageLogEntity } from "domain/entities/message-log.entity";
import type { Prisma } from "@prisma/client";

export type MessageRetryInvocation = "automatic" | "manual";

/**
 * The history endpoint merges rows from the immutable log stream and the
 * terminal-job stream. Each source is ordered by its native immutable id; the
 * source rank is applied only when the service concatenates the two streams.
 */
export type MessageHistorySource = "log" | "job";

export interface MessageHistoryPageCursor {
    source: MessageHistorySource;
    nativeId: string;
}

export interface MessageHistoryPageQuery {
    snapshotAt: Date;
    after: MessageHistoryPageCursor | null;
    limit: number;
}

/**
 * Identity of the client whose history is being read. `phoneKey` is the
 * client's current `normalizeKoreanPhoneLookupKey`; it only ever pulls in rows
 * that carry no client id at all (a row owned by another client never matches
 * by phone).
 */
export interface ClientHistoryScope {
    clientId: number;
    phoneKey: string | null;
}

export type MessageRetryStartResult =
    | { kind: "started"; log: MessageLogEntity }
    | { kind: "suppressed"; log: MessageLogEntity }
    | { kind: "lost" };

export interface SaveCarrierCheckResultInput {
    id: number;
    expectedMid: string;
    state: CarrierResultState;
    results: unknown[];
    checkedAt: Date;
    failureMessage: string | null;
}

/**
 * "saved": result stored. "saved_status_failed": result stored and the log
 * status was flipped to failed. "stale": no row matched (mid changed by a
 * retry, or the check already ran).
 */
export type SaveCarrierCheckResultOutcome = "saved" | "saved_status_failed" | "stale";

export interface IMessageLogRepository {
    save(log: MessageLogEntity): Promise<MessageLogEntity>;
    update(log: MessageLogEntity, transaction?: Prisma.TransactionClient): Promise<MessageLogEntity>;
    /**
     * Persist (or converge on) one deterministic provider attempt before any
     * external request. Implementations must reject a fingerprint mismatch.
     */
    prepareProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity>;
    /** Atomically claim the prepared row immediately before crossing the network. */
    claimProviderAttempt(log: MessageLogEntity, transaction?: Prisma.TransactionClient): Promise<MessageLogEntity | null>;
    /** Conditionally apply one operator reconciliation to an uncertain attempt. */
    reconcileProviderAttempt(
        log: MessageLogEntity,
        outcome: "delivered" | "not-delivered",
        actor: string,
        reason: string,
        providerMessageId?: string | null,
    ): Promise<MessageLogEntity | null>;
    startRetryAttempt(
        sourceLog: MessageLogEntity,
        retryLog: MessageLogEntity,
        invocation: MessageRetryInvocation,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageRetryStartResult>;
    findByIdInBranch(branchId: string, id: number): Promise<MessageLogEntity | null>;
    findSentTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>>;
    findUncertainTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>>;
    findPendingRetriesSystemScope(): Promise<MessageLogEntity[]>;
    /** aligo_sms rows whose one-shot carrier check is due (system scope, no branch filter). */
    findCarrierChecksDueSystemScope(limit: number, now?: Date): Promise<MessageLogEntity[]>;
    /**
     * Atomically store a carrier check result. Only matches id + expected mid
     * with a check still pending; flips sent/accepted-pending rows to failed
     * when the carrier reported failure. Never touches provider acceptance
     * fields or client.serviceEndNoticeSentAt.
     */
    saveCarrierCheckResult(input: SaveCarrierCheckResultInput): Promise<SaveCarrierCheckResultOutcome>;
    /**
     * Push a still-due carrier check out to `until` (backoff for a row whose
     * processing threw). Conditional on id + expected mid + a pending check, so
     * it never resurrects a checked row. Returns whether a row was updated.
     */
    postponeCarrierCheck(id: number, expectedMid: string, until: Date): Promise<boolean>;
    findRetryableServiceRecordSmsByScheduleId(
        scheduleId: number,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageLogEntity[]>;
    findRecentByBranch(
        branchId: string,
        limit?: number,
        skip?: number,
    ): Promise<MessageLogEntity[]>;
    /**
     * Read one bounded page using the immutable native-id cursor. The
     * snapshot timestamp is an eligibility cutoff only; mutable `updatedAt`
     * is intentionally absent so retries cannot move a row across a boundary.
     */
    findHistoryPageByBranch(
        branchId: string,
        query: MessageHistoryPageQuery,
    ): Promise<MessageLogEntity[]>;
    /**
     * Same cursor/ordering contract as `findHistoryPageByBranch`, restricted to
     * one client inside the branch: rows owned by the client plus unowned rows
     * whose stored phone normalises to the client's phone key.
     */
    findClientHistoryPageByBranch(
        branchId: string,
        scope: ClientHistoryScope,
        query: MessageHistoryPageQuery,
    ): Promise<MessageLogEntity[]>;
}

export const MESSAGE_LOG_REPOSITORY = "MESSAGE_LOG_REPOSITORY";
