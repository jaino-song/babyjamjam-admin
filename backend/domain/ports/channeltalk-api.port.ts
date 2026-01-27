/**
 * Channel Talk API Port
 *
 * Port (인터페이스) for Channel Talk Open API integration.
 * 실제 구현체는 infrastructure 레이어의 channeltalk-api.client.ts에서 제공.
 *
 * @see https://developers.channel.io/en/categories/Open-API-060776bd
 * @see https://developers.channel.io/en/articles/Authentication-20516f31
 *
 * Authentication:
 *   Headers: x-access-key, x-access-secret
 *   Get credentials: Channel Desk → Settings → API Key Management
 */

/**
 * Channel Talk user object returned from API
 */
export interface ChannelTalkUser {
    id: string; // Channel Talk internal user ID
    channelId: string;
    memberId: string; // our system's client ID
    name?: string;
    mobileNumber?: string;
    email?: string;
    profile?: Record<string, unknown>;
    createdAt?: number;
}

/**
 * Channel Talk event object returned from API
 */
export interface ChannelTalkEvent {
    id: string;
    name: string; // event name like 'client_created'
    property?: Record<string, unknown>; // event properties for 알림톡 template
    createdAt: number;
}

/**
 * Parameters for upserting a user in Channel Talk
 * @see https://developers.channel.io/en/reference/Open-API-Users-2-Upsert-4b31f3e3
 */
export interface UpsertUserParams {
    memberId: string; // required - our client ID, used with @ prefix in API
    profile?: {
        name?: string;
        mobileNumber?: string; // format: 01012345678
        email?: string;
        [key: string]: unknown; // custom profile fields for 개인화 변수
    };
    profileOnce?: Record<string, unknown>; // set only if not already set
}

/**
 * Parameters for creating an event in Channel Talk
 * Note: userId is Channel Talk's internal ID, NOT memberId
 * @see https://developers.channel.io/en/reference/Open-API-Users-Events-Create-15f7e96d
 */
export interface CreateEventParams {
    userId: string; // Channel Talk's internal user ID, NOT memberId
    name: string; // event name - triggers Campaign in Channel Talk
    property?: Record<string, unknown>; // event properties for 알림톡 template variables
}

/**
 * Port interface for Channel Talk API operations
 * Implementations should handle authentication and HTTP communication
 */
export interface IChannelTalkApiPort {
    /**
     * Create or update a user by memberId
     * PUT /open/v5/users/@{memberId}
     */
    upsertUserByMemberId(params: UpsertUserParams): Promise<ChannelTalkUser>;

    /**
     * Get user by memberId
     * GET /open/v5/users/@{memberId}
     * @returns null if user not found (404)
     */
    getUserByMemberId(memberId: string): Promise<ChannelTalkUser | null>;

    /**
     * Create an event to trigger Campaigns (알림톡)
     * POST /open/v5/users/{userId}/events
     * IMPORTANT: userId is Channel Talk's ID, not memberId!
     */
    createEvent(params: CreateEventParams): Promise<ChannelTalkEvent>;
}

export const CHANNELTALK_API_PORT = Symbol("CHANNELTALK_API_PORT");
