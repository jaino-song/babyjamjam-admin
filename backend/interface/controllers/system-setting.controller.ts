import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    UpdateAlimtalkProviderDto,
    AlimtalkProviderResponseDto,
    UpdateNotificationPreferencesDto,
    NotificationPreferencesResponseDto,
    UpdateRibbonConfigDto,
    RibbonConfigResponseDto,
} from "interface/dto/system-setting.dto";
import {
    MessageSenderApprovalResponseDto,
} from "interface/dto/message-sender-approval.dto";
import { TenantGuard, CurrentTenant } from "infrastructure/tenant";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";

@Controller("settings")
@UseGuards(JwtGuard)
export class SystemSettingController {
    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
    ) {}

    @Get("alimtalk-provider")
    async getAlimtalkProvider(): Promise<AlimtalkProviderResponseDto> {
        const setting = await this.systemSettingService.getAlimtalkProviderSetting();
        const provider = setting?.getAlimtalkProvider()
            ?? await this.systemSettingService.getAlimtalkProvider();
        const enabled = provider !== "none";
        return AlimtalkProviderResponseDto.from(provider, enabled, setting?.updatedAt);
    }

    @Put("alimtalk-provider")
    @UseGuards(OwnerOrAdminGuard)
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

    @Get("notification-preferences")
    async getNotificationPreferences(
        @Request() request: { user: { userId: string } },
    ): Promise<NotificationPreferencesResponseDto> {
        const emailNotificationsEnabled =
            await this.systemSettingService.getUserEmailNotificationsEnabled(request.user.userId);

        return NotificationPreferencesResponseDto.from(emailNotificationsEnabled);
    }

    @Put("notification-preferences")
    async updateNotificationPreferences(
        @Request() request: { user: { userId: string } },
        @Body() dto: UpdateNotificationPreferencesDto,
    ): Promise<NotificationPreferencesResponseDto> {
        const entity = await this.systemSettingService.setUserEmailNotificationsEnabled(
            request.user.userId,
            dto.emailNotificationsEnabled,
        );

        return NotificationPreferencesResponseDto.from(
            entity.value === "true",
            entity.updatedAt,
        );
    }

    @Get("message-sender-approval")
    @UseGuards(TenantGuard)
    async getMessageSenderApproval(
        @CurrentTenant() tenant: { branchId?: string; branchRole?: string },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await this.messageSenderApprovalService.getState(
            tenant.branchId ?? "",
        );
        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: this.messageSenderApprovalService.canRequest(tenant.branchRole),
        });
    }

    @Put("ribbon-config")
    @UseGuards(OwnerGuard)
    async updateRibbonConfig(
        @Body() dto: UpdateRibbonConfigDto
    ): Promise<RibbonConfigResponseDto> {
        const entity = await this.systemSettingService.setRibbonConfig({
            enabled: dto.enabled,
            message: dto.message,
            backgroundColor: dto.backgroundColor,
            textColor: dto.textColor,
            linkText: dto.linkText ?? "",
            linkHref: dto.linkHref ?? "",
            linkColor: dto.linkColor,
        });
        const config = JSON.parse(entity.value);
        return RibbonConfigResponseDto.from(config, entity.updatedAt);
    }

    @Post("message-sender-approval/request")
    @UseGuards(TenantGuard)
    async requestMessageSenderApproval(
        @CurrentTenant() tenant: { branchId?: string; branchRole?: string },
        @Request() request: { user: { userId: string } },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await this.messageSenderApprovalService.requestApproval({
            branchId: tenant.branchId ?? "",
            branchRole: tenant.branchRole,
            userId: request.user.userId,
        });

        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: this.messageSenderApprovalService.canRequest(tenant.branchRole),
        });
    }

    @Post("message-sender-approval/:branchId/approve")
    @UseGuards(OwnerGuard)
    async approveMessageSenderApproval(
        @Param("branchId") branchId: string,
        @Request() request: { user: { userId: string } },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await this.messageSenderApprovalService.approvePendingRequest({
            branchId,
            userId: request.user.userId,
        });

        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: false,
        });
    }
}
