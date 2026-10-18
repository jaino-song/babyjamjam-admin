import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Request } from "express";
import { randomUUID } from "node:crypto";

import { ExportError, hashExportToken, parseExportBearer } from "domain/eformsign-backup/export";
import type { ExportPrincipal } from "domain/eformsign-backup/export";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";

export type EformsignBackupExportRequest = Request & {
    eformsignBackupExportRequestId?: string;
    eformsignBackupExportPrincipal?: ExportPrincipal;
};

type RejectReason = "no-header" | "malformed" | "unknown-or-revoked";

/**
 * Bearer guard for the machine export API (contract D1, 3.6).
 * Only the Authorization header is read: cookies and JWTs are ignored. Every
 * rejection throws the same ExportError("UNAUTHORIZED"); the fixed `reason`
 * enum goes to a debug log and never the token or its hash.
 */
@Injectable()
export class EformsignBackupExportGuard implements CanActivate {
    private readonly logger = new Logger(EformsignBackupExportGuard.name);

    constructor(private readonly credentials: SbEformsignBackupExportCredentialRepository) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<EformsignBackupExportRequest>();
        // First, so the filter can echo it on a 401 as well.
        request.eformsignBackupExportRequestId = randomUUID();

        const header = request.headers.authorization;
        if (header === undefined) this.reject("no-header");
        const token = parseExportBearer(header);
        if (token === null) this.reject("malformed");

        // The lookup is by hash equality in the database, so there is no
        // secret-vs-secret comparison here for timingSafeEqual to protect.
        const credential = await this.credentials.findActiveByTokenHash(hashExportToken(token));
        if (credential === null) this.reject("unknown-or-revoked");

        request.eformsignBackupExportPrincipal = {
            credentialId: credential.id,
            principalId: credential.principalId,
            companyIds: credential.companyIds,
        };
        // Fire and forget: last_used_at is best effort and must not delay or fail the request.
        void Promise.resolve(this.credentials.touchLastUsed(credential.id)).catch(() => undefined);
        return true;
    }

    private reject(reason: RejectReason): never {
        this.logger.debug(`export credential rejected reason=${reason}`);
        throw new ExportError("UNAUTHORIZED");
    }
}
