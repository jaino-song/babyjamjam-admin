import { Module } from "@nestjs/common";

import { EformsignBackupWakeTransport } from "infrastructure/realtime/eformsign-backup-wake-transport";

@Module({
    providers: [{
        provide: EformsignBackupWakeTransport,
        useFactory: () => new EformsignBackupWakeTransport(process.env["VALKEY_URL"]?.trim()),
    }],
    exports: [EformsignBackupWakeTransport],
})
export class EformsignBackupWakeModule {}
