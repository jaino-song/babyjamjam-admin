import { Module } from "@nestjs/common";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AligoModule } from "module/aligo.module";
import { AlimtalkModule } from "module/alimtalk.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { ServiceFeedbackController } from "interface/controllers/service-feedback.controller";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";
import { ServiceFeedbackService } from "application/services/service-feedback.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { EmployeeFeedbackTokenService } from "application/services/employee-feedback-token.service";
import { EmployeeFeedbackLinkService } from "application/services/employee-feedback-link.service";
import { EmployeeFeedbackGuard } from "infrastructure/auth/employee-feedback.guard";

/**
 * No-login daily service feedback capture (BJJ-247).
 * Exports the token + link services so the assignment / replacement / termination
 * hooks (employee-schedule + client modules) can issue and revoke links.
 */
@Module({
    imports: [DatabaseModule, AligoModule, AlimtalkModule, EformsignDocModule],
    controllers: [ServiceFeedbackController, ScheduleChangeController],
    providers: [
        ServiceFeedbackService,
        ScheduleChangeService,
        EmployeeFeedbackTokenService,
        EmployeeFeedbackLinkService,
        EmployeeFeedbackGuard,
    ],
    exports: [EmployeeFeedbackTokenService, EmployeeFeedbackLinkService],
})
export class ServiceFeedbackModule {}
