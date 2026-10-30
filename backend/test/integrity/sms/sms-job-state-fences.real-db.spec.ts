import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant, knownDefect } from "../helpers/known-defect";
import { deleteAreaRowsByBranch } from "./sms-wiring.local";

/**
 * SI-SMS-01 — job entity transitions and the persistence fence.
 *
 * The entity's `markSent` / `markFailed` / `cancel` / `markNeedsSetup` / `defer`
 * accept any source state. The question is whether an illegal transition can
 * PERSIST. The repository write is fenced by `claimToken` only when the entity
 * carries one; a claimToken-less entity goes through an unconditional
 * `update()`. Invariant under audit: a terminal job (`sent` / `canceled`)
 * cannot be rewritten.
 *
 * SI-SMS-06 — DB-layer status vocabularies. Only
 * `message_trigger_job_processing_claim_token_check` (status <> 'processing' OR
 * claim_token IS NOT NULL, migration 20260829140000) and
 * `message_log_provider_acceptance_state_check` (migration 20260829000000)
 * exist. Invariant under audit: an out-of-set `message_log.status`,
 * `message_trigger_job.status` or `message_log.carrier_result_state` is
 * rejected by the database.
 */
type JobRow = Awaited<ReturnType<typeof createMessageTriggerJob>>;

/** Rebuilds a live entity from a row with an explicit status and claim token. */
function toEntity(row: JobRow, status: MessageTriggerJobEntity["status"], claimToken: string | null): MessageTriggerJobEntity {
    return MessageTriggerJobEntity.reconstitute(
        row.id, row.branchId, row.ruleId, status,
        row.scheduledFor, row.sentAt, row.canceledAt, row.cancelReason,
        row.clientId, row.employeeScheduleId,
        row.recipientType as MessageTriggerRecipientType, row.recipientPhone,
        row.templateKey as MessageTriggerTemplateKey, row.dedupeKey,
        row.payload as unknown as MessageTriggerJobEntity["payload"],
        row.createdAt, row.updatedAt, row.attempts, row.nextAttemptAt, claimToken,
    );
}

