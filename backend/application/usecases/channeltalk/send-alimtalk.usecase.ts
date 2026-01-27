import { Injectable, Logger } from "@nestjs/common";
import { UpsertUserUsecase } from "./upsert-user.usecase";
import { CreateEventUsecase } from "./create-event.usecase";
import { UpsertChannelTalkUserDto, CreateChannelTalkEventDto } from "application/dto/channeltalk";
import { ChannelTalkUser, ChannelTalkEvent } from "domain/ports/channeltalk-api.port";

interface SendAlimtalkResult {
    user: ChannelTalkUser;
    event: ChannelTalkEvent;
}

@Injectable()
export class SendAlimtalkUsecase {
    private readonly logger = new Logger(SendAlimtalkUsecase.name);

    constructor(
        private readonly upsertUserUsecase: UpsertUserUsecase,
        private readonly createEventUsecase: CreateEventUsecase
    ) {}

    /**
     * Main entry point for sending 알림톡
     * 1. Ensures user exists in Channel Talk (upsert)
     * 2. Creates event to trigger Campaign -> 알림톡
     *
     * Error handling: Logs errors but doesn't throw (알림톡 실패가 비즈니스 로직을 중단시키면 안됨)
     */
    async execute(
        userDto: UpsertChannelTalkUserDto,
        eventDto: CreateChannelTalkEventDto
    ): Promise<SendAlimtalkResult | null> {
        try {
            // 1. Ensure user exists in Channel Talk
            const user = await this.upsertUserUsecase.execute(userDto);

            // 2. Create event to trigger Campaign
            const event = await this.createEventUsecase.execute(eventDto);

            // 3. Log success
            this.logger.log(
                `[ChannelTalk] Alimtalk triggered: ${eventDto.eventName} for ${userDto.memberId}`
            );

            return { user, event };
        } catch (error) {
            // 알림톡 실패가 비즈니스 로직을 중단시키면 안됨
            this.logger.error(
                `[ChannelTalk] Failed to send alimtalk: ${eventDto.eventName} for ${userDto.memberId}`,
                error instanceof Error ? error.stack : String(error)
            );
            return null;
        }
    }
}
