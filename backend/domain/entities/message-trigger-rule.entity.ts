import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export class MessageTriggerRuleEntity {
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
    ) {}

    static create(params: {
        branchId?: string;
        name: string;
        isActive?: boolean;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays?: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        isDefault?: boolean;
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
        );
    }

    update(params: {
        name?: string;
        isActive?: boolean;
        eventType?: MessageTriggerEventType;
        offsetType?: MessageTriggerOffsetType;
        offsetDays?: number;
        recipientType?: MessageTriggerRecipientType;
        templateKey?: MessageTriggerTemplateKey;
    }): void {
        this.name = params.name ?? this.name;
        this.isActive = params.isActive ?? this.isActive;
        this.eventType = params.eventType ?? this.eventType;
        this.offsetType = params.offsetType ?? this.offsetType;
        this.offsetDays = params.offsetDays ?? this.offsetDays;
        this.recipientType = params.recipientType ?? this.recipientType;
        this.templateKey = params.templateKey ?? this.templateKey;
        this.updatedAt = new Date();
    }
}
