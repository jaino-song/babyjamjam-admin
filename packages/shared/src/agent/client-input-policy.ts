import { z } from "zod";

/**
 * Fields accepted by the existing client write provider. Conversational input
 * is closed over this list plus the explicit automation controls below.
 */
export const CLIENT_WRITE_FIELD_NAMES = [
    "name",
    "address",
    "phone",
    "type",
    "duration",
    "fullPrice",
    "grant",
    "actualPrice",
    "startDate",
    "endDate",
    "careCenter",
    "voucherClient",
    "birthday",
    "dueDate",
    "birthDate",
    "serviceStatus",
    "breastPump",
    "areaId",
] as const;

export type ClientWriteField = (typeof CLIENT_WRITE_FIELD_NAMES)[number];

const DateOnlyInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const DateInputValue = z.union([DateOnlyInput, z.string().datetime({ offset: true })]);
const DateInput = DateInputValue.nullable().optional();
const KoreanWonInput = z.string().trim().regex(
    /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:원)?$/u,
    "Amount must be a whole Korean-won value with no trailing text or decimals",
);

function isCalendarValidYymmdd(value: string): boolean {
    if (!/^\d{6}$/.test(value)) return false;

    const year = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day < 1) return false;

    const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (daysInMonth[month - 1] ?? 0);
}

const ClientBirthdaySchema = z.string()
    .regex(/^\d{6}$/, "Birthday must be six numeric YYMMDD digits")
    .refine(isCalendarValidYymmdd, "Birthday must be a calendar-valid YYMMDD date")
    .nullable()
    .optional();

const ServiceStatusSchema = z.enum([
    "pre_booking",
    "waiting",
    "replacement_requested",
    "active",
    "completed",
    "terminated",
]);

/** Confirmed values mirror the provider's shape and validators. */
export const ClientWriteFieldsSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    type: z.string().trim().max(40).nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    fullPrice: KoreanWonInput.max(40).nullable().optional(),
    grant: KoreanWonInput.max(80).nullable().optional(),
    actualPrice: KoreanWonInput.max(40).nullable().optional(),
    startDate: DateInput,
    endDate: DateInput,
    careCenter: z.boolean().nullable().optional(),
    voucherClient: z.boolean().optional(),
    birthday: ClientBirthdaySchema,
    dueDate: DateInput,
    birthDate: DateInput,
    serviceStatus: ServiceStatusSchema.nullable().optional(),
    breastPump: z.boolean().optional(),
    areaId: z.string().max(100).nullable().optional(),
}).strict();

export const ClientConfirmedValuesSchema = ClientWriteFieldsSchema;
export type ClientWriteFields = z.infer<typeof ClientWriteFieldsSchema>;
export type ClientConfirmedValues = z.infer<typeof ClientConfirmedValuesSchema>;

const TentativeText = (max: number) => z.string().trim().min(1).max(max);
const TentativeDate = TentativeText(100);

/** Tentative facts may be approximate wishes; they are never promoted here. */
export const ClientTentativeValuesSchema = z.object({
    name: TentativeText(120).optional(),
    address: TentativeText(300).nullable().optional(),
    phone: TentativeText(40).nullable().optional(),
    type: TentativeText(40).nullable().optional(),
    duration: z.union([z.number().int().nonnegative(), TentativeText(40)]).nullable().optional(),
    fullPrice: TentativeText(40).nullable().optional(),
    grant: TentativeText(80).nullable().optional(),
    actualPrice: TentativeText(40).nullable().optional(),
    startDate: TentativeDate.nullable().optional(),
    endDate: TentativeDate.nullable().optional(),
    careCenter: z.union([z.boolean(), TentativeText(40)]).nullable().optional(),
    voucherClient: z.union([z.boolean(), TentativeText(40)]).optional(),
    birthday: TentativeText(40).nullable().optional(),
    dueDate: TentativeDate.nullable().optional(),
    birthDate: TentativeDate.nullable().optional(),
    serviceStatus: TentativeText(80).nullable().optional(),
    breastPump: z.union([z.boolean(), TentativeText(40)]).optional(),
    areaId: TentativeText(100).nullable().optional(),
}).strict();

export type ClientTentativeValues = z.infer<typeof ClientTentativeValuesSchema>;

const CLIENT_OPERATION_VALUE_SCHEMAS = {
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300),
    phone: z.string().trim().min(1).max(40),
    type: z.string().trim().max(40),
    duration: z.number().int().nonnegative(),
    fullPrice: KoreanWonInput.max(40),
    grant: KoreanWonInput.max(80),
    actualPrice: KoreanWonInput.max(40),
    startDate: DateInputValue,
    endDate: DateInputValue,
    careCenter: z.boolean(),
    voucherClient: z.boolean(),
    birthday: z.string().regex(/^\d{6}$/).refine(isCalendarValidYymmdd),
    dueDate: DateInputValue,
    birthDate: DateInputValue,
    serviceStatus: ServiceStatusSchema,
    breastPump: z.boolean(),
    areaId: z.string().max(100),
} as const satisfies Record<ClientWriteField, z.ZodTypeAny>;

