import { Module } from "@nestjs/common";

import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import {
    EFORMSIGN_WEBHOOK_EVENT_REPOSITORY, IEformsignWebhookEventRepository,
} from "domain/repositories/eformsign-webhook-event.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import { EformsignBackupWakeTransport } from "infrastructure/realtime/eformsign-backup-wake-transport";

import { EformsignBackupWakeModule } from "./eformsign-backup-wake.module";

@Module({
    imports: [DatabaseModule, EformsignBackupWakeModule],
    providers: [
        { provide: EFORMSIGN_WEBHOOK_EVENT_REPOSITORY, useClass: SbEformsignWebhookEventRepository },
        {
            provide: EformsignWebhookEventWriter,
            inject: [EFORMSIGN_WEBHOOK_EVENT_REPOSITORY, EformsignBackupWakeTransport],
            useFactory: (repository: IEformsignWebhookEventRepository, wake: EformsignBackupWakeTransport) =>
                new EformsignWebhookEventWriter(repository, wake),
        },
    ],
    exports: [EformsignWebhookEventWriter],
})
export class EformsignWebhookEventModule {}
