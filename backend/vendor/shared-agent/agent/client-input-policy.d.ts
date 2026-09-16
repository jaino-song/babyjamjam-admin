import { z } from "zod";
/**
 * Fields that the existing client write provider accepts.  Keep this list
 * deliberately closed: conversational input is allowed to edit only these
 * business fields plus the two explicit automation controls below.
 */
export declare const CLIENT_WRITE_FIELD_NAMES: readonly ["name", "address", "phone", "type", "duration", "fullPrice", "grant", "actualPrice", "startDate", "endDate", "careCenter", "voucherClient", "birthday", "dueDate", "birthDate", "serviceStatus", "breastPump", "areaId"];
export type ClientWriteField = (typeof CLIENT_WRITE_FIELD_NAMES)[number];
/**
 * This mirrors the existing provider's write surface without importing
 * backend code into the shared package.  Nullable values are represented in
 * the full value snapshot, while conversational `set` operations intentionally
 * require a non-null value; `clear` is the only deletion operation.
 */
export declare const ClientWriteFieldsSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    voucherClient: z.ZodOptional<z.ZodBoolean>;
    birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
export declare const AUTOMATION_CONSENT_CHOICES: readonly ["unanswered", "yes", "no"];
export declare const AutomationConsentChoiceSchema: z.ZodEnum<{
    unanswered: "unanswered";
    yes: "yes";
    no: "no";
}>;
export type AutomationConsentChoice = z.infer<typeof AutomationConsentChoiceSchema>;
export declare const AUTOMATION_INPUT_FIELD_NAMES: readonly ["automationChoice", "noSend"];
export type AutomationInputField = (typeof AUTOMATION_INPUT_FIELD_NAMES)[number];
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
    field: Exclude<ClientWriteField, "name" | "phone"> | AutomationInputField;
};
/** A bounded, path-free, field-level conversational edit. */
export type ClientInputOperation = SetOperation | MarkTentativeOperation | ClearOperation;
export declare const ClientInputOperationSchema: z.ZodType<ClientInputOperation>;
export type ClientSetOperation = SetOperation;
export type ClientMarkTentativeOperation = MarkTentativeOperation;
export type ClientClearOperation = ClearOperation;
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
    tentative: ClientWriteFields;
    automationChoice: AutomationConsentChoice;
    noSend: boolean;
}
/**
 * Remove presentation punctuation only where the input is unambiguous.  An
 * unexpected character returns null so callers retain the original input and
 * readiness can report a concrete validation issue instead of guessing.
 */
export declare function normalizeClientPhone(value: unknown): string | null;
export declare const normalizeClientPhoneInput: typeof normalizeClientPhone;
/**
 * Apply only validated operations.  `mark-tentative` never writes to
 * `confirmed`, and omission is naturally a no-op because operations are the
 * only input accepted by this helper.
 */
export declare function applyClientInputOperations(operations: readonly unknown[], initial?: Partial<ClientInputState>): ClientInputState;
export declare const applyClientInputPatch: typeof applyClientInputOperations;
export declare const ClientTaskInputOperationSchema: z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>;
export declare const AgentTaskInputOperationSchema: z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>;
export declare const ClientInputPatchOperationSchema: z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>;
/**
 * Readiness deliberately requires a server result.  The helper never treats a
 * syntactically valid phone as duplicate-free and never manufactures a check.
 */
export declare function evaluateClientReadiness(values: Partial<ClientWriteFields> | null | undefined, duplicateCheck: ClientDuplicateCheckResult | null | undefined): ClientReadinessResult;
export declare const getClientReadiness: typeof evaluateClientReadiness;
export declare const validateClientReadiness: typeof evaluateClientReadiness;
export declare const getTaskReadiness: typeof evaluateClientReadiness;
export declare const isClientReadyForTask: (values: Partial<ClientWriteFields> | null | undefined, duplicateCheck: ClientDuplicateCheckResult | null | undefined) => boolean;
export declare const isReadyForTask: (values: Partial<ClientWriteFields> | null | undefined, duplicateCheck: ClientDuplicateCheckResult | null | undefined) => boolean;
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
export declare const normalizeTaskPhone: typeof normalizeClientPhone;
export {};
