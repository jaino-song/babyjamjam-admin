import { z } from "zod";
/**
 * Fields accepted by the existing client write provider. Conversational input
 * is closed over this list plus the explicit automation controls below.
 */
export declare const CLIENT_WRITE_FIELD_NAMES: readonly ["name", "address", "phone", "type", "duration", "fullPrice", "grant", "actualPrice", "startDate", "endDate", "careCenter", "voucherClient", "birthday", "dueDate", "birthDate", "serviceStatus", "breastPump", "areaId"];
export type ClientWriteField = (typeof CLIENT_WRITE_FIELD_NAMES)[number];
/** Confirmed values mirror the provider's shape and validators. */
export declare const ClientWriteFieldsSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    endDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    voucherClient: z.ZodOptional<z.ZodBoolean>;
    birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    birthDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        pre_booking: "pre_booking";
        waiting: "waiting";
        replacement_requested: "replacement_requested";
        active: "active";
        completed: "completed";
        terminated: "terminated";
    }>>>;
    breastPump: z.ZodOptional<z.ZodBoolean>;
    areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const ClientConfirmedValuesSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    endDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    voucherClient: z.ZodOptional<z.ZodBoolean>;
    birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    birthDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
    serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        pre_booking: "pre_booking";
        waiting: "waiting";
        replacement_requested: "replacement_requested";
        active: "active";
        completed: "completed";
        terminated: "terminated";
    }>>>;
    breastPump: z.ZodOptional<z.ZodBoolean>;
    areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type ClientWriteFields = z.infer<typeof ClientWriteFieldsSchema>;
export type ClientConfirmedValues = z.infer<typeof ClientConfirmedValuesSchema>;
/** Tentative facts may be approximate wishes; they are never promoted here. */
export declare const ClientTentativeValuesSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duration: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    careCenter: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>>;
    voucherClient: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
    birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    breastPump: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
    areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type ClientTentativeValues = z.infer<typeof ClientTentativeValuesSchema>;
export declare const AUTOMATION_CONSENT_CHOICES: readonly ["unanswered", "yes", "no"];
export declare const AutomationConsentChoiceSchema: z.ZodEnum<{
    unanswered: "unanswered";
    yes: "yes";
    no: "no";
}>;
export type AutomationConsentChoice = z.infer<typeof AutomationConsentChoiceSchema>;
export declare const AUTOMATION_INPUT_FIELD_NAMES: readonly ["automationChoice", "noSend"];
export type AutomationInputField = (typeof AUTOMATION_INPUT_FIELD_NAMES)[number];
/**
 * Provider-nullable business fields that may be explicitly deleted. Required
 * identity fields and non-nullable booleans use set:false or set values and
 * never enter this marker set.
 */
