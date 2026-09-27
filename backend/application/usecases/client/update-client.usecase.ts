import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { clientCodeOnlyProblemBody, clientProblemBody } from "application/usecases/client/client-write-validation";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { Prisma } from "@prisma/client";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import {
    cancelAutomaticMessageJobsForClient,
    CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON,
} from "application/services/client-message-automation-policy";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";

export type UpdateClientParams = {
    name?: string;
    address?: string | null;
    phone?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    careCenter?: boolean | null;
    voucherClient?: boolean;
    birthday?: string | null;
    dueDate?: Date | null;
    birthDate?: Date | null;
    serviceStatus?: string | null;
    breastPump?: boolean;
    eDocId?: string | null;
    areaId?: string | null;
    messageAutomationDisabled?: boolean;
};

export class ClientTargetVersionMismatchError extends Error {
    constructor() {
        super("Client changed after approval; review a new proposal");
        this.name = "ClientTargetVersionMismatchError";
    }
}

async function transactionNow(transaction: Prisma.TransactionClient): Promise<Date> {
    if (typeof transaction.$queryRaw === "function") {
        const rows = await transaction.$queryRaw<Array<{ now?: Date }>>(Prisma.sql`
            SELECT CURRENT_TIMESTAMP AS "now"
        `);
        const now = rows[0]?.now;
        if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
    }
    return new Date();
}

@Injectable()
export class UpdateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Optional() @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly database?: MessageAutomationDatabase,
        @Optional() private readonly branchLock?: MessageAutomationBranchLockService,
        @Optional() private readonly messageAutomationIntentService?: MessageAutomationIntentService,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateClientParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity> {
        if (!transaction && updates.messageAutomationDisabled !== undefined && this.database) {
            const write = (tx: Prisma.TransactionClient) => this.execute(branchid, id, updates, tx);
            return this.branchLock
                ? this.branchLock.runExclusive(branchid, write)
                : this.database.$transaction(write);
        }
        assertNonNullableClientPatch(updates);
        const client = transaction
            ? await this.clientRepository.findByIdForUpdate(branchid, id, transaction)
            : await this.clientRepository.findById(branchid, id);
        if (!client) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }

        if (updates.messageAutomationDisabled === true && transaction) {
            await cancelAutomaticMessageJobsForClient(
                transaction,
                branchid,
                id,
                CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON,
            );
        }

        client.update(updates);
        return this.clientRepository.update(branchid, client, transaction);
    }

    /**
     * Approval-bound update. The repository acquires the client row lock,
     * compares the exact target hash and mutates before releasing the lock.
     * This method intentionally has no unlocked fallback.
     */
    async executeApprovedTarget(
        branchid: string,
        id: number,
        updates: UpdateClientParams,
        expectedTargetVersion: string,
        transaction?: Prisma.TransactionClient,
        options: { deferMessageAutomationRecovery?: boolean } = {},
    ): Promise<ClientEntity> {
        if (!transaction && updates.messageAutomationDisabled !== undefined && this.database) {
            const write = (tx: Prisma.TransactionClient) => this.executeApprovedTarget(
                branchid,
                id,
                updates,
                expectedTargetVersion,
                tx,
                options,
            );
            return this.branchLock
                ? this.branchLock.runExclusive(branchid, write)
                : this.database.$transaction(write);
        }
        assertNonNullableClientPatch(updates);
        const current = updates.messageAutomationDisabled !== undefined && transaction
            ? await this.clientRepository.findByIdForUpdate(branchid, id, transaction)
            : null;
        const wasMessageAutomationDisabled = current?.messageAutomationDisabled === true;
        const updated = await this.clientRepository.updateIfTargetVersion(
            branchid,
            id,
            expectedTargetVersion,
            updates,
            transaction,
        );
        if (updated) {
            if (updates.messageAutomationDisabled === true && transaction) {
                await cancelAutomaticMessageJobsForClient(
                    transaction,
                    branchid,
                    id,
                    CLIENT_MESSAGE_AUTOMATION_DISABLED_CANCEL_REASON,
                );
            }
            if (
                updates.messageAutomationDisabled === false
                && wasMessageAutomationDisabled
                && transaction
                && !options.deferMessageAutomationRecovery
            ) {
                if (!this.messageAutomationIntentService) {
                    throw new Error("Message automation recovery is not configured");
                }
                const reenabledAt = await transactionNow(transaction);
                await this.messageAutomationIntentService.persistReenableIntents(transaction, {
                    branchId: branchid,
                    clientId: id,
                    futureOnlyAt: reenabledAt,
                });
            }
            return updated;
        }
        // A null result is intentionally treated as an approval conflict. The
        // repository performed the existence check and target comparison while
        // holding the row lock; do not add an unlocked read or update fallback.
        throw new ClientTargetVersionMismatchError();
    }
}

function assertNonNullableClientPatch(updates: UpdateClientParams): void {
    for (const field of ["name", "voucherClient", "breastPump"] as const) {
        if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] === null) {
            throw new BadRequestException(clientProblemBody("VALIDATION_FAILED", {
                pointer: `/${field}`,
                code: "REQUIRED",
                detail: `${field} 항목은 비울 수 없습니다.`,
                location: "body",
            }));
        }
    }
}
