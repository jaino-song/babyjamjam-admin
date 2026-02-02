import { Injectable } from "@nestjs/common";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";
import { PrismaService } from "../prisma.service";
import { NotificationMapper } from "../mapper/notification.mapper";

@Injectable()
export class SbNotificationRepository implements INotificationRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(organizationid: string, id: number): Promise<NotificationEntity | null> {
        const row = await this.prismaService.notification.findFirst({
            where: { id, organizationId: organizationid },
        });
        return row ? NotificationMapper.toDomain(row) : null;
    }

    async findByUserId(
        organizationid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: { userId: userId, organizationId: organizationid },
            orderBy: { sentAt: 'desc' },
            take: options?.limit ?? 50,
            skip: options?.offset ?? 0,
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async findUnreadByUserId(organizationid: string, userId: string): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: {
                userId: userId,
                readAt: null,
                organizationId: organizationid,
            },
            orderBy: { sentAt: 'desc' },
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async countUnreadByUserId(organizationid: string, userId: string): Promise<number> {
        return this.prismaService.notification.count({
            where: {
                userId: userId,
                readAt: null,
                organizationId: organizationid,
            },
        });
    }

    async create(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity> {
        const created = await this.prismaService.notification.create({
            data: {
                ...NotificationMapper.toPrismaCreate(notification),
                organizationId: organizationid,
            },
        });
        return NotificationMapper.toDomain(created);
    }

    async update(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity> {
        const updated = await this.prismaService.notification.update({
            where: { id: notification.id, organizationId: organizationid },
            data: NotificationMapper.toPrismaUpdate(notification),
        });
        return NotificationMapper.toDomain(updated);
    }

    async markAllAsReadByUserId(organizationid: string, userId: string): Promise<void> {
        await this.prismaService.notification.updateMany({
            where: {
                userId: userId,
                readAt: null,
                organizationId: organizationid,
            },
            data: {
                readAt: new Date(),
            },
        });
    }

    async deleteOlderThan(organizationid: string, date: Date): Promise<number> {
        const result = await this.prismaService.notification.deleteMany({
            where: {
                sentAt: { lt: date },
                organizationId: organizationid,
            },
        });
        return result.count;
    }
}
