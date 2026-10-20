import { Injectable, Logger } from "@nestjs/common";

import { generateExportToken, hashExportToken } from "domain/eformsign-backup/export";
import { PrismaService } from "infrastructure/database/prisma.service";

export type ActiveExportCredential = {
    id: string;
    principalId: string;
    companyIds: string[];
};

export type ExportCredentialListItem = {
    id: string;
    principalId: string;
    label: string;
    companyIds: string[];
    createdAt: Date;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
};

/**
 * Machine credentials for the eformsign backup export API (BJJ-454 D1).
 * The table has no branchId, so it is not a tenant model and needs no system
 * scope. The raw token is only ever held by `issue`'s caller; this class stores
 * and compares hashes.
 */
@Injectable()
export class SbEformsignBackupExportCredentialRepository {
    private readonly logger = new Logger(SbEformsignBackupExportCredentialRepository.name);

    constructor(private readonly prisma: PrismaService) {}

    /** One indexed lookup on the unique hash; no cache, so revocation applies on the next call. */
    async findActiveByTokenHash(tokenHash: string): Promise<ActiveExportCredential | null> {
        const row = await this.prisma.eformsign_backup_export_credential.findFirst({
            where: { tokenHash, revokedAt: null },
            select: { id: true, principalId: true, companyIds: true },
        });
        return row ? { id: row.id, principalId: row.principalId, companyIds: row.companyIds } : null;
    }

    /** Best effort: a failed touch must never fail the request that triggered it. */
    async touchLastUsed(id: string): Promise<void> {
        try {
            await this.prisma.eformsign_backup_export_credential.updateMany({
                where: { id },
                data: { lastUsedAt: new Date() },
            });
        } catch (error) {
            // The error text is not logged: it can echo query parameters.
            this.logger.debug(`Failed to touch last_used_at (${error instanceof Error ? error.name : "unknown"})`);
        }
    }

    async issue(input: { principalId: string; label: string; companyIds: string[] }): Promise<{ id: string; token: string }> {
        const token = generateExportToken();
        const row = await this.prisma.eformsign_backup_export_credential.create({
            data: {
                principalId: input.principalId,
                label: input.label,
                tokenHash: hashExportToken(token),
                companyIds: input.companyIds,
            },
            select: { id: true },
        });
        return { id: row.id, token };
    }

    /** Returns whether a row changed: an unknown or already revoked id is `false`. */
    async revoke(id: string): Promise<boolean> {
        const result = await this.prisma.eformsign_backup_export_credential.updateMany({
            where: { id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return result.count > 0;
    }

    /** Never selects the hash. */
    async list(): Promise<ExportCredentialListItem[]> {
        return this.prisma.eformsign_backup_export_credential.findMany({
            select: {
                id: true,
                principalId: true,
                label: true,
                companyIds: true,
                createdAt: true,
                revokedAt: true,
                lastUsedAt: true,
            },
            orderBy: { createdAt: "asc" },
        });
    }
}
