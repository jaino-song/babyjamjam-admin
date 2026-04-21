import { Controller, Get } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { RibbonConfigResponseDto } from "interface/dto/system-setting.dto";

@Controller("settings")
export class PublicSettingsController {
    constructor(private readonly systemSettingService: SystemSettingService) {}

    @Get("ribbon-config")
    async getRibbonConfig(): Promise<RibbonConfigResponseDto> {
        const config = await this.systemSettingService.getRibbonConfig();
        return RibbonConfigResponseDto.from(config);
    }
}