export declare const CLIENT_CLEARABLE_FIELD_NAMES: readonly ["address", "type", "duration", "fullPrice", "grant", "actualPrice", "startDate", "endDate", "careCenter", "birthday", "dueDate", "birthDate", "serviceStatus", "areaId"];
export type ClientClearableField = (typeof CLIENT_CLEARABLE_FIELD_NAMES)[number];
export declare const ClientClearableFieldSchema: z.ZodEnum<{
    type: "type";
    address: "address";
    duration: "duration";
    fullPrice: "fullPrice";
    grant: "grant";
    actualPrice: "actualPrice";
    startDate: "startDate";
    endDate: "endDate";
    careCenter: "careCenter";
    birthday: "birthday";
    dueDate: "dueDate";
    birthDate: "birthDate";
    serviceStatus: "serviceStatus";
    areaId: "areaId";
}>;
/** Canonical marker representation used in state and persisted task drafts. */
export declare const ClientClearedFieldsSchema: z.ZodPipe<z.ZodArray<z.ZodEnum<{
    type: "type";
    address: "address";
    duration: "duration";
    fullPrice: "fullPrice";
    grant: "grant";
    actualPrice: "actualPrice";
    startDate: "startDate";
    endDate: "endDate";
    careCenter: "careCenter";
    birthday: "birthday";
    dueDate: "dueDate";
    birthDate: "birthDate";
    serviceStatus: "serviceStatus";
    areaId: "areaId";
}>>, z.ZodTransform<("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[], ("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[]>>;
export type ClientClearedFields = z.infer<typeof ClientClearedFieldsSchema>;
type SetOperation = {
    op: "set";
    field: ClientWriteField | AutomationInputField;
    value: unknown;
};
type MarkTentativeOperation = {
    op: "mark-tentative";
    field: ClientWriteField;
    value: unknown;
};
type ClearOperation = {
    op: "clear";
    field: ClientClearableField | AutomationInputField;
};
type DiscardChangeOperation = {
    op: "discard-change";
    field: ClientWriteField;
};
/** A bounded, field-level conversational edit. */
export type ClientInputOperation = SetOperation | MarkTentativeOperation | ClearOperation | DiscardChangeOperation;
export declare const ClientInputOperationSchema: z.ZodType<ClientInputOperation>;
export type ClientSetOperation = SetOperation;
export type ClientMarkTentativeOperation = MarkTentativeOperation;
export type ClientClearOperation = ClearOperation;
export type ClientDiscardChangeOperation = DiscardChangeOperation;
export declare const ClientInputOperationsSchema: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
export declare const ClientDuplicateCheckStatusSchema: z.ZodEnum<{
    failed: "failed";
    clear: "clear";
    not_checked: "not_checked";
    checking: "checking";
    duplicate: "duplicate";
}>;
export declare const ClientDuplicateCheckResultSchema: z.ZodObject<{
    status: z.ZodEnum<{
        failed: "failed";
        clear: "clear";
        not_checked: "not_checked";
        checking: "checking";
        duplicate: "duplicate";
    }>;
    checkedPhone: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type ClientDuplicateCheckResult = z.infer<typeof ClientDuplicateCheckResultSchema>;
export declare const ClientReadinessIssueSchema: z.ZodEnum<{
    name_required: "name_required";
    phone_required: "phone_required";
    phone_must_be_11_digits: "phone_must_be_11_digits";
    phone_duplicate_check_required: "phone_duplicate_check_required";
    phone_duplicate: "phone_duplicate";
    phone_duplicate_check_failed: "phone_duplicate_check_failed";
}>;
export type ClientReadinessIssue = z.infer<typeof ClientReadinessIssueSchema>;
export declare const ClientReadinessResultSchema: z.ZodObject<{
    ready: z.ZodBoolean;
    issues: z.ZodArray<z.ZodEnum<{
        name_required: "name_required";
        phone_required: "phone_required";
        phone_must_be_11_digits: "phone_must_be_11_digits";
        phone_duplicate_check_required: "phone_duplicate_check_required";
        phone_duplicate: "phone_duplicate";
        phone_duplicate_check_failed: "phone_duplicate_check_failed";
    }>>;
    normalizedPhone: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type ClientReadinessResult = z.infer<typeof ClientReadinessResultSchema>;
export interface ClientInputState {
    confirmed: ClientWriteFields;
    tentative: ClientTentativeValues;
    clearedFields: ClientClearedFields;
    automationChoice: AutomationConsentChoice;
    noSend: boolean;
}
/** Remove presentation punctuation only when unambiguous. */
export declare function normalizeClientPhone(value: unknown): string | null;
/** Apply only validated operations; tentative values never promote themselves. */
export declare function applyClientInputOperations(operations: readonly unknown[], initial?: Partial<ClientInputState>): ClientInputState;
/** Readiness requires a matching server duplicate-check result. */
export declare function evaluateClientReadiness(values: Partial<ClientWriteFields> | null | undefined, duplicateCheck: ClientDuplicateCheckResult | null | undefined): ClientReadinessResult;
export declare const isClientReadyForTask: (values: Partial<ClientWriteFields> | null | undefined, duplicateCheck: ClientDuplicateCheckResult | null | undefined) => boolean;
export declare const CLIENT_CREATE_DEFAULTS: {
    readonly voucherClient: false;
    readonly serviceStatus: "pre_booking";
};
export declare const AUTOMATION_CHOICE_DEFAULT: AutomationConsentChoice;
export declare function createClientInputState(): ClientInputState;
export declare const ClientWriteFieldSchema: z.ZodEnum<{
    type: "type";
    name: "name";
    address: "address";
    phone: "phone";
    duration: "duration";
    fullPrice: "fullPrice";
    grant: "grant";
    actualPrice: "actualPrice";
    startDate: "startDate";
    endDate: "endDate";
    careCenter: "careCenter";
    voucherClient: "voucherClient";
    birthday: "birthday";
    dueDate: "dueDate";
    birthDate: "birthDate";
    serviceStatus: "serviceStatus";
    breastPump: "breastPump";
    areaId: "areaId";
}>;
export declare const ClientAutomationInputFieldSchema: z.ZodEnum<{
    automationChoice: "automationChoice";
    noSend: "noSend";
}>;
export {};
