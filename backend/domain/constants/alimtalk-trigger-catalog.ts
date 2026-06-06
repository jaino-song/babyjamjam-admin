export enum AlimtalkTriggerEventType {
    CLIENT_CREATED = "CLIENT_CREATED",
    SERVICE_START = "SERVICE_START",
    SERVICE_END = "SERVICE_END",
    EMPLOYEE_ASSIGNED = "EMPLOYEE_ASSIGNED",
}

export enum AlimtalkTriggerOffsetType {
    IMMEDIATE = "IMMEDIATE",
    SAME_DAY = "SAME_DAY",
    BEFORE_DAYS = "BEFORE_DAYS",
    AFTER_DAYS = "AFTER_DAYS",
}

export enum AlimtalkTriggerRecipientType {
    CLIENT = "CLIENT",
    PRIMARY_EMPLOYEE = "PRIMARY_EMPLOYEE",
    SECONDARY_EMPLOYEE = "SECONDARY_EMPLOYEE",
}

export enum AlimtalkTriggerTemplateKey {
    CLIENT_WELCOME = "CLIENT_WELCOME",
    SERVICE_START_REMINDER = "SERVICE_START_REMINDER",
    SERVICE_INFO = "SERVICE_INFO",
    SERVICE_END_REMINDER = "SERVICE_END_REMINDER",
    EMPLOYEE_ASSIGNED = "EMPLOYEE_ASSIGNED",
}

export type SupportedTriggerProvider = "aligo" | "channeltalk";

export interface AlimtalkTriggerTemplateVariable {
    key: string;
    label: string;
}

export interface AlimtalkTriggerTemplateCatalogItem {
    key: AlimtalkTriggerTemplateKey;
    name: string;
    description: string;
    allowedEventTypes: AlimtalkTriggerEventType[];
    allowedRecipientTypes: AlimtalkTriggerRecipientType[];
    requiredVariables: AlimtalkTriggerTemplateVariable[];
    providers: Partial<Record<SupportedTriggerProvider, { templateKey: string }>>;
}

export const EVENT_RECIPIENT_OPTIONS: Record<
    AlimtalkTriggerEventType,
    readonly AlimtalkTriggerRecipientType[]
> = {
    [AlimtalkTriggerEventType.CLIENT_CREATED]: [AlimtalkTriggerRecipientType.CLIENT],
    [AlimtalkTriggerEventType.SERVICE_START]: [AlimtalkTriggerRecipientType.CLIENT],
    [AlimtalkTriggerEventType.SERVICE_END]: [AlimtalkTriggerRecipientType.CLIENT],
    [AlimtalkTriggerEventType.EMPLOYEE_ASSIGNED]: [
        AlimtalkTriggerRecipientType.PRIMARY_EMPLOYEE,
        AlimtalkTriggerRecipientType.SECONDARY_EMPLOYEE,
    ],
};

export const EVENT_OFFSET_OPTIONS: Record<
    AlimtalkTriggerEventType,
    readonly AlimtalkTriggerOffsetType[]
> = {
    [AlimtalkTriggerEventType.CLIENT_CREATED]: [
        AlimtalkTriggerOffsetType.IMMEDIATE,
        AlimtalkTriggerOffsetType.AFTER_DAYS,
    ],
    [AlimtalkTriggerEventType.SERVICE_START]: [
        AlimtalkTriggerOffsetType.SAME_DAY,
        AlimtalkTriggerOffsetType.BEFORE_DAYS,
        AlimtalkTriggerOffsetType.AFTER_DAYS,
    ],
    [AlimtalkTriggerEventType.SERVICE_END]: [
        AlimtalkTriggerOffsetType.SAME_DAY,
        AlimtalkTriggerOffsetType.BEFORE_DAYS,
        AlimtalkTriggerOffsetType.AFTER_DAYS,
    ],
    [AlimtalkTriggerEventType.EMPLOYEE_ASSIGNED]: [AlimtalkTriggerOffsetType.IMMEDIATE],
};

export const ALIMTALK_TRIGGER_TEMPLATE_CATALOG: Record<
    AlimtalkTriggerTemplateKey,
    AlimtalkTriggerTemplateCatalogItem
