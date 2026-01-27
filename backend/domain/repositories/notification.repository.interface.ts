import { NotificationEntity } from "../entities/notification.entity";

export interface INotificationRepository {
    /**
     * Find notification by ID
     */
    findById(id: number): Promise<NotificationEntity | null>;

    /**
     * Find all notifications for a user with pagination
     */
    findByUserId(userId: string, options?: { limit?: number; offset?: number }): Promise<NotificationEntity[]>;

    /**
     * Find unread notifications for a user
     */
    findUnreadByUserId(userId: string): Promise<NotificationEntity[]>;

    /**
     * Count unread notifications for a user
     */
    countUnreadByUserId(userId: string): Promise<number>;

    /**
     * Create a new notification record
     */
    create(notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Update notification (e.g., mark as read)
     */
    update(notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Mark all notifications as read for a user
     */
    markAllAsReadByUserId(userId: string): Promise<void>;

    /**
     * Delete old notifications (cleanup)
     */
    deleteOlderThan(date: Date): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';
