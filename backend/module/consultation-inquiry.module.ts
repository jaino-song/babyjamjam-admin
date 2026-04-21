import { Module } from "@nestjs/common";

import { ConsultationInquiryService } from "application/services/consultation-inquiry.service";
import { CONSULTATION_INQUIRY_REPOSITORY } from "domain/repositories/consultation-inquiry.repository.interface";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbConsultationInquiryRepository } from "infrastructure/database/repositories/sb.consultation-inquiry.repository";
import {
    ConsultationInquiryController,
    PublicConsultationInquiryController,
} from "interface/controllers/consultation-inquiry.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [PublicConsultationInquiryController, ConsultationInquiryController],
    providers: [
        { provide: CONSULTATION_INQUIRY_REPOSITORY, useClass: SbConsultationInquiryRepository },
        ConsultationInquiryService,
        RateLimitGuard,
    ],
})
export class ConsultationInquiryModule {}
