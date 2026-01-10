import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject, Min } from "class-validator";
import { Type } from "class-transformer";

/**
 * Push subscription from browser - keys from PushSubscription.getKey()
 */
export class SubscribePushDto {
    @IsString()
    @IsNotEmpty()
    endpoint!: string;

    @IsString()
    @IsNotEmpty()
    p256dh!: string; // Base64 encoded

    @IsString()
    @IsNotEmpty()
    auth!: string; // Base64 encoded

    @IsString()
    @IsOptional()
    userAgent?: string;
}

export class UnsubscribePushDto {
    @IsString()
    @IsNotEmpty()
    endpoint!: string;
}

export class SendNotificationDto {
    @IsString()
    @IsNotEmpty()
    userId!: string;

    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsString()
    @IsNotEmpty()
    body!: string;

    @IsObject()
    @IsOptional()
    data?: Record<string, unknown>;
}

export class BroadcastNotificationDto {
    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsString()
    @IsNotEmpty()
    body!: string;

    @IsObject()
    @IsOptional()
    data?: Record<string, unknown>;
}

export class GetNotificationsQueryDto {
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @IsOptional()
    limit?: number;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @IsOptional()
    offset?: number;
}

// Response DTOs
export class VapidKeyResponseDto {
    publicKey!: string;
}

export class NotificationResponseDto {
    id!: number;
    title!: string;
    body!: string;
    data!: Record<string, unknown> | null;
    sentAt!: string;
    readAt!: string | null;
    isRead!: boolean;
}

export class UnreadCountResponseDto {
    count!: number;
}

export class BroadcastResultResponseDto {
    sent!: number;
    failed!: number;
}
