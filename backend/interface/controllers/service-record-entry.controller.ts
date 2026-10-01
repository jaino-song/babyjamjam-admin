import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    Req,
    ParseIntPipe,
    Query,
    UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import { IsDefined, IsInt, Max, Min } from "class-validator";
import { Request } from "express";
import type { HolidayYearPayload } from "@babyjamjam/shared/utils/holiday-calendar";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ServiceRecordTokenContext } from "application/services/service-record-token.service";
import {
    VerifyServiceRecordPhoneDto,
    SaveServiceHeaderDto,
    UpsertSessionDto,
} from "interface/dto/service-record-entry.dto";

type ServiceRecordRequest = Request & { serviceRecordContext: ServiceRecordTokenContext };

/** `?year=` of the token-page holiday read; unlike the admin read it is required. */
export class ServiceRecordHolidaysQueryDto {
    @IsDefined()
    @Type(() => Number)
    @IsInt()
    @Min(2000)
    @Max(2100)
    year!: number;
}

/**
 * No-login 제공기록지 endpoints (BJJ-247).
 * `link/:token` + `verify` are public (link token + phone). Everything else is behind
 * ServiceRecordGuard and reads the assignment context off the request.
 */
@Controller("service-record")
export class ServiceRecordEntryController {
    constructor(
        private readonly service: ServiceRecordEntryService,
        private readonly scheduleChangeService: ScheduleChangeService,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    @Get("link/:linkToken")
    @UseGuards(RateLimitGuard)
    linkStatus(@Param("linkToken") linkToken: string) {
        return this.service.linkStatus(linkToken);
    }

    @Post("verify")
    @UseGuards(RateLimitGuard)
    verify(@Body() dto: VerifyServiceRecordPhoneDto) {
        return this.service.verify(dto.linkToken, dto.phone);
    }

    @UseGuards(ServiceRecordGuard)
    @Get("context")
    getContext(@Req() req: ServiceRecordRequest) {
        return this.service.getContext(req.serviceRecordContext);
    }

    /**
     * The branch's effective holidays for the caregiver page. The branch comes
     * from the link token, never from the request; branch-excluded dates are
     * omitted and branch additions are included.
     */
    @UseGuards(ServiceRecordGuard)
    @Get("holidays")
    async getHolidays(
        @Req() req: ServiceRecordRequest,
        @Query() query: ServiceRecordHolidaysQueryDto,
    ): Promise<HolidayYearPayload> {
        const effective = await this.holidayCalendar.getEffectiveYear(
            req.serviceRecordContext.branchId,
            query.year,
        );
        return {
            year: effective.year,
            revision: effective.revision,
            supported: effective.supported,
            holidays: effective.holidays
                .filter((holiday) => !holiday.excluded)
                .map(({ date, name }) => ({ date, name })),
        };
    }

    @UseGuards(ServiceRecordGuard)
    @Get("schedule-change/preview")
    previewScheduleChange(@Req() req: ServiceRecordRequest) {
        return this.scheduleChangeService.preview(req.serviceRecordContext);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("schedule-change")
    createScheduleChange(@Req() req: ServiceRecordRequest) {
        return this.scheduleChangeService.createRequest(req.serviceRecordContext);
    }

    @UseGuards(ServiceRecordGuard)
    @Put("header")
    saveHeader(@Req() req: ServiceRecordRequest, @Body() dto: SaveServiceHeaderDto) {
        return this.service.saveHeader(req.serviceRecordContext, dto);
    }

    @UseGuards(ServiceRecordGuard)
    @Put("sessions/:index")
    saveSession(
        @Req() req: ServiceRecordRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.serviceRecordContext, index, dto, false);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("sessions/:index/submit")
    submitSession(
        @Req() req: ServiceRecordRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.serviceRecordContext, index, dto, true);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("finalize")
    finalize(@Req() req: ServiceRecordRequest) {
        return this.service.finalize(req.serviceRecordContext);
    }
}
