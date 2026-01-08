import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
    SubscribePushUsecase,
    UnsubscribePushUsecase,
    SendNotificationUsecase,
    GetNotificationsUsecase,
    MarkNotificationReadUsecase,
    GetVapidKeyUsecase,
} from "application/usecases/notification";
import { NotificationService } from "application/services/notification.service";
import { NotificationController } from "interface/controllers/notification.controller";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbPushSubscriptionRepository } from "infrastructure/database/repositories/sb.push-subscription.repository";
import { SbNotificationRepository } from "infrastructure/database/repositories/sb.notification.repository";
import { WebPushAdapter } from "infrastructure/api/web-push.adapter";
import { PUSH_SUBSCRIPTION_REPOSITORY } from "domain/repositories/push-subscription.repository.interface";
import { NOTIFICATION_REPOSITORY } from "domain/repositories/notification.repository.interface";
import { WEB_PUSH_PORT } from "domain/ports/web-push.port";

@Module({
    imports: [ConfigModule],
    controllers: [NotificationController],
    providers: [
        // Use Cases
        SubscribePushUsecase,
        UnsubscribePushUsecase,
        SendNotificationUsecase,
        GetNotificationsUsecase,
        MarkNotificationReadUsecase,
        GetVapidKeyUsecase,
        // Service
        NotificationService,
        // Infrastructure
        PrismaService,
        // Repository bindings (Port -> Adapter)
        {
            provide: PUSH_SUBSCRIPTION_REPOSITORY,
            useClass: SbPushSubscriptionRepository,
        },
        {
            provide: NOTIFICATION_REPOSITORY,
            useClass: SbNotificationRepository,
        },
        // External service binding (Port -> Adapter)
        {
            provide: WEB_PUSH_PORT,
            useClass: WebPushAdapter,
        },
    ],
    exports: [NotificationService],
})
export class NotificationModule {}
