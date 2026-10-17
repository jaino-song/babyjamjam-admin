import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import type {
    CollectionPageObservation, CollectionRunStart, CollectionRunFinish, CollectionWriteGuard,
    IEformsignBackupCollectionRepository,
} from "domain/repositories/eformsign-backup-collection.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

export const COLLECTION_TRANSACTION_OPTIONS = { maxWait: 1_000, timeout: 2_000 } as const;

@Injectable()
export class SbEformsignBackupCollectionRepository implements IEformsignBackupCollectionRepository {
    constructor(private readonly prisma: PrismaService) {}

    async begin(run: CollectionRunStart): Promise<void> {
        await this.prisma.$transaction(async tx => {
            await tx.eformsign_backup_collection_run.create({ data: {
                id: run.id, configuredCompanyId: run.configuredCompanyId, trigger: run.trigger,
                lockMode: run.lockMode, outcome: "started", receiptVersion: 1,
                startedAt: run.startedAt, scanSummary: this.json(run.scanSummary),
            } });
        }, COLLECTION_TRANSACTION_OPTIONS);
    }

    async append(runId: string, page: CollectionPageObservation, guard: CollectionWriteGuard): Promise<void> {
        await this.prisma.$transaction(async tx => {
            await this.lockStarted(tx, runId);
            this.check(guard);
            const { documentType, pass, ordinal, startOffset, requestedLimit, returnedCount, totalCount,
                terminal, outcome, failureCode } = page;
            const data = { runId, documentType, pass, ordinal, startOffset, requestedLimit, returnedCount,
                totalCount, terminal, outcome, failureCode };
            const existing = await tx.eformsign_backup_collection_page.findUnique({
                where: { runId_documentType_pass_ordinal: { runId, documentType, pass, ordinal } },
                select: { runId: true, documentType: true, pass: true, ordinal: true, startOffset: true,
                    requestedLimit: true, returnedCount: true, totalCount: true, terminal: true,
                    outcome: true, failureCode: true },
            });
            this.check(guard);
            if (existing) {
                if (canonicalJson(existing) !== canonicalJson(data)) throw new Error("Receipt conflict");
                return;
            }
            await tx.eformsign_backup_collection_page.create({ data });
        }, COLLECTION_TRANSACTION_OPTIONS);
    }

    async finish(run: CollectionRunFinish, guard: CollectionWriteGuard): Promise<void> {
        // No Promise.race: Prisma owns timeout and rollback, including the final update.
        // Row locking serializes all writes across sessions/processes. A failed guard
        // cannot complete even when a separate failure-marker write is unavailable.
        await this.prisma.$transaction(async tx => {
            const deadline = Date.now() + COLLECTION_TRANSACTION_OPTIONS.timeout;
            const checkCompletion = () => {
                this.check(guard);
                if (Date.now() >= deadline) throw new Error("Receipt deadline exceeded");
            };
            await this.lockStarted(tx, run.id);
            if (run.outcome === "completed") checkCompletion();
            const { count } = await tx.eformsign_backup_collection_run.updateMany({
                where: { id: run.id, outcome: "started" }, data: {
                    outcome: run.outcome, finishedAt: run.finishedAt, failureCode: run.failureCode,
                    scanSummary: this.json(run.scanSummary),
                },
            });
            if (count !== 1) throw new Error("Receipt closed");
            if (run.outcome === "completed") checkCompletion();
        }, COLLECTION_TRANSACTION_OPTIONS);
    }

    private async lockStarted(tx: Prisma.TransactionClient, id: string): Promise<void> {
        const { count } = await tx.eformsign_backup_collection_run.updateMany({
            where: { id, outcome: "started" }, data: { revision: { increment: 1 } },
        });
        if (count !== 1) throw new Error("Receipt closed");
    }
    private check(guard: CollectionWriteGuard): void {
        if (!guard.isHealthy()) throw new Error("Receipt unhealthy");
    }
    private json(value: unknown): Prisma.InputJsonValue {
        return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
    }
}
