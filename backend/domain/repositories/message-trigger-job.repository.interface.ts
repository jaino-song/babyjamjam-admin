import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import type { Prisma } from "@prisma/client";
import type { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import type { ClientHistoryScope, MessageHistoryPageQuery } from "domain/repositories/message-log.repository.interface";

export interface MessageTriggerJobCancellationScope {
    clientId?: number;
    employeeScheduleId?: number;
    scheduledBefore?: Date;
    /** Supersede refusals only for removed sources or a dispatchable rebuild. */
    needsSetup?: "all" | "within_window";
}

/** Internal review read; user cancellation is needed to match the existing upsert fence. */
export type MessageTriggerJobReviewSnapshot = MessageTriggerJobEntity & { readonly canceledByUser: boolean };

export type ClientUpcomingMessageTriggerJobStatus = "pending" | "processing" | "dispatching";

/** Safe, client-scoped projection for the customer notification schedule. */
export interface ClientUpcomingMessageTriggerJobRecord {
    id: string;
    ruleName: string;
    templateKey: string;
    status: ClientUpcomingMessageTriggerJobStatus;
    scheduledFor: Date;
    nextAttemptAt: Date | null;
    effectiveDueAt: Date;
    recipientType: string;
    recipientName: string | null;
}

export interface ClientUpcomingMessageTriggerJobCursor {
    effectiveDueAt: Date;
    id: string;
}

/**
 * Outcome of replacing a schedule's not-yet-started jobs with one manual job.
 * `in_flight` means a job was already claimed by the dispatcher
 * (`processing`/`dispatching`); nothing was written in that case.
 * `lock_timeout` means the rule or a job row stayed locked by another
 * transaction for longer than the fence is willing to wait; nothing was
 * written and the caller should ask the user to retry.
 */
export type ReplacePendingJobsResult =
    | { kind: "replaced"; job: MessageTriggerJobEntity; canceledJobIds: string[] }
    | { kind: "in_flight"; inFlightJobIds: string[] }
    | { kind: "lock_timeout" }
    | { kind: "link_revoked" };

/**
 * Outcome of claiming a provider-rejected job for an action-bound retry.
 * `not_claimable` means the approved source drifted or is no longer retryable.
 * `lock_timeout` means the rule or the source row stayed locked by another
 * transaction for longer than the claim is willing to wait; the transaction
 * aborted, so nothing was written and the caller may safely try again. An
 * interactive-transaction timeout (a thrown P2028) is NOT this outcome: it
 * does not prove nothing committed and stays an unclassified error.
 */
export type ClaimProviderRejectedForRetryResult =
    | { kind: "claimed"; job: MessageTriggerJobEntity }
    | { kind: "not_claimable" }
    | { kind: "lock_timeout" };

/**
 * Guard a job write taken under the schedule fence against a link revoke:
 * the plaintext link token the job's message carries must still be an active,
 * non-revoked token of the schedule, checked under the fence.
 */
export interface ScheduleFenceLinkOptions {
    requireActiveLinkToken?: string;
}

/**
 * Outcome of cancelling a schedule's not-yet-sent jobs. `inFlightJobIds` are
 * jobs the dispatcher had already moved to `dispatching` (a send may already
 * be on its way): they are left untouched and only reported.
 */
export interface CancelPendingJobsResult {
    canceledJobIds: string[];
    inFlightJobIds: string[];
}

export interface IMessageTriggerJobRepository {
    create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    /** Branch-fenced read for request-path callers; a branch mismatch resolves to null, not another branch's row. */
    findByIdInBranch(branchId: string, id: string): Promise<MessageTriggerJobEntity | null>;
    /**
     * Claim only while the branch-scoped rule is not fenced as stale. The
     * returned token is unique to this processing attempt and must be supplied
     * to every terminal update/fence before a provider call.
     */
    claimPendingWithRuleFence(id: string, branchId: string | null, transaction?: Prisma.TransactionClient): Promise<string | null>;
    /**
     * Same rule fence and token as `claimPendingWithRuleFence`, but for a job in
     * `needs_setup` (manual resend). Returns null when the job is not in that
     * state or the rule fence refuses; the row is left unchanged.
     */
    claimNeedsSetupWithRuleFence(id: string, branchId: string | null, transaction?: Prisma.TransactionClient): Promise<string | null>;
    findDuePendingSystemScope(limit?: number): Promise<MessageTriggerJobEntity[]>;
    findStaleProcessingSystemScope(cutoff: Date, limit?: number): Promise<MessageTriggerJobEntity[]>;
    findUpcomingPendingByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    /**
     * Read-only, branch/client-fenced upcoming automation projection. The
     * repository returns only the requested page (including one lookahead row)
     * and never reconciles or mutates jobs.
     */
    findUpcomingByClient(
        branchId: string,
        clientId: number,
        limit: number,
        cursor?: ClientUpcomingMessageTriggerJobCursor,
    ): Promise<ClientUpcomingMessageTriggerJobRecord[]>;
    findTerminalByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    /**
     * Read current failed/canceled history in the same immutable tuple order
     * as message logs. The application cutoff fences immutable createdAt only;
     * current status is intentionally read as of each request.
     */
    findHistoryPageByBranch(
        branchId: string,
        query: MessageHistoryPageQuery,
    ): Promise<MessageTriggerJobEntity[]>;
    /** `findHistoryPageByBranch` restricted to one client (and its unowned phone matches) in the branch. */
    findClientHistoryPageByBranch(
        branchId: string,
        scope: ClientHistoryScope,
        query: MessageHistoryPageQuery,
    ): Promise<MessageTriggerJobEntity[]>;
    /**
     * Terminal (failed or canceled) jobs for a branch whose terminal
     * transition landed in `[since, until)` — `canceledAt` for a canceled
     * row, `updatedAt` for a failed row (there is no dedicated failedAt
     * column; markFailed() always bumps updatedAt at the moment of
     * failure). Excludes rows the user canceled themselves
     * (canceledByUser = true): a cancel the user pressed must never be
     * reported back to them as a problem. Feeds the daily digest.
     */
    findRecentUndeliveredByBranch(
        branchId: string,
        since: Date,
        until: Date,
        limit: number,
    ): Promise<MessageTriggerJobEntity[]>;
    countRecentUndeliveredByBranch(
        branchId: string,
        since: Date,
        until: Date,
    ): Promise<number>;
    findHistoryByBranch(
        branchId: string,
        limit?: number,
        beforeId?: string,
    ): Promise<MessageTriggerJobEntity[]>;
    /** Whether a rule still has active jobs persisted before its current version fence. */
    hasActiveJobsBefore(branchId: string, ruleId: string, before: Date): Promise<boolean>;
    /** Whether a newer qualifying client-rule job exists, answered in the database without a row cap. */
    hasNewerClientRuleSibling(params: {
        branchId: string;
        clientId: number;
        ruleId: string;
        recipientType: MessageTriggerRecipientType;
        excludeJobId: string;
        createdAfter: Date;
    }): Promise<boolean>;
    findPendingByRuleIdsAndClientId(ruleIds: string[], clientId: number): Promise<MessageTriggerJobEntity[]>;
    /** Bounded, ordered read of actual automation generations, including terminal dedupe rows. */
    findForClientAutomationReview(branchId: string, clientId: number, ruleIds: string[], transaction?: Prisma.TransactionClient): Promise<MessageTriggerJobReviewSnapshot[]>;
    findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findSentByRuleIdAndEmployeeScheduleId(
        ruleId: string,
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    /**
     * Cancel, in ONE atomic statement, every `pending` and `processing` job of
     * a rule and employee schedule (a `processing` claim is the reversible
     * one: clearing its token makes the dispatcher's later
     * `processing -> dispatching` authorization a no-op). A `dispatching` job
     * is never touched; its id is returned so the caller knows a send may
     * already have left.
     */
    cancelPendingByRuleAndEmployeeSchedule(
        ruleId: string,
        employeeScheduleId: number,
        reason: string,
    ): Promise<CancelPendingJobsResult>;
    /**
     * `cancelPendingByRuleAndEmployeeSchedule` under the schedule fence, for a
     * revoke/reset: in ONE transaction it takes the schedule advisory lock,
     * cancels the jobs, then runs `afterCancel` with the same transaction (the
     * token revocation), so the cancel and the revocation are atomic against a
     * manual send / automatic promotion of the same schedule. Never takes the
     * rule lock or the branch lock and never gives up on a lock (it must not
     * fail a revoke); `afterCancel` must use only the given transaction.
     */
    cancelPendingUnderScheduleFence(
        ruleId: string,
        employeeScheduleId: number,
        reason: string,
        afterCancel?: (transaction: Prisma.TransactionClient) => Promise<void>,
    ): Promise<CancelPendingJobsResult>;
    /**
     * Cancel one `processing` claim by the token its owner read, in ONE
     * status-predicated statement. A job that has since moved to `dispatching`
     * (same claim token) or been re-claimed is left untouched. Returns whether
     * this call canceled it.
     */
    cancelProcessingClaim(id: string, claimToken: string, reason: string): Promise<boolean>;
    cancelPendingByClientContext(branchId: string, clientId: number, reason: string): Promise<number>;
    cancelOrphanedPending(reason: string, branchId?: string): Promise<number>;
    findRecoverableOrphanedClientJobs(branchId: string, limit?: number): Promise<MessageTriggerJobEntity[]>;
    markOrphanedJobsReconciled(jobIds: string[], replacementClientId: number): Promise<number>;
    cancelPendingByRuleId(ruleId: string, reason: string): Promise<number>;
    cancelPendingOlderThan(ruleId: string, cutoff: Date, reason: string): Promise<number>;
    /**
     * Cancel a single job on the user's behalf. Pending and processing jobs
     * scoped to the given branch are canceled atomically; processing claims
     * are invalidated by clearing their claim token before the pre-provider
     * fence can proceed. The canceled row is marked so the re-sync upsert
     * below never resurrects it. Returns whether the cancel matched a row.
     */
    cancelPendingByUser(id: string, branchId: string, reason: string): Promise<boolean>;
    /**
     * Move one `failed` service-record link job to the system `canceled`
     * pre-booking state so a later schedule claim can revive it. Only the
     * link rule's `failed` row in this branch qualifies, and a row carrying
     * the scheduling-retry lease is left alone. Returns whether a row moved.
     */
    cancelFailedServiceRecordLinkJobForPreBooking(id: string, branchId: string): Promise<boolean>;
    /**
     * Promote only the exact automatic service-record scheduling marker owned
     * by this claim version. A null result means the claim was replaced or
     * otherwise lost and must fail closed without reading/reviving another row.
     */
    promoteAutomaticSchedulingClaim(
        markerId: string,
        expectedClaimVersion: string,
        job: MessageTriggerJobEntity,
        transaction?: Prisma.TransactionClient,
        options?: ScheduleFenceLinkOptions,
    ): Promise<MessageTriggerJobEntity | null>;
    /**
     * Cancel mutable pending jobs only while the branch-scoped rule is at the
     * inspected generation and stale state. Null means the producer lost the
     * generation race and must leave all job rows untouched.
     */
    cancelPendingForRuleGeneration(
        branchId: string,
        ruleId: string,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
        reason: string,
        scope?: MessageTriggerJobCancellationScope,
        transaction?: Prisma.TransactionClient,
    ): Promise<number | null>;
    upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    /**
     * Atomically replace every `pending` job of the replacement's rule and
     * employee schedule with the replacement, unless one is already claimed.
     * Under one transaction the schedule's live jobs are row-locked; if any is
     * `processing`/`dispatching` (claimed by the dispatcher, so a send may
     * already be on its way) nothing is written and `in_flight` is returned.
     * The transaction waits at most one second for any lock; past that nothing
     * is written and `lock_timeout` is returned.
     * Otherwise the pending jobs are canceled with `reason` and the replacement
     * is inserted in the same transaction, so a concurrent dispatcher claim
     * either wins first (-> `in_flight`) or loses against the canceled row.
     * With `options.requireActiveLinkToken`, the link token the replacement
     * carries is re-checked under the fence; a revoked one yields
     * `link_revoked` with nothing written.
     * `afterReplace` runs inside that same transaction once the replacement is
     * inserted, after every schedule/rule/job lock was taken (so any row it
     * locks, e.g. message_log, comes last). If it throws, the cancel and the
     * insert roll back with it: a failure never escapes after a commit.
     */
    replacePendingJobsUnlessInFlight(
        replacement: MessageTriggerJobEntity,
        reason: string,
        options?: ScheduleFenceLinkOptions,
        afterReplace?: (transaction: Prisma.TransactionClient) => Promise<void>,
    ): Promise<ReplacePendingJobsResult>;
    /**
     * Upsert a pending job only while its rule is at the inspected generation
     * and expected stale state. A null result means the producer lost the
     * generation race and must fail closed without touching job rows.
     */
    upsertPendingForRuleGeneration(
        job: MessageTriggerJobEntity,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
        preserveExisting?: boolean,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerJobEntity | null>;
    /**
     * Lock and compare a rejected source job, then create the action-bound
     * retry job in the same transaction. `not_claimable` means the approved
     * source target drifted or is no longer retryable. The transaction waits
     * at most one second for any lock; past that nothing is written and
     * `lock_timeout` is returned.
     */
    claimProviderRejectedForRetry(
        branchId: string,
        sourceJobId: string,
        expectedTargetVersion: string,
        expectedSnapshotHash: string,
        expectedSource: MessageTriggerJobEntity,
        retryJob: MessageTriggerJobEntity,
    ): Promise<ClaimProviderRejectedForRetryResult>;
}

export const MESSAGE_TRIGGER_JOB_REPOSITORY = "MESSAGE_TRIGGER_JOB_REPOSITORY";
