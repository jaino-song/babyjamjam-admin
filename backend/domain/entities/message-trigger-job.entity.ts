import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export type MessageTriggerJobStatus = "pending" | "sent" | "failed" | "canceled";

export interface MessageTriggerJobPayload {
    clientId?: number | null;
    clientName?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
    memberId: string;
    recipientName: string;
    recipientPhone: string;
    templateVariables: Record<string, string>;
    buttonUrl?: string | null;
    messageBody?: string | null;
}

export class MessageTriggerJobEntity {
    constructor(
        public readonly id: string,
        public branchId: string | null,
        public ruleId: string,
        public status: MessageTriggerJobStatus,
        public scheduledFor: Date,
        public sentAt: Date | null,
        public canceledAt: Date | null,
        public cancelReason: string | null,
        public clientId: number | null,
        public employeeScheduleId: number | null,
        public recipientType: MessageTriggerRecipientType,
        public recipientPhone: string | null,
        public templateKey: MessageTriggerTemplateKey,
        public dedupeKey: string,
        public payload: MessageTriggerJobPayload,
        public createdAt: Date,
        public updatedAt: Date,
    ) {}

    static create(params: {
        branchId?: string;
        ruleId: string;
        scheduledFor: Date;
        clientId?: number | null;
        employeeScheduleId?: number | null;
        recipientType: MessageTriggerRecipientType;
        recipientPhone?: string | null;
        templateKey: MessageTriggerTemplateKey;
        dedupeKey: string;
        payload: MessageTriggerJobPayload;
    }): MessageTriggerJobEntity {
        const now = new Date();
        return new MessageTriggerJobEntity(
            "",
            params.branchId ?? null,
            params.ruleId,
            "pending",
            params.scheduledFor,
            null,
            null,
            null,
            params.clientId ?? null,
            params.employeeScheduleId ?? null,
            params.recipientType,
            params.recipientPhone ?? null,
            params.templateKey,
            params.dedupeKey,
            params.payload,
            now,
            now,
        );
    }

    static reconstitute(
        id: string,
        branchId: string | null,
        ruleId: string,
        status: MessageTriggerJobStatus,
        scheduledFor: Date,
        sentAt: Date | null,
        canceledAt: Date | null,
        cancelReason: string | null,
        clientId: number | null,
        employeeScheduleId: number | null,
        recipientType: MessageTriggerRecipientType,
        recipientPhone: string | null,
        templateKey: MessageTriggerTemplateKey,
        dedupeKey: string,
        payload: MessageTriggerJobPayload,
        createdAt: Date,
        updatedAt: Date,
    ): MessageTriggerJobEntity {
        return new MessageTriggerJobEntity(
            id,
            branchId,
            ruleId,
            status,
            scheduledFor,
            sentAt,
            canceledAt,
            cancelReason,
            clientId,
            employeeScheduleId,
            recipientType,
            recipientPhone,
            templateKey,
            dedupeKey,
            payload,
            createdAt,
            updatedAt,
        );
    }

    markSent(): void {
        this.status = "sent";
        this.sentAt = new Date();
        this.updatedAt = new Date();
    }

    markFailed(reason?: string): void {
        this.status = "failed";
        this.cancelReason = reason ?? null;
        this.updatedAt = new Date();
    }

    cancel(reason: string): void {
        this.status = "canceled";
        this.cancelReason = reason;
        this.canceledAt = new Date();
        this.updatedAt = new Date();
    }
}
