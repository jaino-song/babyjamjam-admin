import { Module } from "@nestjs/common";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { EFORMSIGN_BACKUP_REPOSITORY } from "domain/repositories/eformsign-backup.repository.interface";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { SbEformsignBackupRepository } from "infrastructure/database/repositories/sb.eformsign-backup.repository";
import { EformsignBackupInternalController } from "interface/controllers/eformsign-backup-internal.controller";
import { EformsignBackupRunsController } from "interface/controllers/eformsign-backup-runs.controller";

@Module({
    controllers: [EformsignBackupInternalController, EformsignBackupRunsController],
    providers: [
        EformsignBackupTokenGuard, OwnerGuard, EformsignBackupService,
        { provide: EFORMSIGN_BACKUP_REPOSITORY, useClass: SbEformsignBackupRepository },
    ],
})
export class EformsignBackupModule {}
