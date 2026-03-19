import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    IChannelTalkApiPort,
    ChannelTalkUser,
    ChannelTalkEvent,
    UpsertUserParams,
    CreateEventParams,
} from "domain/ports/channeltalk-api.port";

interface ChannelTalkApiResponse<T> {
    user?: T;
    event?: T;
    error?: {
        message: string;
        code: string;
    };
}

@Injectable()
export class ChannelTalkApiClient implements IChannelTalkApiPort {
    private readonly logger = new Logger(ChannelTalkApiClient.name);
    private readonly CHANNELTALK_API_URL: string;
    private readonly CHANNELTALK_ACCESS_KEY: string;
    private readonly CHANNELTALK_ACCESS_SECRET: string;
    private readonly isConfigured: boolean;

    constructor(private readonly configService: ConfigService) {
        this.CHANNELTALK_API_URL = configService.get("CHANNELTALK_API_URL") || "";
        this.CHANNELTALK_ACCESS_KEY = configService.get("CHANNELTALK_ACCESS_KEY") || "";
        this.CHANNELTALK_ACCESS_SECRET = configService.get("CHANNELTALK_ACCESS_SECRET") || "";
        this.isConfigured = Boolean(
            this.CHANNELTALK_API_URL &&
            this.CHANNELTALK_ACCESS_KEY &&
            this.CHANNELTALK_ACCESS_SECRET,
        );

        if (!this.isConfigured) {
            this.logger.warn("CHANNELTALK_API_URL, CHANNELTALK_ACCESS_KEY, and CHANNELTALK_ACCESS_SECRET not configured. ChannelTalk integration will be disabled.");
        }
    }

    private getHeaders(): HeadersInit {
        return {
            "x-access-key": this.CHANNELTALK_ACCESS_KEY,
            "x-access-secret": this.CHANNELTALK_ACCESS_SECRET,
            "Content-Type": "application/json",
        };
    }

    private async handleResponse<T>(response: Response, context: string): Promise<T> {
        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[ChannelTalk] ${context} failed: ${response.status} - ${errorText}`);
            throw new Error(`Channel Talk API error (${response.status}): ${errorText}`);
        }
        return response.json() as Promise<T>;
    }

    async upsertUserByMemberId(params: UpsertUserParams): Promise<ChannelTalkUser> {
        this.assertConfigured();
        // Note: @ prefix is REQUIRED for memberId lookup
        const url = `${this.CHANNELTALK_API_URL}/open/v5/users/@${params.memberId}`;

        const body = {
            profile: params.profile,
            profileOnce: params.profileOnce,
        };

        this.logger.debug(`[ChannelTalk] Upserting user: ${params.memberId}`);

        const response = await fetch(url, {
            method: "PUT",
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        const data = await this.handleResponse<ChannelTalkApiResponse<ChannelTalkUser>>(
            response,
            `upsertUser(${params.memberId})`
        );

        if (!data.user) {
            throw new Error(`Channel Talk API returned no user for memberId: ${params.memberId}`);
        }

        this.logger.log(`[ChannelTalk] User upserted: ${data.user.id} (memberId: ${params.memberId})`);
        return data.user;
    }

    async getUserByMemberId(memberId: string): Promise<ChannelTalkUser | null> {
        this.assertConfigured();
        // Note: @ prefix is REQUIRED for memberId lookup
        const url = `${this.CHANNELTALK_API_URL}/open/v5/users/@${memberId}`;

        this.logger.debug(`[ChannelTalk] Getting user: ${memberId}`);

        const response = await fetch(url, {
            method: "GET",
            headers: this.getHeaders(),
        });

        // Handle 404 - user not found
        if (response.status === 404) {
            this.logger.debug(`[ChannelTalk] User not found: ${memberId}`);
            return null;
        }

        const data = await this.handleResponse<ChannelTalkApiResponse<ChannelTalkUser>>(
            response,
            `getUser(${memberId})`
        );

        return data.user ?? null;
    }

    async createEvent(params: CreateEventParams): Promise<ChannelTalkEvent> {
        this.assertConfigured();
        // IMPORTANT: userId is Channel Talk's internal ID, NOT memberId
        const url = `${this.CHANNELTALK_API_URL}/open/v5/users/${params.userId}/events`;

        const body = {
            name: params.name,
            property: params.property,
        };

        this.logger.debug(`[ChannelTalk] Creating event: ${params.name} for user ${params.userId}`);

        const response = await fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        const data = await this.handleResponse<ChannelTalkApiResponse<ChannelTalkEvent>>(
            response,
            `createEvent(${params.name})`
        );

        if (!data.event) {
            throw new Error(`Channel Talk API returned no event for: ${params.name}`);
        }

        this.logger.log(`[ChannelTalk] Event created: ${params.name} for user ${params.userId}`);
        return data.event;
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("ChannelTalk integration is not configured.");
        }
    }
}
