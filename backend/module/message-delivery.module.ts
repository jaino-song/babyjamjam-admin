import { Module } from "@nestjs/common";
import { AligoModule } from "./aligo.module";
import { SystemSettingModule } from "./system-setting.module";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";

@Module({
    imports: [AligoModule, SystemSettingModule],
    controllers: [MessageDeliveryController],
    providers: [BranchManagerGuard],
})
export class MessageDeliveryModule {}
