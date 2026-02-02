import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    UseGuards,
    Request,
    ParseIntPipe,
} from "@nestjs/common";
import { NotificationService } from "application/services/notification.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant } from "infrastructure/tenant";
import {
    SubscribePushDto,
    UnsubscribePushDto,
    SendNotificationDto,
    BroadcastNotificationDto,
    GetNotificationsQueryDto,
    VapidKeyResponseDto,
    NotificationResponseDto,
    UnreadCountResponseDto,
    BroadcastResultResponseDto,
} from "../dto/notification.dto";

interface JwtPayload {
    userId: string;
    role: string;
}

@Controller("notifications")
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) {}

    /**
     * Get VAPID public key (needed by frontend to subscribe)
     * Public endpoint - no auth required
     */
    @Get("vapid-key")
    getVapidKey(): VapidKeyResponseDto {
        return {
            publicKey: this.notificationService.getVapidPublicKey(),
        };
    }

    /**
     * Subscribe to push notifications
     */
    @Post("subscribe")
    @UseGuards(JwtGuard)
    async subscribe(
        @Request() req: { user: JwtPayload },
        @Body() dto: SubscribePushDto,
    ): Promise<{ success: boolean }> {
        await this.notificationService.subscribePush(
            req.user.userId,
            dto.endpoint,
            dto.p256dh,
            dto.auth,
            dto.userAgent,
        );
        return { success: true };
    }

    /**
     * Unsubscribe from push notifications
     */
    @Post("unsubscribe")
    @UseGuards(JwtGuard)
    async unsubscribe(@Body() dto: UnsubscribePushDto): Promise<{ success: boolean }> {
        await this.notificationService.unsubscribePush(dto.endpoint);
        return { success: true };
    }

    /**
     * Get user's notifications with pagination
     */
    @Get()
    @UseGuards(JwtGuard)
    async getNotifications(
        @CurrentTenant() tenant: { organizationId?: string },
        @Request() req: { user: JwtPayload },
        @Query() query: GetNotificationsQueryDto,
    ): Promise<NotificationResponseDto[]> {
        if (req.user.userId === 'dev-user') {
            return [];
        }
        const notifications = await this.notificationService.getNotifications(
            tenant.organizationId ?? "",
            req.user.userId,
            { limit: query.limit, offset: query.offset },
        );
        return notifications.map(this.toResponseDto);
    }

    /**
     * Get unread notifications count
     */
    @Get("unread/count")
    @UseGuards(JwtGuard)
    async getUnreadCount(
        @CurrentTenant() tenant: { organizationId?: string },
        @Request() req: { user: JwtPayload }
    ): Promise<UnreadCountResponseDto> {
        if (req.user.userId === 'dev-user') {
            return { count: 0 };
        }
        const count = await this.notificationService.countUnreadNotifications(
            tenant.organizationId ?? "",
            req.user.userId
        );
        return { count };
    }

    /**
     * Mark a notification as read
     */
    @Patch(":id/read")
    @UseGuards(JwtGuard)
    async markAsRead(
        @CurrentTenant() tenant: { organizationId?: string },
        @Request() req: { user: JwtPayload },
        @Param("id", ParseIntPipe) id: number,
    ): Promise<NotificationResponseDto> {
        const notification = await this.notificationService.markAsRead(
            tenant.organizationId ?? "",
            id,
            req.user.userId
        );
        return this.toResponseDto(notification);
    }

    /**
     * Mark all notifications as read
     */
    @Patch("read-all")
    @UseGuards(JwtGuard)
    async markAllAsRead(
        @CurrentTenant() tenant: { organizationId?: string },
        @Request() req: { user: JwtPayload }
    ): Promise<{ success: boolean }> {
        await this.notificationService.markAllAsRead(tenant.organizationId ?? "", req.user.userId);
        return { success: true };
    }

    // ==================== Admin Endpoints ====================

    /**
     * Send notification to a specific user (admin only)
     */
    @Post("send")
    @UseGuards(JwtGuard)
    async sendNotification(
        @CurrentTenant() tenant: { organizationId?: string },
        @Request() req: { user: JwtPayload },
        @Body() dto: SendNotificationDto,
    ): Promise<NotificationResponseDto> {
        // TODO: Add admin role check
        // if (req.user.role !== 'admin') throw new ForbiddenException();
        const notification = await this.notificationService.sendNotification(
            tenant.organizationId ?? "",
            dto.userId,
            dto.title,
            dto.body,
            dto.data,
        );
        return this.toResponseDto(notification);
    }

    /**
     * Broadcast notification to all users (admin only)
     */
    @Post("broadcast")
    @UseGuards(JwtGuard)
    async broadcastNotification(
        @Request() req: { user: JwtPayload },
        @Body() dto: BroadcastNotificationDto,
    ): Promise<BroadcastResultResponseDto> {
        // TODO: Add admin role check
        // if (req.user.role !== 'admin') throw new ForbiddenException();
        return this.notificationService.broadcastNotification(
            dto.title,
            dto.body,
            dto.data,
        );
    }

    /**
     * Test broadcast - development only, no auth required
     * 개발/테스트용 엔드포인트
     */
    @Post("test-broadcast")
    async testBroadcast(): Promise<BroadcastResultResponseDto> {
        return this.notificationService.broadcastNotification(
            "🎉 테스트 알림",
            "PWA 푸시 알림이 정상 작동합니다!",
            { url: "/clients", timestamp: new Date().toISOString() },
        );
    }

    private toResponseDto(notification: import("domain/entities/notification.entity").NotificationEntity): NotificationResponseDto {
        return {
            id: notification.id,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            sentAt: notification.sentAt.toISOString(),
            readAt: notification.readAt?.toISOString() ?? null,
            isRead: notification.isRead(),
        };
    }
}
