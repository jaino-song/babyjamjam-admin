import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    Req,
    ParseIntPipe,
    UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { ServiceFeedbackService } from "application/services/service-feedback.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { EmployeeFeedbackGuard } from "infrastructure/auth/employee-feedback.guard";
import { FeedbackTokenContext } from "application/services/employee-feedback-token.service";
import {
    VerifyFeedbackPhoneDto,
    SaveServiceHeaderDto,
    UpsertSessionDto,
} from "interface/dto/service-feedback.dto";

type FeedbackRequest = Request & { feedbackContext: FeedbackTokenContext };

/**
 * No-login 제공기록지 endpoints (BJJ-247).
 * `link/:token` + `verify` are public (link token + phone). Everything else is behind
 * EmployeeFeedbackGuard and reads the assignment context off the request.
 */
@Controller("service-feedback")
export class ServiceFeedbackController {
    constructor(
        private readonly service: ServiceFeedbackService,
        private readonly scheduleChangeService: ScheduleChangeService,
    ) {}

    @Get("link/:linkToken")
    linkStatus(@Param("linkToken") linkToken: string) {
        return this.service.linkStatus(linkToken);
    }

    @Post("verify")
    verify(@Body() dto: VerifyFeedbackPhoneDto) {
        return this.service.verify(dto.linkToken, dto.phone);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Get("context")
    getContext(@Req() req: FeedbackRequest) {
        return this.service.getContext(req.feedbackContext);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Get("schedule-change/preview")
    previewScheduleChange(@Req() req: FeedbackRequest) {
        return this.scheduleChangeService.preview(req.feedbackContext);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Post("schedule-change")
    createScheduleChange(@Req() req: FeedbackRequest) {
        return this.scheduleChangeService.createRequest(req.feedbackContext);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Put("header")
    saveHeader(@Req() req: FeedbackRequest, @Body() dto: SaveServiceHeaderDto) {
        return this.service.saveHeader(req.feedbackContext, dto);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Put("sessions/:index")
    saveSession(
        @Req() req: FeedbackRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.feedbackContext, index, dto, false);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Post("sessions/:index/submit")
    submitSession(
        @Req() req: FeedbackRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.feedbackContext, index, dto, true);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Post("finalize")
    finalize(@Req() req: FeedbackRequest) {
        return this.service.finalize(req.feedbackContext);
    }
}
