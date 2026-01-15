import { Module } from "@nestjs/common";
import { SystemSettingModule } from "./system-setting.module";
import { ChannelTalkModule } from "./channeltalk.module";
import { AligoModule } from "./aligo.module";
import { AlimtalkService } from "application/services/alimtalk.service";
import { AlimtalkSchedulerService } from "application/services/alimtalk-scheduler.service";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    imports: [SystemSettingModule, ChannelTalkModule, AligoModule],
    providers: [
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        PrismaService,
        AlimtalkService,
        AlimtalkSchedulerService,
    ],
    exports: [AlimtalkService],
})
export class AlimtalkModule {}
