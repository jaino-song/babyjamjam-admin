import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    MESSAGE_AUTOMATION_DATABASE,
    MessageAutomationDatabase,
} from "domain/repositories/message-automation-database.repository.interface";

const MESSAGE_AUTOMATION_BRANCH_LOCK_NAMESPACE = "babyjamjam:message-automation-branch";
const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Serialize all message-automation mutations for one branch.
 *
 * The lock is transaction scoped. Callers must perform every read that guards
 * their write through the transaction supplied to the callback and must not
 * open a provider/network boundary while the callback is running.
 */
@Injectable()
export class MessageAutomationBranchLockService {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE)
        private readonly prisma: MessageAutomationDatabase,
    ) {}

    async runExclusive<T>(
        branchId: string,
        work: (transaction: Prisma.TransactionClient) => Promise<T>,
        transaction?: Prisma.TransactionClient,
    ): Promise<T> {
        const normalizedBranchId = branchId.trim();
        if (!normalizedBranchId) {
            throw new Error("Message automation branch lock requires a branch id");
        }

        const runWithLock = async (lockTransaction: Prisma.TransactionClient): Promise<T> => {
            await lockTransaction.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(
                    hashtextextended(
                        ${`${MESSAGE_AUTOMATION_BRANCH_LOCK_NAMESPACE}:${normalizedBranchId}`},
                        0
                    )
                )
            `);
            return work(lockTransaction);
        };

        if (transaction) {
            return runWithLock(transaction);
        }

        return this.prisma.$transaction(runWithLock, {
            maxWait: TRANSACTION_MAX_WAIT_MS,
            timeout: TRANSACTION_TIMEOUT_MS,
        });
    }
}
