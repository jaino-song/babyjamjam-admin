import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AIChatController } from "interface/controllers/ai-chat.controller";
import { AIChatService } from "application/services/ai-chat.service";
import { ToolExecutorService } from "application/ai-chat/tool-executor.service";
import { GeminiChatGateway } from "infrastructure/api/gemini-chat.gateway";
import { ChatSessionModule } from "./chat-session.module";
import { ClientModule } from "./client.module";
import { EmployeeModule } from "./employee.module";
import { MessageModule } from "./message.module";
import { AreaTemplateModule } from "./area-template.module";
import { EformsignDocModule } from "./eformsign-doc.module";
import { VoucherPriceInfoModule } from "./voucher-price-info.module";
import { BankAccountInfoModule } from "./bank-account-info.module";
import { EmployeeScheduleModule } from "./employee-schedule.module";

@Module({
    imports: [
        ConfigModule,
        ChatSessionModule,
        ClientModule,
        EmployeeModule,
        MessageModule,
        AreaTemplateModule,
        EformsignDocModule,
        VoucherPriceInfoModule,
        BankAccountInfoModule,
        EmployeeScheduleModule,
    ],
    controllers: [AIChatController],
    providers: [
        GeminiChatGateway,
        ToolExecutorService,
        AIChatService,
    ],
    exports: [AIChatService],
})
export class AIChatModule {}
