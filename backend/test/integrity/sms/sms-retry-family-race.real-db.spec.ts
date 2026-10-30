import { ConflictException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant } from "../helpers/known-defect";
import {
    deleteAreaRowsByBranch,
    noopApprovalStub,
    smsRetryFamilyLockKey,
    waitUntilBlocked,
    wireMessageTriggerService,
} from "./sms-wiring.local";

/**
 * SI-SMS-05 — two concurrent manual retries of the same failed log.
 *
 * The manual retry fence (`startRetryAttempt`, manual branch) takes the
 * recursive retry-family advisory lock, re-reads the family under it, and CASes
 * the source row (`status`, `nextRetryAt`, `updatedAt`) before inserting the
 * attempt. The attempt row carries `retryOfLogId` (lineage lives only in the
 * `variables` JSON) and a provider-acceptance key that pins the source
 * revision + attempt number.
 *
 * Invariant under audit: two concurrent manual retries of one failed log
 * produce AT MOST ONE new send (one attempt row, one provider call); the loser
 * surfaces as a 409 conflict and never crosses the provider boundary. The
 * interleaving is forced by holding the family advisory lock on a second
 * connection and proving the blocked wait from `pg_stat_activity`.
 *
 * Builds on (does not duplicate) `test/prisma/message-log-retry-families.real-db.spec.ts`,
 * which pins the ancestor-walk query itself.
 */
describeReal("SMS concurrent manual retry family (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) {
            if (branchId) await deleteAreaRowsByBranch(handle.raw, [branchId]);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    function approvedProviderResult(receiver: string, mid: string): Record<string, unknown> {
        return {
            request: { receiver },
            response: { result_code: 1, message: "정상 접수", success_cnt: 1, error_cnt: 0, msg_id: mid, msgType: "SMS" },
        };
    }

    async function seedFailedLog(): Promise<number> {
        if (!branchId) {
            const branchRow = await createBranch(handle.raw, tracker);
            branchId = branchRow.id;
        }
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const log = await handle.raw.message_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: "SERVICE_START_REMINDER",
                receiver: "01000000003",
                messageBody: `SI-SMS-05 不确定状态失败源 ${suffix}`,
                variables: { automationKey: "SERVICE_INFO_SMS" },
                status: "failed",
                errorMessage: "일시적 실패",
                attempts: 1,
                lastAttemptAt: new Date(Date.now() - 10 * 60 * 1000),
                nextRetryAt: new Date(Date.now() - 5 * 60 * 1000),
                providerAcceptanceKey: `sms:si-05-source-${suffix}`,
                providerAcceptanceFingerprint: `fp-${suffix}`,
                providerAcceptanceState: "rejected",
                providerCallStartedAt: new Date(Date.now() - 10 * 60 * 1000),
            },
        });
        tracker.track("message_log", log.id);
        return log.id;
    }

    function retryServiceWith(sendSms: jest.Mock): SmsRetryService {
        const logRepository = new SbMessageLogRepository(handle.service);
        const { jobRepository } = wireMessageTriggerService(handle, branchId);
        return new SmsRetryService(
            logRepository,
            { sendSms } as unknown as AligoService,
            noopApprovalStub() as unknown as ConstructorParameters<typeof SmsRetryService>[2],
            new SmsProviderAcceptanceService(logRepository),
            undefined,
            undefined,
            undefined,
            jobRepository,
            undefined,
        );
    }

    invariant("SI-SMS-05", "two concurrent manual retries of one failed log produce exactly one send", async () => {
        const sourceLogId = await seedFailedLog();
        const sourceRow = await handle.raw.message_log.findUniqueOrThrow({ where: { id: sourceLogId } });

        let aligoCalls = 0;
        const sendSms = jest.fn().mockImplementation(async () => {
            aligoCalls += 1;
            return approvedProviderResult("01000000003", `si-05-mid-${aligoCalls}`);
        });
        const service = retryServiceWith(sendSms);

        // Hold the family advisory lock on a second connection, queue both
        // manual retries behind it, prove they really wait, then release so the
        // two transactions run serialized through the same fence.
        const settle = (promise: Promise<MessageLogEntity>): Promise<RetryOutcome> => promise
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }));
        type RetryOutcome = { ok: boolean; value?: unknown; error?: unknown };
        let retry1: Promise<RetryOutcome>;
        let retry2: Promise<RetryOutcome>;        await handle.raw.$transaction(async (holderTx) => {
            await holderTx.$queryRaw`
                SELECT pg_advisory_xact_lock(hashtextextended(${smsRetryFamilyLockKey(branchId, sourceLogId)}, 0))::text
            `;
            retry1 = settle(service.retryById(branchId, sourceLogId));
            retry2 = settle(service.retryById(branchId, sourceLogId));
            // The two retry transactions are queued on THIS lock: prove the wait
            // from the database's own view before releasing the fence.
            await waitUntilBlocked(handle.raw, /pg_advisory_xact_lock/);
        }, { timeout: 30_000 });

        const results = await Promise.all([retry1!, retry2!]);
        const succeeded = results.filter((result) => result.ok);
        const failed = results.filter((result) => !result.ok);
        if (succeeded.length !== 1 || failed.length !== 1) {
            throw new Error(
                `expected one success and one conflict, got ${succeeded.length}/${failed.length}: ${JSON.stringify(
                    failed.map((failure) => ({
                        message: failure.error instanceof Error ? failure.error.message : String(failure.error),
                    })),
                )}`,
            );
        }

        // The loser must surface the catalog conflict (HTTP 409 REQUEST_CONFLICT),
        // not an unclassified failure such as the P2002 unique-violation the fence
        // would leak if the family re-read under the advisory lock and the
        // source-row CAS were removed together: only the calibrated 409 lets the
        // UI/agent distinguish "someone already retried this" from a crash.
        const loserError = failed[0]!.error;
        if (!(loserError instanceof ConflictException) || loserError.getStatus() !== 409) {
            throw new Error(
                `the losing retry did not surface ConflictException (409): ` +
                    `${loserError instanceof Error ? `${loserError.name}: ${loserError.message}` : String(loserError)}`,
            );
        }

        const attempts = await handle.raw.message_log.findMany({
            where: { branchId, variables: { path: ["retryOfLogId"], equals: String(sourceLogId) } },
        });
        if (attempts.length !== 1) {
            throw new Error(`concurrent manual retries produced ${attempts.length} attempt rows (must be 1)`);
        }
        if (aligoCalls > 1) {
            throw new Error(`the provider was called ${aligoCalls} times for one retry family`);
        }
        const sourceAfter = await handle.raw.message_log.findUniqueOrThrow({ where: { id: sourceLogId } });
        if (sourceAfter.providerAcceptanceFingerprint !== sourceRow.providerAcceptanceFingerprint) {
            throw new Error("the source log fingerprint changed during the retries");
        }
    });
});