const CLIENT_TENTATIVE_OPERATION_VALUE_SCHEMAS = {
    name: TentativeText(120),
    address: TentativeText(300),
    phone: TentativeText(40),
    type: TentativeText(40),
    duration: z.union([z.number().int().nonnegative(), TentativeText(40)]),
    fullPrice: TentativeText(40),
    grant: TentativeText(80),
    actualPrice: TentativeText(40),
    startDate: TentativeDate,
    endDate: TentativeDate,
    careCenter: z.union([z.boolean(), TentativeText(40)]),
    voucherClient: z.union([z.boolean(), TentativeText(40)]),
    birthday: TentativeText(40),
    dueDate: TentativeDate,
    birthDate: TentativeDate,
    serviceStatus: TentativeText(80),
    breastPump: z.union([z.boolean(), TentativeText(40)]),
    areaId: TentativeText(100),
} as const satisfies Record<ClientWriteField, z.ZodTypeAny>;

export const AUTOMATION_CONSENT_CHOICES = ["unanswered", "yes", "no"] as const;
export const AutomationConsentChoiceSchema = z.enum(AUTOMATION_CONSENT_CHOICES);
export type AutomationConsentChoice = z.infer<typeof AutomationConsentChoiceSchema>;

export const AUTOMATION_INPUT_FIELD_NAMES = ["automationChoice", "noSend"] as const;
export type AutomationInputField = (typeof AUTOMATION_INPUT_FIELD_NAMES)[number];

const CLIENT_CLEARABLE_FIELD_NAMES = CLIENT_WRITE_FIELD_NAMES.filter(
    (field): field is Exclude<ClientWriteField, "name" | "phone"> => field !== "name" && field !== "phone",
);

type SetOperation = { op: "set"; field: ClientWriteField | AutomationInputField; value: unknown };
type MarkTentativeOperation = { op: "mark-tentative"; field: ClientWriteField; value: unknown };
type ClearOperation = { op: "clear"; field: Exclude<ClientWriteField, "name" | "phone"> | AutomationInputField };

function strictSetVariants() {
    const clientVariants = CLIENT_WRITE_FIELD_NAMES.map((field) => z.object({
        op: z.literal("set"),
        field: z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
    }).strict());

    return [
        ...clientVariants,
        z.object({ op: z.literal("set"), field: z.literal("automationChoice"), value: AutomationConsentChoiceSchema }).strict(),
        z.object({ op: z.literal("set"), field: z.literal("noSend"), value: z.boolean() }).strict(),
    ] as const;
}

function strictTentativeVariants() {
    return CLIENT_WRITE_FIELD_NAMES.map((field) => z.object({
        op: z.literal("mark-tentative"),
        field: z.literal(field),
        value: CLIENT_TENTATIVE_OPERATION_VALUE_SCHEMAS[field],
    }).strict()) as unknown as readonly [z.ZodTypeAny, ...z.ZodTypeAny[]];
}

function strictClearVariants() {
    const clientVariants = CLIENT_CLEARABLE_FIELD_NAMES.map((field) => z.object({
        op: z.literal("clear"),
        field: z.literal(field),
    }).strict());

    return [
        ...clientVariants,
        z.object({ op: z.literal("clear"), field: z.literal("automationChoice") }).strict(),
        z.object({ op: z.literal("clear"), field: z.literal("noSend") }).strict(),
    ] as const;
}

