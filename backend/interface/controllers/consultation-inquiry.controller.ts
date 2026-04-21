import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";

import { ConsultationInquiryService } from "application/services/consultation-inquiry.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import {
    ConsultationInquiryListQueryDto,
    CreatePublicConsultationInquiryDto,
} from "interface/dto/consultation-inquiry.dto";

@Controller("public/consultation-inquiries")
export class PublicConsultationInquiryController {
    constructor(private readonly service: ConsultationInquiryService) {}

    @Post()
    @UseGuards(RateLimitGuard)
    create(@Body() dto: CreatePublicConsultationInquiryDto) {
        return this.service.createPublicInquiry(dto);
    }
}

@Controller("consultation-inquiries")
@UseGuards(JwtGuard, TenantGuard)
export class ConsultationInquiryController {
    constructor(private readonly service: ConsultationInquiryService) {}

    @Get()
    findAll(
        @CurrentTenant() tenant: { branchId?: string },
        @Query() query: ConsultationInquiryListQueryDto,
    ) {
        return this.service.listForBranch(tenant.branchId ?? "", query);
    }
}
