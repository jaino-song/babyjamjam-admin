import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";

export class AlimtalkTriggerRuleEntity {
    constructor(
        public readonly id: string,
        public organizationId: string | null,
        public name: string,
        public isActive: boolean,
        public eventType: AlimtalkTriggerEventType,
        public offsetType: AlimtalkTriggerOffsetType,
        public offsetDays: number,
        public recipientType: AlimtalkTriggerRecipientType,
        public templateKey: AlimtalkTriggerTemplateKey,
        public createdAt: Date,
        public updatedAt: Date,
    ) {}

    static create(params: {
        organizationId?: string;
        name: string;
        isActive?: boolean;
        eventType: AlimtalkTriggerEventType;
        offsetType: AlimtalkTriggerOffsetType;
        offsetDays?: number;
        recipientType: AlimtalkTriggerRecipientType;
        templateKey: AlimtalkTriggerTemplateKey;
    }): AlimtalkTriggerRuleEntity {
        const now = new Date();
        return new AlimtalkTriggerRuleEntity(
            "",
            params.organizationId ?? null,
            params.name,
            params.isActive ?? true,
            params.eventType,
            params.offsetType,
            params.offsetDays ?? 0,
            params.recipientType,
            params.templateKey,
            now,
            now,
        );
    }

    static reconstitute(
        id: string,
        organizationId: string | null,
        name: string,
        isActive: boolean,
        eventType: AlimtalkTriggerEventType,
        offsetType: AlimtalkTriggerOffsetType,
        offsetDays: number,
        recipientType: AlimtalkTriggerRecipientType,
        templateKey: AlimtalkTriggerTemplateKey,
        createdAt: Date,
        updatedAt: Date,
    ): AlimtalkTriggerRuleEntity {
        return new AlimtalkTriggerRuleEntity(
            id,
            organizationId,
            name,
            isActive,
            eventType,
            offsetType,
            offsetDays,
            recipientType,
            templateKey,
            createdAt,
            updatedAt,
        );
    }

    update(params: {
        name?: string;
        isActive?: boolean;
        eventType?: AlimtalkTriggerEventType;
        offsetType?: AlimtalkTriggerOffsetType;
        offsetDays?: number;
        recipientType?: AlimtalkTriggerRecipientType;
        templateKey?: AlimtalkTriggerTemplateKey;
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
