import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CanceledRetryRule, ICanceledAutomationRetryRepository } from "domain/repositories/canceled-automation-retry.repository.interface";
import {
    MESSAGE_AUTOMATION_DATABASE,
    MessageAutomationDatabase,
} from "domain/repositories/message-automation-database.repository.interface";

const ruleFields = {
    id: true,
    branchId: true,
    name: true,
    isActive: true,
    templateKey: true,
    recipientType: true,
    group: { select: { id: true, name: true, recipientMode: true } },
    canceledRetryEnabledAt: true,
} satisfies Prisma.message_trigger_ruleSelect;

function ruleQuery(branchId: string) {
    return {
        where: {
            deletedAt: null,
            OR: [
                { branchId: null, groupId: null },
                { branchId, OR: [{ groupId: null }, { group: { branchId, deletedAt: null } }] },
            ],
        },
        select: {
            ...ruleFields,
            branchOverrides: {
                where: { branchId },
                select: { isActive: true, canceledRetryEnabledAt: true },
            },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
    } satisfies Prisma.message_trigger_ruleFindManyArgs;
}

type EpochRow = { canceled_retry_enabled_at: Date | null };

// Keep the clock at precisely the timestamp resolution seen by JS callers.
const serverEpoch = Prisma.sql`date_trunc('milliseconds', clock_timestamp())`;
const nextEpoch = Prisma.sql`GREATEST(${serverEpoch}, stored.canceled_retry_last_enabled_at + interval '1 millisecond')`;

@Injectable()
export class CanceledAutomationRetryRepository implements ICanceledAutomationRetryRepository {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE)
        private readonly database: MessageAutomationDatabase,
    ) {}

    list(branchId: string): Promise<CanceledRetryRule[]> {
        return this.database.message_trigger_rule.findMany(ruleQuery(branchId));
    }

    async lockRule(branchId: string, id: string, transaction: Prisma.TransactionClient): Promise<CanceledRetryRule | null> {
        // The branch lock serializes settings and branch activation. The row
        // lock also fences edits to the shared rule made by another branch.
        const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM message_trigger_rule
            WHERE id = ${id} AND deleted_at IS NULL AND group_id IS NULL
              AND (branch_id = ${branchId}::uuid OR branch_id IS NULL)
            FOR UPDATE
        `);
        if (!locked.length) return null;
        const query = ruleQuery(branchId);
        return transaction.message_trigger_rule.findFirst({
            ...query,
            where: { ...query.where, id, groupId: null },
        });
    }

    async lockGroupRules(branchId: string, groupId: string, transaction: Prisma.TransactionClient): Promise<CanceledRetryRule[]> {
        // Group edits take the same branch lock before changing the parent or its rules.
        const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM message_trigger_rule
            WHERE branch_id = ${branchId}::uuid AND group_id = ${groupId} AND deleted_at IS NULL
            ORDER BY id FOR UPDATE
        `);
        if (!locked.length) return [];
        const query = ruleQuery(branchId);
        return transaction.message_trigger_rule.findMany({
            ...query,
            where: { ...query.where, branchId, groupId, id: { in: locked.map(({ id }) => id) } },
        });
    }

    async updateEpoch(
        transaction: Prisma.TransactionClient, branchId: string, rule: CanceledRetryRule, enabled: boolean,
    ): Promise<Date | null> {
        // The service has checked eligibility and idempotence under both locks.
        // Raw SQL avoids touching @updatedAt, part of the rule's generation fence.
        const current = enabled ? nextEpoch : Prisma.sql`NULL::timestamptz`;
        // Sample the next epoch once so the current and last values are identical.
        const assignments = Prisma.sql`(canceled_retry_enabled_at, canceled_retry_last_enabled_at) =
            (SELECT epoch, COALESCE(epoch, stored.canceled_retry_last_enabled_at)
             FROM (SELECT ${current} AS epoch) AS next)`;
        const query = rule.branchId === null
            ? Prisma.sql`
                INSERT INTO message_trigger_rule_branch_override AS stored
                    (branch_id, rule_id, is_active, updated_at, canceled_retry_enabled_at, canceled_retry_last_enabled_at)
                SELECT ${branchId}::uuid, r.id, true, clock_timestamp(), activation.epoch, activation.epoch
                FROM message_trigger_rule AS r
                CROSS JOIN (SELECT CASE WHEN ${enabled} THEN ${serverEpoch} END AS epoch) AS activation
                WHERE r.id = ${rule.id} AND r.branch_id IS NULL AND r.deleted_at IS NULL
                ON CONFLICT (branch_id, rule_id) DO UPDATE SET ${assignments}
                RETURNING canceled_retry_enabled_at
            `
            : Prisma.sql`
                UPDATE message_trigger_rule AS stored SET ${assignments}
                WHERE id = ${rule.id} AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
                RETURNING canceled_retry_enabled_at
            `;
        const [row] = await transaction.$queryRaw<EpochRow[]>(query);
        if (!row) throw new Error("Locked retry routine disappeared");
        return row.canceled_retry_enabled_at;
    }
}
