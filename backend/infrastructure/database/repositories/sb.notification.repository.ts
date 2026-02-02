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
            where: { id, organization_id: organizationid },
        });
        return row ? NotificationMapper.toDomain(row) : null;
    }

    async findByUserId(
        organizationid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: { user_id: userId, organization_id: organizationid },
            orderBy: { sent_at: 'desc' },
            take: options?.limit ?? 50,
            skip: options?.offset ?? 0,
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async findUnreadByUserId(organizationid: string, userId: string): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: {
                user_id: userId,
                read_at: null,
                organization_id: organizationid,
            },
            orderBy: { sent_at: 'desc' },
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async countUnreadByUserId(organizationid: string, userId: string): Promise<number> {
        return this.prismaService.notification.count({
            where: {
                user_id: userId,
                read_at: null,
                organization_id: organizationid,
            },
        });
    }

    async create(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity> {
        const created = await this.prismaService.notification.create({
            data: {
                ...NotificationMapper.toPrismaCreate(notification),
                organization_id: organizationid,
            },
        });
        return NotificationMapper.toDomain(created);
    }

    async update(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity> {
        const updated = await this.prismaService.notification.update({
            where: { id: notification.id, organization_id: organizationid },
            data: NotificationMapper.toPrismaUpdate(notification),
        });
        return NotificationMapper.toDomain(updated);
    }

    async markAllAsReadByUserId(organizationid: string, userId: string): Promise<void> {
        await this.prismaService.notification.updateMany({
            where: {
                user_id: userId,
                read_at: null,
                organization_id: organizationid,
            },
            data: {
                read_at: new Date(),
            },
        });
    }

    async deleteOlderThan(organizationid: string, date: Date): Promise<number> {
        const result = await this.prismaService.notification.deleteMany({
            where: {
                sent_at: { lt: date },
                organization_id: organizationid,
            },
        });
        return result.count;
    }
}
