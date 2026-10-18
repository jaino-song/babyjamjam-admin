import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    ClientHistoryScope,
    IMessageLogRepository,
    MessageHistoryPageQuery,
    MessageRetryInvocation,
    MessageRetryStartResult,
    SaveCarrierCheckResultInput,
    SaveCarrierCheckResultOutcome,
} from "domain/repositories/message-log.repository.interface";
import { ALIGO_HISTORY_MAX_AGE_MS, ALIGO_HISTORY_MIN_AGE_MS, MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    koreanPhoneStoredDigitCandidates,
    storedPhoneMatchesSql,
} from "./stored-phone-lookup";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import {
    SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON,
    SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-end-notice-message";

@Injectable()
export class SbMessageLogRepository implements IMessageLogRepository {
    private readonly logger = new Logger(SbMessageLogRepository.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Build the branch-pinning fragment for a bare-id where clause. `message_log.branchId`
     * is nullable for legacy rows: when the entity carries no branch, fall back to an
     * id-only where instead of filtering on `branchId: null`, and warn so the legacy write
     * path stays visible.
     */
    private branchWhereFragment(log: MessageLogEntity): { branchId?: string } {
        if (log.branchId == null) {
            this.logger.warn(`message_log_null_branch_write id=${log.id}`);
            return {};
        }
        return { branchId: log.branchId };
    }

    async save(log: MessageLogEntity): Promise<MessageLogEntity> {
        const row = await this.prisma.message_log.create({
            data: MessageLogMapper.toPrismaCreate(log),
        });
        log.markCarrierCheckPersisted();
        return MessageLogMapper.toDomain(row);
    }

    async update(log: MessageLogEntity, transaction?: Prisma.TransactionClient): Promise<MessageLogEntity> {
        const run = async (client: Prisma.TransactionClient): Promise<MessageLogEntity> => {
            const row = await client.message_log.update({
                where: { id: log.id, ...this.branchWhereFragment(log) },
                data: MessageLogMapper.toPrismaUpdate(log),
            });
            if (this.isDeliveredServiceEndNotice(log)) {
                await this.stampServiceEndNoticeSent(client, log);
            }
            return MessageLogMapper.toDomain(row);
        };
        // With a caller-owned transaction the commit is not ours to observe, so the
        // scheduled flag stays set (a rollback must not lose the schedule).
        if (transaction) return run(transaction);
        const persisted = this.isDeliveredServiceEndNotice(log)
            ? await this.prisma.$transaction(run)
            : await run(this.prisma);
        log.markCarrierCheckPersisted();
        return persisted;
    }

    async findServiceRecordLinkClientState(log: MessageLogEntity): Promise<{
        serviceStatus: string | null;
        bookingConfirmedAt: Date | null;
        startDate: Date | null;
        endDate: Date | null;
    } | null> {
        if (!log.branchId) return null;
        const select = { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } as const;
        if (log.triggerJobId) {
            const job = await this.prisma.message_trigger_job.findFirst({
                where: { id: log.triggerJobId, branchId: log.branchId },
                select: { employeeSchedule: { select: { client: { select: { ...select, branchId: true } } } } },
            });
            const client = job?.employeeSchedule?.client;
            if (client?.branchId === log.branchId) {
                return { serviceStatus: client.serviceStatus, startDate: client.startDate, endDate: client.endDate, bookingConfirmedAt: client.bookingConfirmedAt };
            }
        }
        if (log.clientId == null) return null;
        return this.prisma.client.findFirst({
            where: { id: log.clientId, branchId: log.branchId },
            select,
        });
    }

    async prepareProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity> {
        if (!log.providerAcceptanceKey || !log.providerAcceptanceFingerprint) {
            throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
        }

        try {
            return await this.prisma.$transaction(async (transaction) => {
                const existing = await transaction.message_log.findUnique({
                    where: { providerAcceptanceKey: log.providerAcceptanceKey! },
                });
                if (existing) {
                    if (existing.providerAcceptanceFingerprint !== log.providerAcceptanceFingerprint) {
                        throw new Error("SMS provider acceptance fingerprint mismatch");
                    }
                    return MessageLogMapper.toDomain(existing);
                }

                const row = await transaction.message_log.create({
                    data: MessageLogMapper.toPrismaCreate(log),
                });
                return MessageLogMapper.toDomain(row);
            });
        } catch (error) {
            // A concurrent request may win the unique-key race after the
            // transaction's read. Re-read that one key and converge on it.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const existing = await this.prisma.message_log.findUnique({
                    where: { providerAcceptanceKey: log.providerAcceptanceKey },
                });
                if (existing?.providerAcceptanceFingerprint !== log.providerAcceptanceFingerprint) {
                    throw new Error("SMS provider acceptance fingerprint mismatch");
                }
                if (existing) return MessageLogMapper.toDomain(existing);
            }
            throw error;
        }
    }

    async claimProviderAttempt(log: MessageLogEntity, transaction?: Prisma.TransactionClient): Promise<MessageLogEntity | null> {
        if (!log.providerAcceptanceKey || !log.providerAcceptanceFingerprint) {
            throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
        }

        const branchWhere = this.branchWhereFragment(log);
        const client = transaction ?? this.prisma;

        const claimed = await client.message_log.updateMany({
            where: {
                id: log.id,
                ...branchWhere,
                providerAcceptanceKey: log.providerAcceptanceKey,
                providerAcceptanceFingerprint: log.providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
            },
            data: {
                providerAcceptanceState: "started",
                providerCallStartedAt: new Date(Date.now()),
            },
        });
        if (claimed.count !== 1) return null;

        const row = await client.message_log.findUnique({
            where: { id: log.id, ...branchWhere },
        });
        return row ? MessageLogMapper.toDomain(row) : null;
    }

    async reconcileProviderAttempt(
        log: MessageLogEntity,
        outcome: "delivered" | "not-delivered",
        actor: string,
        reason: string,
        providerMessageId?: string | null,
        options?: { retry?: "schedule" | "none"; expectedUpdatedAt?: Date; variables?: Record<string, string> },
    ): Promise<MessageLogEntity | null> {
        const branchWhere = this.branchWhereFragment(log);
        return this.prisma.$transaction(async (transaction) => {
            const current = await transaction.message_log.findUnique({
                where: { id: log.id, ...branchWhere },
            });
            if (!current) return null;

            const currentEntity = MessageLogMapper.toDomain(current);
            if (options?.expectedUpdatedAt && currentEntity.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) return null;
            if (!currentEntity.canReconcileProviderOutcome()) {
                return null;
            }

            const expectedState = currentEntity.providerAcceptanceState;
            const expectedUpdatedAt = currentEntity.updatedAt;
            currentEntity.reconcileProviderOutcome({
                outcome,
                actor,
                reason,
                providerMessageId,
                retry: options?.retry,
            });
            // The reconciliation transition always sets retrySafety before metadata replacement.
            if (options?.variables) currentEntity.variables = { ...options.variables, retrySafety: currentEntity.variables["retrySafety"]! };
            const claimed = await transaction.message_log.updateMany({
                where: {
                    id: log.id,
                    ...branchWhere,
                    providerAcceptanceState: expectedState,
                    updatedAt: expectedUpdatedAt,
                },
                data: MessageLogMapper.toPrismaUpdate(currentEntity),
            });
            if (claimed.count !== 1) return null;

            if (outcome === "delivered") {
                await this.stampServiceEndNoticeSent(transaction, currentEntity);
            }

            const updated = await transaction.message_log.findUnique({
                where: { id: log.id, ...branchWhere },
            });
            return updated ? MessageLogMapper.toDomain(updated) : null;
        });
    }

    async findAligoHistoryCandidatesSystemScope(now: Date, limit: number): Promise<MessageLogEntity[]> {
        const oldest = new Date(now.getTime() - ALIGO_HISTORY_MAX_AGE_MS);
        const newest = new Date(now.getTime() - ALIGO_HISTORY_MIN_AGE_MS);
        // Missing JSON keys must remain eligible (NOT equals on JSON would lose NULLs).
        const ids = await this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT id FROM message_log
            WHERE provider = 'aligo_sms'
              AND provider_acceptance_state IN ('started', 'uncertain')
              AND provider_call_started_at >= ${oldest} AND provider_call_started_at <= ${newest}
              AND variables->>'historyLookup' IS DISTINCT FROM 'exhausted'
              AND variables->>'retrySafety' IS DISTINCT FROM 'partial'
              AND variables->>'msgType' IS DISTINCT FROM 'MMS'
              AND COALESCE(variables->>'scheduledDate', '') = ''
              AND variables->>'testMode' IS DISTINCT FROM 'true'
              AND receiver ~ '^[0-9 +()-]+$'
              AND length(regexp_replace(receiver, '[^0-9]', '', 'g')) BETWEEN 10 AND 11
              AND (variables->>'historyLookupAt' IS NULL OR variables->>'historyLookupAt' <= ${newest.toISOString()})
            ORDER BY provider_call_started_at, id
            LIMIT ${limit}
        `);
        if (ids.length === 0) return [];
        const rows = await this.prisma.message_log.findMany({ where: { id: { in: ids.map(row => row.id) } }, orderBy: [{ providerCallStartedAt: "asc" }, { id: "asc" }] });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findAligoMidsStoredOnOtherLogs(mids: string[], logId: number): Promise<Set<string>> {
        if (mids.length === 0) return new Set();
        const rows = await this.prisma.message_log.findMany({
            where: { id: { not: logId }, aligoMid: { in: mids } }, select: { aligoMid: true },
        });
        return new Set(rows.flatMap(row => row.aligoMid ? [row.aligoMid] : []));
    }

    async claimAligoHistoryBookkeeping(
        log: MessageLogEntity,
        expectedState: "started" | "uncertain",
        expectedUpdatedAt: Date,
    ): Promise<MessageLogEntity | null> {
        return this.prisma.$transaction(async transaction => {
            const branchWhere = this.branchWhereFragment(log);
            const claimed = await transaction.message_log.updateMany({
                where: { id: log.id, ...branchWhere, providerAcceptanceState: expectedState, updatedAt: expectedUpdatedAt },
                data: MessageLogMapper.toPrismaUpdate(log),
            });
            if (claimed.count !== 1) return null;
            const row = await transaction.message_log.findUnique({ where: { id: log.id, ...branchWhere } });
            return row ? MessageLogMapper.toDomain(row) : null;
        });
    }

    private isDeliveredServiceEndNotice(log: MessageLogEntity): boolean {
        return log.templateKey === SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY
            && log.status === "sent"
            && (
                log.providerAcceptanceState === "accepted"
                || log.providerAcceptanceState === "reconciled_delivered"
            )
            && log.providerAcceptedAt !== null
            && log.branchId !== null
            && log.clientId !== null;
    }

    private async stampServiceEndNoticeSent(
        transaction: Prisma.TransactionClient,
        log: MessageLogEntity,
    ): Promise<void> {
        if (!this.isDeliveredServiceEndNotice(log)) return;

        await transaction.client.updateMany({
            where: {
                id: log.clientId!,
                branchId: log.branchId!,
                serviceEndNoticeSentAt: null,
            },
            data: { serviceEndNoticeSentAt: log.providerAcceptedAt! },
        });
    }

    async startRetryAttempt(
        sourceLog: MessageLogEntity,
        retryLog: MessageLogEntity,
        invocation: MessageRetryInvocation,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageRetryStartResult> {
        const run = async (transaction: Prisma.TransactionClient): Promise<MessageRetryStartResult> => {
            const claimedAt = new Date(Date.now());
            if (
                invocation === "automatic"
                && sourceLog.templateKey === SERVICE_END_NOTICE_SMS_LOG_TEMPLATE_KEY
                && sourceLog.branchId !== null
                && sourceLog.clientId !== null
            ) {
                const clients = await transaction.$queryRaw<Array<{
                    service_end_notice_sent_at: Date | null;
                }>>(Prisma.sql`
                    SELECT service_end_notice_sent_at
                    FROM "client"
                    WHERE id = ${sourceLog.clientId}
                      AND branch_id = ${sourceLog.branchId}::uuid
                    FOR UPDATE
                `);
                const client = clients[0];
                if (!client) return { kind: "lost" };
                if (client.service_end_notice_sent_at !== null) {
                    const suppressed = await transaction.message_log.updateMany({
                        where: {
                            id: sourceLog.id,
                            branchId: sourceLog.branchId,
                            status: sourceLog.status,
                            nextRetryAt: sourceLog.nextRetryAt,
                            updatedAt: sourceLog.updatedAt,
                        },
                        data: {
                            status: "failed",
                            errorMessage: SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON,
                            nextRetryAt: null,
                            updatedAt: claimedAt,
                        },
                    });
                    if (suppressed.count !== 1) return { kind: "lost" };

                    sourceLog.status = "failed";
                    sourceLog.errorMessage = SERVICE_END_NOTICE_ALREADY_SENT_CANCEL_REASON;
                    sourceLog.nextRetryAt = null;
                    sourceLog.updatedAt = claimedAt;
                    return { kind: "suppressed", log: sourceLog };
                }
            }

            const claimed = await transaction.message_log.updateMany({
                where: {
                    id: sourceLog.id,
                    branchId: sourceLog.branchId,
                    status: sourceLog.status,
                    nextRetryAt: sourceLog.nextRetryAt,
                    updatedAt: sourceLog.updatedAt,
                },
                data: {
                    nextRetryAt: null,
                    updatedAt: claimedAt,
                },
            });

            if (claimed.count !== 1) {
                return { kind: "lost" };
            }

            const row = await transaction.message_log.create({
                data: MessageLogMapper.toPrismaCreate(retryLog),
            });
            return { kind: "started", log: MessageLogMapper.toDomain(row) };
        };
        return transaction ? run(transaction) : this.prisma.$transaction(run);
    }

    async findByIdInBranch(branchId: string, id: number): Promise<MessageLogEntity | null> {
        const row = await this.prisma.message_log.findFirst({
            where: { id, branchId },
        });
        return row ? MessageLogMapper.toDomain(row) : null;
    }

    async findSentTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>> {
        if (jobIds.length === 0) {
            return new Set<string>();
        }

        const rows = await this.prisma.message_log.findMany({
            where: {
                triggerJobId: { in: jobIds },
                // A carrier-check failure flips status to "failed" after the provider
                // already accepted the send; it still counts as sent (never auto-resend).
                OR: [{ status: "sent" }, { carrierResultState: "failed" }],
            },
            select: { triggerJobId: true },
        });

        return new Set(
            rows
                .map((row) => row.triggerJobId)
                .filter((triggerJobId): triggerJobId is string => Boolean(triggerJobId)),
        );
    }

    async findUncertainTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>> {
        if (jobIds.length === 0) return new Set<string>();

        const rows = await this.prisma.message_log.findMany({
            where: {
                triggerJobId: { in: jobIds },
                providerAcceptanceState: { in: ["started", "uncertain"] },
            },
            select: { triggerJobId: true },
        });

        return new Set(
            rows
                .map((row) => row.triggerJobId)
                .filter((triggerJobId): triggerJobId is string => Boolean(triggerJobId)),
        );
    }

    async findPendingRetriesSystemScope(): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: {
                status: { in: ["pending", "failed"] },
                nextRetryAt: { lte: new Date() },
            },
            orderBy: { nextRetryAt: "asc" },
            take: 50,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findCarrierChecksDueSystemScope(limit: number, now: Date = new Date()): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: {
                provider: "aligo_sms",
                aligoMid: { not: null },
                carrierCheckDueAt: { not: null, lte: now },
            },
            orderBy: [{ carrierCheckDueAt: "asc" }, { id: "asc" }],
            take: limit,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async saveCarrierCheckResult(input: SaveCarrierCheckResultInput): Promise<SaveCarrierCheckResultOutcome> {
        const carrierData = {
            carrierCheckDueAt: null,
            carrierCheckedAt: input.checkedAt,
            carrierResultState: input.state,
            carrierResults: input.results as Prisma.InputJsonValue,
        };
        const matchBase = {
            id: input.id,
            aligoMid: input.expectedMid,
            carrierCheckDueAt: { not: null },
        } satisfies Prisma.message_logWhereInput;

        return this.prisma.$transaction(async (transaction) => {
            if (input.state === "failed") {
                // Reserved sends stay "pending" after acceptance, so both
                // "sent" and accepted-"pending" rows are flipped.
                const flipped = await transaction.message_log.updateMany({
                    where: {
                        ...matchBase,
                        OR: [
                            { status: "sent" },
                            { status: "pending", providerAcceptanceState: "accepted" },
                        ],
                    },
                    data: {
                        ...carrierData,
                        status: "failed",
                        errorMessage: input.failureMessage,
                        nextRetryAt: null,
                    },
                });
                if (flipped.count === 1) return "saved_status_failed";
            }

            const saved = await transaction.message_log.updateMany({
                where: matchBase,
                data: carrierData,
            });
            return saved.count === 1 ? "saved" : "stale";
        });
    }

    async postponeCarrierCheck(id: number, expectedMid: string, until: Date): Promise<boolean> {
        const result = await this.prisma.message_log.updateMany({
            where: { id, aligoMid: expectedMid, carrierCheckDueAt: { not: null } },
            data: { carrierCheckDueAt: until },
        });
        return result.count === 1;
    }

    async findRetryFamilyInBranch(branchId: string, id: number): Promise<MessageLogEntity[]> {
        // UNION (not UNION ALL) also terminates malformed cyclic retry chains.
        // Compare JSON text to id text: a malformed retryOfLogId must not cause a cast failure.
        const ids = await this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            WITH RECURSIVE ancestors AS (
                SELECT id, variables FROM message_log
                WHERE branch_id = ${branchId}::uuid AND id = ${id}
                UNION
                SELECT parent.id, parent.variables FROM message_log AS parent
                JOIN ancestors ON parent.id::text = ancestors.variables->>'retryOfLogId'
                WHERE parent.branch_id = ${branchId}::uuid
            ), family AS (
                SELECT id FROM ancestors
                UNION
                SELECT child.id FROM message_log AS child
                JOIN family ON child.variables->>'retryOfLogId' = family.id::text
                WHERE child.branch_id = ${branchId}::uuid
            )
            SELECT id FROM family
        `);
        if (ids.length === 0) return [];
        const rows = await this.prisma.message_log.findMany({
            where: { branchId, id: { in: ids.map((row) => row.id) } },
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async hasNewerServiceRecordSmsInBranch(branchId: string, source: MessageLogEntity): Promise<boolean> {
        // Compare stored timestamps, not JS Dates which truncate sub-millisecond precision.
        const [result] = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
            WITH source AS (
                SELECT log.id, log.created_at,
                    COALESCE(NULLIF(log.variables->>'scheduleId', ''), job.employee_schedule_id::text) AS schedule_id
                FROM message_log AS log
                LEFT JOIN message_trigger_job AS job
                    ON job.id = log.trigger_job_id AND job.branch_id = ${branchId}::uuid
                WHERE log.id = ${source.id} AND log.branch_id = ${branchId}::uuid
            )
            SELECT EXISTS (
                SELECT 1 FROM message_log AS newer
                JOIN source ON newer.created_at > source.created_at AND newer.id <> source.id
                WHERE newer.branch_id = ${branchId}::uuid
                  AND newer.provider = 'aligo_sms'
                  AND newer.template_key = ${SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY}
                  AND newer.status <> 'failed'
                  AND (
                      newer.variables->>'scheduleId' = source.schedule_id
                      OR EXISTS (
                          SELECT 1 FROM message_trigger_job AS job
                          WHERE job.id = newer.trigger_job_id
                            AND job.branch_id = ${branchId}::uuid
                            AND job.rule_id = ${SERVICE_RECORD_LINK_RULE_ID}
                            AND job.employee_schedule_id::text = source.schedule_id
                      )
                  )
            ) AS exists
        `);
        return result?.exists === true;
    }

    async findRetryableServiceRecordSmsByScheduleId(
        scheduleId: number,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageLogEntity[]> {
        const client = transaction ?? this.prisma;
        const jobs = await client.message_trigger_job.findMany({
            where: {
                employeeScheduleId: scheduleId,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
            },
            select: { id: true },
        });
        const triggerJobIds = jobs.map((job) => job.id);

        const rows = await client.message_log.findMany({
            where: {
                provider: "aligo_sms",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                status: { in: ["pending", "failed"] },
                nextRetryAt: { not: null },
                OR: [
                    ...(triggerJobIds.length > 0 ? [{ triggerJobId: { in: triggerJobIds } }] : []),
                    { variables: { path: ["scheduleId"], equals: String(scheduleId) } },
                ],
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findRecentByBranch(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: { branchId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findHistoryPageByBranch(
        branchId: string,
        query: MessageHistoryPageQuery,
    ): Promise<MessageLogEntity[]> {
        const after = query.after;
        const afterWhere = after?.source === "log"
            ? { id: { lt: Number(after.nativeId) } }
            : undefined;

        const rows = await this.prisma.message_log.findMany({
            where: {
                branchId,
                // The first page establishes this application-time insertion
                // cutoff; continuations reuse it. Rows committed after the
                // first read, or made visible late, may be deferred until the
                // next fresh history poll. Native id ordering is used for the
                // cursor, so timestamptz(6) precision never enters the
                // continuation tuple.
                createdAt: { lte: query.snapshotAt },
                ...(afterWhere ? { AND: [afterWhere] } : {}),
            },
            orderBy: { id: "desc" },
            take: query.limit,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    /**
     * Ids of this branch's unowned rows (no client id) whose stored phone — in
     * `recipient_phone` or any number of a multi-recipient `receiver` — normalises
     * to the client's phone key. Filtered by branch first (the only usable index),
     * never by raw-string equality.
     *
     * The continuation cursor is applied here, before the limit, and the limit is
     * the page size: a page can never need more than `limit` of these rows, and
     * each page walks on from where the previous one stopped, so the whole
     * history is reachable and nothing is dropped by a fixed global cap.
     */
    private async findUnownedIdsByPhone(
        branchId: string,
        phoneKey: string | null,
        snapshotAt: Date,
        afterId: number | null,
        limit: number,
    ): Promise<number[]> {
        const candidates = koreanPhoneStoredDigitCandidates(phoneKey);
        if (candidates.length === 0) return [];

        const afterFilter = afterId === null ? Prisma.empty : Prisma.sql`AND id < ${afterId}`;
        const rows = await this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT id
            FROM "message_log"
            WHERE branch_id = ${branchId}::uuid
              AND client_id IS NULL
              AND created_at <= ${snapshotAt}
              ${afterFilter}
              AND (
                ${storedPhoneMatchesSql(Prisma.sql`recipient_phone`, candidates)}
                OR ${storedPhoneMatchesSql(Prisma.sql`receiver`, candidates, { splitList: true })}
              )
            ORDER BY id DESC
            LIMIT ${limit}
        `);
        return rows.map((row) => Number(row.id));
    }

    async findClientHistoryPageByBranch(
        branchId: string,
        scope: ClientHistoryScope,
        query: MessageHistoryPageQuery,
    ): Promise<MessageLogEntity[]> {
        const after = query.after;
        const afterWhere = after?.source === "log"
            ? { id: { lt: Number(after.nativeId) } }
            : undefined;
        const unownedIds = await this.findUnownedIdsByPhone(
            branchId,
            scope.phoneKey,
            query.snapshotAt,
            after?.source === "log" ? Number(after.nativeId) : null,
            query.limit,
        );
        const ownerWhere = unownedIds.length > 0
            ? { OR: [{ clientId: scope.clientId }, { clientId: null, id: { in: unownedIds } }] }
            : { clientId: scope.clientId };

        const rows = await this.prisma.message_log.findMany({
            where: {
                // Branch first: message_log has no client index, so the branch
                // index is what bounds this read and what keeps another
                // branch's rows out even if a client id were guessed.
                branchId,
                createdAt: { lte: query.snapshotAt },
                AND: [...(afterWhere ? [afterWhere] : []), ownerWhere],
            },
            orderBy: { id: "desc" },
            take: query.limit,
        });
        return rows.map(MessageLogMapper.toDomain);
    }
}
