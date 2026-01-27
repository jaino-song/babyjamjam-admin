/**
 * DTO for upserting a Channel Talk user
 * Used to sync our client data with Channel Talk for 알림톡
 */
export class UpsertChannelTalkUserDto {
    /**
     * Our system's client ID (will be used as memberId in Channel Talk)
     */
    memberId: string;

    /**
     * Client name
     */
    name?: string;

    /**
     * Mobile number in Korean format: 01012345678 (no hyphens)
     */
    mobileNumber?: string;

    /**
     * Email address
     */
    email?: string;

    /**
     * Additional custom profile fields for 개인화 변수
     */
    customFields?: Record<string, unknown>;

    constructor(params: {
        memberId: string;
        name?: string;
        mobileNumber?: string;
        email?: string;
        customFields?: Record<string, unknown>;
    }) {
        this.memberId = params.memberId;
        this.name = params.name;
        this.mobileNumber = params.mobileNumber;
        this.email = params.email;
        this.customFields = params.customFields;
    }
}
