import { Controller, Get, Put, Body, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    UpdateAlimtalkProviderDto,
    AlimtalkProviderResponseDto,
} from "interface/dto/system-setting.dto";

@Controller("settings")
@UseGuards(JwtGuard)
export class SystemSettingController {
    constructor(private readonly systemSettingService: SystemSettingService) {}

    @Get("alimtalk-provider")
    async getAlimtalkProvider(): Promise<AlimtalkProviderResponseDto> {
        const provider = await this.systemSettingService.getAlimtalkProvider();
        const enabled = await this.systemSettingService.isAlimtalkEnabled();
        return AlimtalkProviderResponseDto.from(provider, enabled);
    }

    @Put("alimtalk-provider")
    async updateAlimtalkProvider(
        @Body() dto: UpdateAlimtalkProviderDto
    ): Promise<AlimtalkProviderResponseDto> {
        const entity = await this.systemSettingService.setAlimtalkProvider(dto.provider);
        const enabled = entity.value !== "none";
        return AlimtalkProviderResponseDto.from(
            entity.getAlimtalkProvider(),
            enabled,
            entity.updatedAt
        );
    }
}
