/**
 * Event name constants for Channel Talk Campaigns
 * These event names should match the Campaign triggers in Channel Talk dashboard
 */
export const CHANNELTALK_EVENTS = {
    CLIENT_CREATED: "client_created",
    SERVICE_START_REMINDER: "service_start_reminder",
    SERVICE_END_REMINDER: "service_end_reminder",
    EMPLOYEE_ASSIGNED: "employee_assigned",
    CONTRACT_SIGNED: "contract_signed",
    CONTRACT_REMINDER_3DAYS: "contract_reminder_3days",
    CONTRACT_REMINDER_1DAY: "contract_reminder_1day",
    PAYMENT_CONFIRMED: "payment_confirmed",
    SURVEY_REQUEST: "survey_request",
    PAYMENT_REMINDER: "payment_reminder",
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

export interface ContractReminderProperties extends Record<string, unknown> {
    clientName: string;
    serviceStartDate: string; // YYYY-MM-DD
    daysUntilStart: number;
    contractLink?: string;
}

export interface PaymentConfirmedProperties extends Record<string, unknown> {
    clientName: string;
    paymentAmount: string; // formatted: "150,000원"
    paymentDate: string; // YYYY-MM-DD
    paymentMethod: string;
    serviceMonth: string; // e.g., "2024년 1월"
}

export interface SurveyRequestProperties extends Record<string, unknown> {
    clientName: string;
    serviceEndDate: string; // YYYY-MM-DD
    surveyLink: string;
    employeeName: string;
}

export interface PaymentReminderProperties extends Record<string, unknown> {
    clientName: string;
    registrationDate: string; // YYYY-MM-DD
    daysSinceRegistration: number;
    expectedAmount?: string;
    paymentDeadline?: string;
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
