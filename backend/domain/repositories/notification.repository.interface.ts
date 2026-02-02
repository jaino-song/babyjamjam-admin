import { NotificationEntity } from "../entities/notification.entity";

export interface INotificationRepository {
    /**
     * Find notification by ID
     */
    findById(organizationid: string, id: number): Promise<NotificationEntity | null>;

    /**
     * Find all notifications for a user with pagination
     */
    findByUserId(
        organizationid: string,
        userId: string,
        options?: { limit?: number; offset?: number }
    ): Promise<NotificationEntity[]>;

    /**
     * Find unread notifications for a user
     */
    findUnreadByUserId(organizationid: string, userId: string): Promise<NotificationEntity[]>;

    /**
     * Count unread notifications for a user
     */
    countUnreadByUserId(organizationid: string, userId: string): Promise<number>;

    /**
     * Create a new notification record
     */
    create(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Update notification (e.g., mark as read)
     */
    update(organizationid: string, notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Mark all notifications as read for a user
     */
    markAllAsReadByUserId(organizationid: string, userId: string): Promise<void>;

    /**
     * Delete old notifications (cleanup)
     */
    deleteOlderThan(organizationid: string, date: Date): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';