> = {
    [AlimtalkTriggerTemplateKey.CLIENT_WELCOME]: {
        key: AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
        name: "고객 등록 안내",
        description: "고객 등록 직후 또는 등록 후 N일 뒤 발송하는 안내 메시지",
        allowedEventTypes: [AlimtalkTriggerEventType.CLIENT_CREATED],
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "registrationDate", label: "등록일" },
            { key: "serviceType", label: "서비스 타입" },
        ],
        providers: {
            aligo: { templateKey: "CLIENT_CREATED" },
            channeltalk: { templateKey: "client_created" },
        },
    },
    [AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER]: {
        key: AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER,
        name: "서비스 시작 알림",
        description: "서비스 시작 전후 기준으로 고객에게 발송하는 안내 메시지",
        allowedEventTypes: [AlimtalkTriggerEventType.SERVICE_START],
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "serviceStartDate", label: "서비스 시작일" },
            { key: "timingText", label: "발송 기준 문구" },
        ],
        providers: {
            aligo: { templateKey: "SERVICE_START_REMINDER" },
            channeltalk: { templateKey: "service_start_reminder" },
        },
    },
    [AlimtalkTriggerTemplateKey.SERVICE_INFO]: {
        key: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        name: "서비스 안내",
        description: "서비스 시작 전 주요 안내사항을 고객에게 SMS로 발송하는 메시지",
        allowedEventTypes: [AlimtalkTriggerEventType.SERVICE_START],
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "name", label: "산모님 성함" },
        ],
        providers: {
            aligo: { templateKey: "SERVICE_INFO" },
            channeltalk: { templateKey: "service_info" },
        },
    },
    [AlimtalkTriggerTemplateKey.SERVICE_END_REMINDER]: {
        key: AlimtalkTriggerTemplateKey.SERVICE_END_REMINDER,
        name: "서비스 종료 알림",
        description: "서비스 종료 전후 기준으로 고객에게 발송하는 메시지",
        allowedEventTypes: [AlimtalkTriggerEventType.SERVICE_END],
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "serviceEndDate", label: "서비스 종료일" },
            { key: "timingText", label: "발송 기준 문구" },
        ],
        providers: {
            aligo: { templateKey: "SERVICE_END_REMINDER" },
            channeltalk: { templateKey: "service_end_reminder" },
        },
    },
    [AlimtalkTriggerTemplateKey.EMPLOYEE_ASSIGNED]: {
        key: AlimtalkTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        name: "직원 배정 알림",
        description: "직원이 고객에게 배정될 때 직원에게 발송하는 메시지",
        allowedEventTypes: [AlimtalkTriggerEventType.EMPLOYEE_ASSIGNED],
        allowedRecipientTypes: [
            AlimtalkTriggerRecipientType.PRIMARY_EMPLOYEE,
            AlimtalkTriggerRecipientType.SECONDARY_EMPLOYEE,
        ],
        requiredVariables: [
            { key: "employeeName", label: "직원명" },
            { key: "clientName", label: "고객명" },
            { key: "serviceStartDate", label: "서비스 시작일" },
        ],
        providers: {
            aligo: { templateKey: "EMPLOYEE_ASSIGNED" },
            channeltalk: { templateKey: "employee_assigned" },
        },
    },
};

export function getAlimtalkTriggerTemplateCatalog(
    provider: SupportedTriggerProvider,
): AlimtalkTriggerTemplateCatalogItem[] {
    return Object.values(ALIMTALK_TRIGGER_TEMPLATE_CATALOG).filter(
        (item) => item.providers[provider],
    );
}

export function isCompatibleTriggerTemplate(params: {
    templateKey: AlimtalkTriggerTemplateKey;
    eventType: AlimtalkTriggerEventType;
    recipientType: AlimtalkTriggerRecipientType;
}): boolean {
    const item = ALIMTALK_TRIGGER_TEMPLATE_CATALOG[params.templateKey];
    return (
        item.allowedEventTypes.includes(params.eventType) &&
        item.allowedRecipientTypes.includes(params.recipientType)
    );
}
