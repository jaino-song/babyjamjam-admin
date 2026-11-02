import {
    AGENT_SMS_RULE_ID_PREFIX,
    DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTargetClientStatus,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export class MessageTriggerRuleEntity {
    /** Upserted carrier rows must survive user-facing rule deletion. */
    static isReservedId(id: string): boolean {
        return id.startsWith(AGENT_SMS_RULE_ID_PREFIX) || id.startsWith("system:");
    }

    constructor(
        public readonly id: string,
        public branchId: string | null,
        public name: string,
        public isActive: boolean,
        public eventType: MessageTriggerEventType,
        public offsetType: MessageTriggerOffsetType,
        public offsetDays: number,
        public recipientType: MessageTriggerRecipientType,
        public templateKey: MessageTriggerTemplateKey,
        public createdAt: Date,
        public updatedAt: Date,
        public isDefault = false,
        public jobsStale = false,
        public isLockedByGlobal = false,
        public sendTime = "09:00",
        public targetClientStatus: MessageTriggerTargetClientStatus = DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
        public retryOnFailure = DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    ) {}

    static create(params: {
        branchId?: string;
        name: string;
        isActive?: boolean;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays?: number;
        sendTime?: string;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        isDefault?: boolean;
        jobsStale?: boolean;
        targetClientStatus?: MessageTriggerTargetClientStatus;
        retryOnFailure?: boolean;
    }): MessageTriggerRuleEntity {
        const now = new Date();
        return new MessageTriggerRuleEntity(
            "",
            params.branchId ?? null,
            params.name,
            params.isActive ?? true,
            params.eventType,
            params.offsetType,
            params.offsetDays ?? 0,
            params.recipientType,
            params.templateKey,
            now,
            now,
            params.isDefault ?? false,
            params.jobsStale ?? false,
            false,
            params.sendTime ?? "09:00",
            params.targetClientStatus ?? DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
            params.retryOnFailure ?? DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
        );
    }

    static reconstitute(
        id: string,
        branchId: string | null,
        name: string,
        isActive: boolean,
        eventType: MessageTriggerEventType,
        offsetType: MessageTriggerOffsetType,
        offsetDays: number,
        recipientType: MessageTriggerRecipientType,
        templateKey: MessageTriggerTemplateKey,
        createdAt: Date,
        updatedAt: Date,
        isDefault = false,
        jobsStale = false,
        sendTime = "09:00",
        targetClientStatus: MessageTriggerTargetClientStatus = DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
        retryOnFailure = DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    ): MessageTriggerRuleEntity {
        return new MessageTriggerRuleEntity(
            id,
            branchId,
            name,
            isActive,
            eventType,
            offsetType,
            offsetDays,
            recipientType,
            templateKey,
            createdAt,
            updatedAt,
            isDefault,
            jobsStale,
            false,
            sendTime,
            targetClientStatus,
            retryOnFailure,
        );
    }

    update(params: {
        name?: string;
        isActive?: boolean;
        eventType?: MessageTriggerEventType;
        offsetType?: MessageTriggerOffsetType;
        offsetDays?: number;
        sendTime?: string;
        recipientType?: MessageTriggerRecipientType;
        templateKey?: MessageTriggerTemplateKey;
        targetClientStatus?: MessageTriggerTargetClientStatus;
        retryOnFailure?: boolean;
    }): void {
        this.name = params.name ?? this.name;
        this.isActive = params.isActive ?? this.isActive;
        this.eventType = params.eventType ?? this.eventType;
        this.offsetType = params.offsetType ?? this.offsetType;
        this.offsetDays = params.offsetDays ?? this.offsetDays;
        this.sendTime = params.sendTime ?? this.sendTime;
        this.recipientType = params.recipientType ?? this.recipientType;
        this.templateKey = params.templateKey ?? this.templateKey;
        this.targetClientStatus = params.targetClientStatus ?? this.targetClientStatus;
        this.retryOnFailure = params.retryOnFailure ?? this.retryOnFailure;
        this.updatedAt = new Date();
    }
}
