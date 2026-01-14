import { Injectable, Inject, Logger } from "@nestjs/common";
import {
    CHANNELTALK_API_PORT,
    IChannelTalkApiPort,
    ChannelTalkEvent,
} from "domain/ports/channeltalk-api.port";
import { CreateChannelTalkEventDto } from "application/dto/channeltalk";

@Injectable()
export class CreateEventUsecase {
    private readonly logger = new Logger(CreateEventUsecase.name);

    constructor(
        @Inject(CHANNELTALK_API_PORT)
        private readonly channelTalkApi: IChannelTalkApiPort
    ) {}

    async execute(dto: CreateChannelTalkEventDto): Promise<ChannelTalkEvent> {
        // 1. Get user by memberId to obtain Channel Talk's internal userId
        const user = await this.channelTalkApi.getUserByMemberId(dto.memberId);

        // 2. If user is null, throw Error
        if (!user) {
            throw new Error(`User not found in Channel Talk: ${dto.memberId}`);
        }

        // 3. Create event with userId (NOT memberId)
        const event = await this.channelTalkApi.createEvent({
            userId: user.id, // Channel Talk's internal ID
            name: dto.eventName,
            property: dto.properties,
        });

        // 4. Log success
        this.logger.log(`[ChannelTalk] Event created: ${dto.eventName} for user ${user.id}`);

        return event;
    }
}
