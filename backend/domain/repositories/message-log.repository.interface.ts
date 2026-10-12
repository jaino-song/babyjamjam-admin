import { MessageLogEntity } from "domain/entities/message-log.entity";
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
