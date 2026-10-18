import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import { EformsignBackupExportGuard } from "infrastructure/auth/eformsign-backup-export.guard";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";
import { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import { EformsignBackupExportController } from "interface/controllers/eformsign-backup-export.controller";

/**
 * Machine export of the eformsign backup inventory (BJJ-454). Deliberately imports neither
 * EformsignModule nor any module that provides the mirror or provider services: nothing
 * reachable from here can repair, re-download or call out.
 */
@Module({
    imports: [DatabaseModule, ConfigModule],
    controllers: [EformsignBackupExportController],
    providers: [
        EformsignBackupExportGuard,
        SbEformsignBackupExportCredentialRepository,
        SbEformsignBackupExportRepository,
        EformsignBackupExportService,
    ],
})
export class EformsignBackupExportModule {}
