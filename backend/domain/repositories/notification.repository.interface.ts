import { NotificationEntity } from "../entities/notification.entity";

export interface INotificationRepository {
    /**
     * Find notification by ID
     */
    findById(branchid: string, id: number): Promise<NotificationEntity | null>;

    /**
     * Find all notifications for a user with pagination
     */
    findByUserId(
        branchid: string,
        userId: string,
        options?: { limit?: number; offset?: number }
    ): Promise<NotificationEntity[]>;

    /**
     * Find unread notifications for a user
     */
    findUnreadByUserId(branchid: string, userId: string): Promise<NotificationEntity[]>;

    /**
     * Count unread notifications for a user
     */
    countUnreadByUserId(branchid: string, userId: string): Promise<number>;

    /**
     * Create a new notification record
     */
    create(branchid: string, notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Update notification (e.g., mark as read)
     */
    update(branchid: string, notification: NotificationEntity): Promise<NotificationEntity>;

    /**
     * Mark all notifications as read for a user
     */
    markAllAsReadByUserId(branchid: string, userId: string): Promise<void>;

    /**
     * Delete old notifications (cleanup)
     */
    deleteOlderThan(branchid: string, date: Date): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';
