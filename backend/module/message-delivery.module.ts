import { Module } from "@nestjs/common";
import { AligoModule } from "./aligo.module";
import { SystemSettingModule } from "./system-setting.module";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";

@Module({
    imports: [AligoModule, SystemSettingModule],
    controllers: [MessageDeliveryController],
})
export class MessageDeliveryModule {}