describeReal("SMS job state fences and DB status vocabularies (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let jobRepository: SbMessageTriggerJobRepository;
    const branchIds: string[] = [];

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        jobRepository = new SbMessageTriggerJobRepository(handle.service);
    });

    afterAll(async () => {
        if (tracker) {
            await deleteAreaRowsByBranch(handle.raw, branchIds);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    async function seedBranchAndRule(): Promise<{ branchId: string; ruleId: string }> {
        const branchRow = await createBranch(handle.raw, tracker);
        const branchId = branchRow.id;
        branchIds.push(branchId);
        const ruleRow = await createMessageTriggerRule(handle.raw, tracker, { branchId });
        return { branchId, ruleId: ruleRow.id };
    }

    function jobOverrides(branchId: string, dedupeKey: string) {
        return {
            branchId,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            dedupeKey,
        };
    }

    invariant("SI-SMS-01", "a stale claim token cannot rewrite the job it no longer owns (positive fence control)", async () => {
        const { branchId, ruleId } = await seedBranchAndRule();
        const created = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            ...jobOverrides(branchId, `si-01-fence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            status: "processing",
            claimToken: "claim-token-current",
        });
        // The entity pretends to still own an older attempt of this row.
        const stale = toEntity(created, created.status as MessageTriggerJobEntity["status"], "claim-token-stale");
        stale.markSent();

        await jobRepository.update(stale);

        const reloaded = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } });
        if (reloaded.status !== "processing" || reloaded.claimToken !== "claim-token-current") {
            throw new Error(`claim-token fence lost: status=${reloaded.status} claimToken=${reloaded.claimToken}`);
        }
    });

    knownDefect("SI-SMS-01", "a claimToken-less entity cannot rewrite a terminal (sent) job", async () => {
        const { branchId, ruleId } = await seedBranchAndRule();
        const created = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            ...jobOverrides(branchId, `si-01-sent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            status: "pending",
        });
        tracker.track("message_trigger_job", created.id);

        // Legal-ish lifecycle write first: pending -> sent through the entity.
        const entity = toEntity(created, "pending", null);
        entity.markSent();
        await jobRepository.update(entity);
        const sent = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } });
        if (sent.status !== "sent") throw new Error(`setup failed: expected sent, got ${sent.status}`);

        // The invariant under audit: the terminal row cannot be rewritten.
        // The entity accepts the illegal transition and the claimToken-less
        // repository write is unconditional, so this reloads as failed.
        const staleTerminal = toEntity(sent, "sent", null);
        staleTerminal.markFailed("late failure overwrite");

        await jobRepository.update(staleTerminal);

        const reloaded = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } });
        if (reloaded.status !== "sent") {
            throw new Error(`terminal job was rewritten: sent job is now status=${reloaded.status} cancelReason=${reloaded.cancelReason}`);
        }
    }, /terminal job was rewritten/);

    knownDefect("SI-SMS-01", "a claimToken-less entity cannot cancel-then-resurrect a sent job over a canceled row", async () => {
        const { branchId, ruleId } = await seedBranchAndRule();
        const created = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            ...jobOverrides(branchId, `si-01-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            status: "pending",
        });
        const first = toEntity(created, "pending", null);
        first.cancel("user canceled");
        await jobRepository.update(first);
        const canceled = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } });
        if (canceled.status !== "canceled") throw new Error(`setup failed: expected canceled, got ${canceled.status}`);

        // The entity allows cancel -> sent (canceledAt is even kept), and the
        // claimToken-less write persists it: a canceled job comes back to life
        // as sent without any provider evidence.
        const second = toEntity(created, "canceled", null);
        second.markSent();
        await jobRepository.update(second);

        const reloaded = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } });
        if (reloaded.status !== "canceled") {
            throw new Error(`canceled job was rewritten: status=${reloaded.status} sentAt=${reloaded.sentAt?.toISOString() ?? "null"}`);
        }
    }, /canceled job was rewritten/);

    invariant("SI-SMS-06", "processing without a claim token is rejected by the existing DB CHECK", async () => {
        const { branchId, ruleId } = await seedBranchAndRule();
        const suffix = `si-06-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await expect(
            handle.raw.$executeRaw`
                INSERT INTO "message_trigger_job"
                    (branch_id, rule_id, status, scheduled_for, recipient_type, template_key, dedupe_key, payload, created_at, updated_at)
                VALUES
                    (${branchId}::uuid, ${ruleId}, 'processing', now(), 'CLIENT', 'SERVICE_START_REMINDER', ${`si-06-proc-${suffix}`}, '{}'::jsonb, now(), now())
            `,
        ).rejects.toThrow(/message_trigger_job_processing_claim_token_check/);
    });

    invariant("SI-SMS-06", "an out-of-set provider_acceptance_state is rejected by the existing DB CHECK", async () => {
        const { branchId } = await seedBranchAndRule();
        await expect(
            handle.raw.$executeRaw`
                INSERT INTO "message_log"
                    (branch_id, provider, template_key, receiver, message_body, status, provider_acceptance_state, created_at, updated_at)
                VALUES
                    (${branchId}::uuid, 'aligo_sms', 'SERVICE_START_REMINDER', '01000000000', 'bogus check probe', 'pending', 'bogus', now(), now())
            `,
        ).rejects.toThrow(/message_log_provider_acceptance_state_check/);
    });

    knownDefect("SI-SMS-06", "an out-of-set message_trigger_job.status is rejected by the database", async () => {
        const { branchId, ruleId } = await seedBranchAndRule();
        let rejected = false;
        try {
            await handle.raw.$executeRaw`
                INSERT INTO "message_trigger_job"
                    (branch_id, rule_id, status, scheduled_for, recipient_type, template_key, dedupe_key, payload, created_at, updated_at)
                VALUES
                    (${branchId}::uuid, ${ruleId}, 'bogus', now(), 'CLIENT', 'SERVICE_START_REMINDER', ${`si-06-job-bogus-${Date.now()}`}, '{}'::jsonb, now(), now())
            `;
        } catch (error) {
            rejected = true;
            const message = error instanceof Error ? error.message : String(error);
            if (!/check constraint/i.test(message)) {
                throw new Error(`insert failed for an unrelated reason: ${message}`);
            }
        }
        if (!rejected) {
            throw new Error("message_trigger_job accepted out-of-set status 'bogus'");
        }
    }, /accepted out-of-set status/);

    knownDefect("SI-SMS-06", "an out-of-set message_log.status is rejected by the database", async () => {
        const { branchId } = await seedBranchAndRule();
        let rejected = false;
        try {
            await handle.raw.$executeRaw`
                INSERT INTO "message_log"
                    (branch_id, provider, template_key, receiver, message_body, status, provider_acceptance_state, created_at, updated_at)
                VALUES
                    (${branchId}::uuid, 'aligo_sms', 'SERVICE_START_REMINDER', '01000000000', 'bogus status probe', 'bogus', 'legacy', now(), now())
            `;
        } catch (error) {
            rejected = true;
            const message = error instanceof Error ? error.message : String(error);
            if (!/check constraint/i.test(message)) {
                throw new Error(`insert failed for an unrelated reason: ${message}`);
            }
        }
        if (!rejected) {
            throw new Error("message_log accepted out-of-set status 'bogus'");
        }
    }, /accepted out-of-set status/);

    knownDefect("SI-SMS-06", "an out-of-set message_log.carrier_result_state is rejected by the database", async () => {
        const { branchId } = await seedBranchAndRule();
        const inserted = await handle.raw.message_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: "SERVICE_START_REMINDER",
                receiver: "01000000000",
                messageBody: "carrier state probe",
                status: "sent",
                providerAcceptanceState: "legacy",
            },
        });
        tracker.track("message_log", inserted.id);
        let rejected = false;
        try {
            await handle.raw.$executeRaw`
                UPDATE "message_log"
                SET carrier_result_state = 'bogus'
                WHERE id = ${inserted.id}
            `;
        } catch (error) {
            rejected = true;
            const message = error instanceof Error ? error.message : String(error);
            if (!/check constraint/i.test(message)) {
                throw new Error(`update failed for an unrelated reason: ${message}`);
            }
        }
        if (!rejected) {
            throw new Error("message_log accepted out-of-set carrier_result_state 'bogus'");
        }
    }, /accepted out-of-set carrier_result_state/);
});
