export const SMS_DELIVERY_MAX_ATTEMPTS = 3;
export const SMS_DELIVERY_RETRY_DELAY_MS = 5 * 60 * 1000;
export const ALIMTALK_DELIVERY_MAX_ATTEMPTS = 3;
export const ALIMTALK_DELIVERY_RETRY_DELAY_MS = 5 * 60 * 1000;

export interface MessageDeliveryRetryPolicy {
    maxAttempts: number;
    retryDelayMs: number;
}

export function getMessageDeliveryRetryPolicy(provider: string): MessageDeliveryRetryPolicy {
    if (provider === "aligo_sms") {
        return {
            maxAttempts: SMS_DELIVERY_MAX_ATTEMPTS,
            retryDelayMs: SMS_DELIVERY_RETRY_DELAY_MS,
        };
    }

    if (provider === "aligo_alimtalk") {
        return {
            maxAttempts: ALIMTALK_DELIVERY_MAX_ATTEMPTS,
            retryDelayMs: ALIMTALK_DELIVERY_RETRY_DELAY_MS,
        };
    }

    return {
        maxAttempts: ALIMTALK_DELIVERY_MAX_ATTEMPTS,
        retryDelayMs: ALIMTALK_DELIVERY_RETRY_DELAY_MS,
    };
}

export type MessageLogStatus = "pending" | "sent" | "failed";

export class MessageLogEntity {
    constructor(
        public readonly id: number,
        public branchId: string | null,
        public provider: string,
        public templateKey: string,
        public triggerJobId: string | null,
        public receiver: string,
        public clientId: number | null,
        public messageBody: string,
        public variables: Record<string, string>,
        public status: MessageLogStatus,
        public aligoMid: string | null,
        public errorMessage: string | null,
        public attempts: number,
        public lastAttemptAt: Date | null,
        public nextRetryAt: Date | null,
        public createdAt: Date,
        public updatedAt: Date,
    ) {}

    markSent(aligoMid?: string): void {
        this.status = "sent";
        this.aligoMid = aligoMid ?? null;
        this.lastAttemptAt = new Date();
        this.nextRetryAt = null;
        this.attempts += 1;
    }

    markFailed(errorMessage: string): void {
        this.attempts += 1;
        this.lastAttemptAt = new Date();
        this.errorMessage = errorMessage;

        if (this.canRetry()) {
            this.scheduleRetry();
        } else {
            this.status = "failed";
            this.nextRetryAt = null;
        }
    }

    canRetry(): boolean {
        return this.attempts < getMessageDeliveryRetryPolicy(this.provider).maxAttempts;
    }

    markRetrySuperseded(reason: string): void {
        this.status = "failed";
        this.errorMessage = reason;
        this.nextRetryAt = null;
        this.updatedAt = new Date();
    }

    private scheduleRetry(): void {
        this.nextRetryAt = new Date(Date.now() + getMessageDeliveryRetryPolicy(this.provider).retryDelayMs);
    }

    static create(params: {
        branchId?: string;
        provider: string;
        templateKey: string;
        triggerJobId?: string;
        receiver: string;
        clientId?: number;
        messageBody: string;
        variables: Record<string, string>;
    }): MessageLogEntity {
        const now = new Date();
        return new MessageLogEntity(
            0,
            params.branchId ?? null,
            params.provider,
            params.templateKey,
            params.triggerJobId ?? null,
            params.receiver,
            params.clientId ?? null,
            params.messageBody,
            params.variables,
            "pending",
            null,
            null,
            0,
            null,
            null,
            now,
            now,
        );
    }

    static reconstitute(
        id: number,
        branchId: string | null,
        provider: string,
        templateKey: string,
        triggerJobId: string | null,
        receiver: string,
        clientId: number | null,
        messageBody: string,
        variables: Record<string, string>,
        status: MessageLogStatus,
        aligoMid: string | null,
        errorMessage: string | null,
        attempts: number,
        lastAttemptAt: Date | null,
        nextRetryAt: Date | null,
        createdAt: Date,
        updatedAt: Date = createdAt,
    ): MessageLogEntity {
        return new MessageLogEntity(
            id, branchId, provider, templateKey, triggerJobId, receiver, clientId,
            messageBody, variables, status, aligoMid, errorMessage, attempts,
            lastAttemptAt, nextRetryAt, createdAt, updatedAt,
        );
    }
}
