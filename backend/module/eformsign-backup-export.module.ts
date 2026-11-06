import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EformsignManualBackupService } from "application/services/eformsign-manual-backup.service";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { EformsignManualBackupController } from "interface/controllers/eformsign-manual-backup.controller";
import { EformsignManualBackupWorkerController } from "interface/controllers/eformsign-manual-backup-worker.controller";

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
    imports: [DatabaseModule, ConfigModule, TenantModule],
    controllers: [EformsignBackupExportController, EformsignManualBackupController, EformsignManualBackupWorkerController],
    providers: [
        EformsignBackupExportGuard,
        SbEformsignBackupExportCredentialRepository,
        SbEformsignBackupExportRepository,
        EformsignBackupExportService,
        JwtGuard, TenantGuard, BranchManagerGuard,
        SbEformsignBackupRunRepository,
        {
            provide: EformsignManualBackupService,
            inject: [SbEformsignBackupRunRepository, EformsignBackupExportService, ConfigService],
            useFactory: (repository: SbEformsignBackupRunRepository, exportService: EformsignBackupExportService, config: ConfigService) =>
                new EformsignManualBackupService(repository, exportService, config),
        },
    ],
})
export class EformsignBackupExportModule {}
