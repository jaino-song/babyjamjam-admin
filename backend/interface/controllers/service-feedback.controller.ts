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
import { EmployeeFeedbackGuard } from "infrastructure/auth/employee-feedback.guard";
import { FeedbackTokenContext } from "application/services/employee-feedback-token.service";
import {
    VerifyFeedbackDobDto,
    SaveServiceHeaderDto,
    UpsertSessionDto,
} from "interface/dto/service-feedback.dto";

type FeedbackRequest = Request & { feedbackContext: FeedbackTokenContext };

/**
 * No-login 제공기록지 endpoints (BJJ-247).
 * `link/:token` + `verify` are public (link token + DOB). Everything else is behind
 * EmployeeFeedbackGuard and reads the assignment context off the request.
 */
@Controller("service-feedback")
export class ServiceFeedbackController {
    constructor(private readonly service: ServiceFeedbackService) {}

    @Get("link/:linkToken")
    linkStatus(@Param("linkToken") linkToken: string) {
        return this.service.linkStatus(linkToken);
    }

    @Post("verify")
    verify(@Body() dto: VerifyFeedbackDobDto) {
        return this.service.verify(dto.linkToken, dto.dob);
    }

    @UseGuards(EmployeeFeedbackGuard)
    @Get("context")
    getContext(@Req() req: FeedbackRequest) {
        return this.service.getContext(req.feedbackContext);
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