/** A bounded, field-level conversational edit. */
export type ClientInputOperation = SetOperation | MarkTentativeOperation | ClearOperation;
const ClientInputOperationRawSchema = z.union([
    ...strictSetVariants(),
    ...strictTentativeVariants(),
    ...strictClearVariants(),
] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

function normalizeParsedOperation(operation: ClientInputOperation): ClientInputOperation {
    if ((operation.op === "set" || operation.op === "mark-tentative") && operation.field === "phone") {
        return { ...operation, value: normalizeClientPhone(operation.value) ?? operation.value };
    }
    return operation;
}

export const ClientInputOperationSchema: z.ZodType<ClientInputOperation> = ClientInputOperationRawSchema.transform(
    (operation) => normalizeParsedOperation(operation as ClientInputOperation),
) as unknown as z.ZodType<ClientInputOperation>;
export type ClientSetOperation = SetOperation;
export type ClientMarkTentativeOperation = MarkTentativeOperation;
export type ClientClearOperation = ClearOperation;
export const ClientInputOperationsSchema = z.array(ClientInputOperationSchema).max(100);

export const ClientDuplicateCheckStatusSchema = z.enum(["not_checked", "checking", "clear", "duplicate", "failed"]);
export const ClientDuplicateCheckResultSchema = z.object({
    status: ClientDuplicateCheckStatusSchema,
    checkedPhone: z.string().regex(/^\d{11}$/).optional(),
}).strict();
export type ClientDuplicateCheckResult = z.infer<typeof ClientDuplicateCheckResultSchema>;

export const ClientReadinessIssueSchema = z.enum([
    "name_required",
    "phone_required",
    "phone_must_be_11_digits",
    "phone_duplicate_check_required",
    "phone_duplicate",
    "phone_duplicate_check_failed",
]);
export type ClientReadinessIssue = z.infer<typeof ClientReadinessIssueSchema>;
export const ClientReadinessResultSchema = z.object({
    ready: z.boolean(),
    issues: z.array(ClientReadinessIssueSchema),
    normalizedPhone: z.string().regex(/^\d{11}$/).optional(),
}).strict();
export type ClientReadinessResult = z.infer<typeof ClientReadinessResultSchema>;

export interface ClientInputState {
    confirmed: ClientWriteFields;
    tentative: ClientTentativeValues;
    automationChoice: AutomationConsentChoice;
    noSend: boolean;
}

/** Remove presentation punctuation only when unambiguous. */
export function normalizeClientPhone(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (!/^[0-9\s().-]+$/.test(trimmed)) return null;
    const digits = trimmed.replace(/[\s().-]/g, "");
    return digits || null;
}

function normalizeOperationValue(field: ClientWriteField, value: unknown): unknown {
    if (field === "phone") return normalizeClientPhone(value) ?? value;
    return value;
}

function cloneConfirmed(values: ClientWriteFields | undefined): ClientWriteFields {
    return values ? { ...values } : {};
}

function cloneTentative(values: ClientTentativeValues | undefined): ClientTentativeValues {
    return values ? { ...values } : {};
}

/** Apply only validated operations; tentative values never promote themselves. */
export function applyClientInputOperations(
    operations: readonly unknown[],
    initial: Partial<ClientInputState> = {},
): ClientInputState {
    const state: ClientInputState = {
        confirmed: cloneConfirmed(initial.confirmed),
        tentative: cloneTentative(initial.tentative),
        automationChoice: initial.automationChoice ?? "unanswered",
        noSend: initial.noSend ?? false,
    };

    for (const rawOperation of operations) {
        const operation = ClientInputOperationSchema.parse(rawOperation) as ClientInputOperation;
        if (operation.op === "set") {
            if (operation.field === "automationChoice") {
                state.automationChoice = operation.value as AutomationConsentChoice;
            } else if (operation.field === "noSend") {
                state.noSend = operation.value as boolean;
            } else {
                const field = operation.field as ClientWriteField;
                state.confirmed[field] = normalizeOperationValue(field, operation.value) as never;
                delete state.tentative[field];
            }
        } else if (operation.op === "mark-tentative") {
            state.tentative[operation.field] = normalizeOperationValue(operation.field, operation.value) as never;
        } else if (operation.field === "automationChoice") {
            state.automationChoice = "unanswered";
        } else if (operation.field === "noSend") {
            state.noSend = false;
        } else {
            const field = operation.field as ClientWriteField;
            delete state.confirmed[field];
            delete state.tentative[field];
        }
    }

    return state;
}

function normalizeName(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** Readiness requires a matching server duplicate-check result. */
export function evaluateClientReadiness(
    values: Partial<ClientWriteFields> | null | undefined,
    duplicateCheck: ClientDuplicateCheckResult | null | undefined,
): ClientReadinessResult {
    const issues: ClientReadinessIssue[] = [];
    const name = normalizeName(values?.name);
    if (!name) issues.push("name_required");

    const normalizedPhone = normalizeClientPhone(values?.phone);
    if (!normalizedPhone) issues.push("phone_required");
    else if (!/^\d{11}$/.test(normalizedPhone)) issues.push("phone_must_be_11_digits");

    if (!duplicateCheck || duplicateCheck.status === "not_checked" || duplicateCheck.status === "checking") {
        issues.push("phone_duplicate_check_required");
    } else if (duplicateCheck.status === "duplicate") {
        issues.push("phone_duplicate");
    } else if (duplicateCheck.status === "failed") {
        issues.push("phone_duplicate_check_failed");
    } else if (duplicateCheck.status === "clear" && (!normalizedPhone || duplicateCheck.checkedPhone !== normalizedPhone)) {
        issues.push("phone_duplicate_check_required");
    }

    return {
        ready: issues.length === 0,
        issues,
        ...(normalizedPhone && /^\d{11}$/.test(normalizedPhone) ? { normalizedPhone } : {}),
    };
}

export const isClientReadyForTask = (
    values: Partial<ClientWriteFields> | null | undefined,
    duplicateCheck: ClientDuplicateCheckResult | null | undefined,
): boolean => evaluateClientReadiness(values, duplicateCheck).ready;

export const CLIENT_CREATE_DEFAULTS = { voucherClient: false, serviceStatus: "pre_booking" } as const;
export const AUTOMATION_CHOICE_DEFAULT: AutomationConsentChoice = "unanswered";

export function createClientInputState(): ClientInputState {
    return { confirmed: { ...CLIENT_CREATE_DEFAULTS }, tentative: {}, automationChoice: AUTOMATION_CHOICE_DEFAULT, noSend: false };
}

export const ClientWriteFieldSchema = z.enum(CLIENT_WRITE_FIELD_NAMES);
export const ClientClearableFieldSchema = z.enum(CLIENT_CLEARABLE_FIELD_NAMES);
export const ClientAutomationInputFieldSchema = z.enum(AUTOMATION_INPUT_FIELD_NAMES);
