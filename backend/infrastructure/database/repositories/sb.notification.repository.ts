import { Injectable } from "@nestjs/common";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";
import { PrismaService } from "../prisma.service";
import { NotificationMapper } from "../mapper/notification.mapper";

@Injectable()
export class SbNotificationRepository implements INotificationRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: number): Promise<NotificationEntity | null> {
        const row = await this.prismaService.notification.findUnique({
            where: { id },
        });
        return row ? NotificationMapper.toDomain(row) : null;
    }

    async findByUserId(
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: { user_id: userId },
            orderBy: { sent_at: 'desc' },
            take: options?.limit ?? 50,
            skip: options?.offset ?? 0,
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async findUnreadByUserId(userId: string): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: {
                user_id: userId,
                read_at: null,
            },
            orderBy: { sent_at: 'desc' },
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async countUnreadByUserId(userId: string): Promise<number> {
        return this.prismaService.notification.count({
            where: {
                user_id: userId,
                read_at: null,
            },
        });
    }

    async create(notification: NotificationEntity): Promise<NotificationEntity> {
        const created = await this.prismaService.notification.create({
            data: NotificationMapper.toPrismaCreate(notification),
        });
        return NotificationMapper.toDomain(created);
    }

    async update(notification: NotificationEntity): Promise<NotificationEntity> {
        const updated = await this.prismaService.notification.update({
            where: { id: notification.id },
            data: NotificationMapper.toPrismaUpdate(notification),
        });
        return NotificationMapper.toDomain(updated);
    }

    async markAllAsReadByUserId(userId: string): Promise<void> {
        await this.prismaService.notification.updateMany({
            where: {
                user_id: userId,
                read_at: null,
            },
            data: {
                read_at: new Date(),
            },
        });
    }

    async deleteOlderThan(date: Date): Promise<number> {
        const result = await this.prismaService.notification.deleteMany({
            where: {
                sent_at: { lt: date },
            },
        });
        return result.count;
    }
}
