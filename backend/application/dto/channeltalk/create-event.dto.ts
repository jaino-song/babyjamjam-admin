/**
 * Event name constants for Channel Talk Campaigns
 * These event names should match the Campaign triggers in Channel Talk dashboard
 */
export const CHANNELTALK_EVENTS = {
    CLIENT_CREATED: "client_created",
    SERVICE_START_REMINDER: "service_start_reminder",
    SERVICE_INFO: "service_info",
    SERVICE_END_REMINDER: "service_end_reminder",
    EMPLOYEE_ASSIGNED: "employee_assigned",
    CONTRACT_SIGNED: "contract_signed",
} as const;

export type ChannelTalkEventName = (typeof CHANNELTALK_EVENTS)[keyof typeof CHANNELTALK_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Type-safe property interfaces for each event type
// All extend Record<string, unknown> for compatibility with CreateChannelTalkEventDto
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientCreatedProperties extends Record<string, unknown> {
    clientName: string;
    registrationDate: string; // YYYY-MM-DD
    serviceType: string;
}

export interface ContractSignedProperties extends Record<string, unknown> {
    clientName: string;
    contractType: string;
    signedDate: string; // YYYY-MM-DD
    serviceStartDate: string; // YYYY-MM-DD
    employeeName: string;
}

/**
 * DTO for creating a Channel Talk event
 * Events trigger Campaigns configured in Channel Talk dashboard
 */
export class CreateChannelTalkEventDto {
    /**
     * Our system's client ID (used to look up Channel Talk's internal userId)
     */
    memberId: string;

    /**
     * Event name - should be one of CHANNELTALK_EVENTS values
     */
    eventName: string;

    /**
     * Event properties for 알림톡 template variables
     */
    properties?: Record<string, unknown>;

    constructor(params: {
        memberId: string;
        eventName: string;
        properties?: Record<string, unknown>;
    }) {
        this.memberId = params.memberId;
        this.eventName = params.eventName;
        this.properties = params.properties;
    }
}
