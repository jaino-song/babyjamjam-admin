import { Injectable, Inject, Logger } from "@nestjs/common";
import {
    CHANNELTALK_API_PORT,
    IChannelTalkApiPort,
    ChannelTalkUser,
} from "domain/ports/channeltalk-api.port";
import { UpsertChannelTalkUserDto } from "application/dto/channeltalk";

@Injectable()
export class UpsertUserUsecase {
    private readonly logger = new Logger(UpsertUserUsecase.name);

    constructor(
        @Inject(CHANNELTALK_API_PORT)
        private readonly channelTalkApi: IChannelTalkApiPort
    ) {}

    async execute(dto: UpsertChannelTalkUserDto): Promise<ChannelTalkUser> {
        // Map DTO to UpsertUserParams
        const params = {
            memberId: dto.memberId,
            profile: {
                name: dto.name,
                mobileNumber: dto.mobileNumber,
                email: dto.email,
                ...dto.customFields,
            },
        };

        const user = await this.channelTalkApi.upsertUserByMemberId(params);

        this.logger.log(`[ChannelTalk] User upserted: ${user.id} (memberId: ${dto.memberId})`);

        return user;
    }
}
