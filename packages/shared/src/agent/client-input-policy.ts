import { z } from "zod";

/**
 * Fields that the existing client write provider accepts.  Keep this list
 * deliberately closed: conversational input is allowed to edit only these
 * business fields plus the two explicit automation controls below.
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

const DATE_VALUE_SCHEMA = z.string().trim().min(1).max(100);
const NON_EMPTY_STRING_SCHEMA = z.string().trim().min(1);

/**
 * This mirrors the existing provider's write surface without importing
 * backend code into the shared package.  Nullable values are represented in
 * the full value snapshot, while conversational `set` operations intentionally
 * require a non-null value; `clear` is the only deletion operation.
 */
export const ClientWriteFieldsSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    type: z.string().trim().max(40).nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    fullPrice: z.string().trim().max(40).nullable().optional(),
    grant: z.string().trim().max(80).nullable().optional(),
    actualPrice: z.string().trim().max(40).nullable().optional(),
    startDate: DATE_VALUE_SCHEMA.nullable().optional(),
    endDate: DATE_VALUE_SCHEMA.nullable().optional(),
    careCenter: z.boolean().nullable().optional(),
    voucherClient: z.boolean().optional(),
    birthday: z.string().regex(/^\d{6}$/).nullable().optional(),
    dueDate: DATE_VALUE_SCHEMA.nullable().optional(),
    birthDate: DATE_VALUE_SCHEMA.nullable().optional(),
    serviceStatus: z.enum([
        "pre_booking",
        "waiting",
        "replacement_requested",
        "active",
        "completed",
        "terminated",
    ]).nullable().optional(),
    breastPump: z.boolean().optional(),
    areaId: z.string().max(100).nullable().optional(),
}).strict();

export type ClientWriteFields = z.infer<typeof ClientWriteFieldsSchema>;

const CLIENT_OPERATION_VALUE_SCHEMAS = {
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300),
    phone: z.string().trim().min(1).max(40),
    type: z.string().trim().max(40),
    duration: z.number().int().nonnegative(),
    fullPrice: z.string().trim().max(40),
    grant: z.string().trim().max(80),
    actualPrice: z.string().trim().max(40),
    startDate: DATE_VALUE_SCHEMA,
    endDate: DATE_VALUE_SCHEMA,
    careCenter: z.boolean(),
    voucherClient: z.boolean(),
    birthday: z.string().regex(/^\d{6}$/),
    dueDate: DATE_VALUE_SCHEMA,
    birthDate: DATE_VALUE_SCHEMA,
    serviceStatus: z.enum([
        "pre_booking",
        "waiting",
        "replacement_requested",
        "active",
        "completed",
        "terminated",
    ]),
    breastPump: z.boolean(),
    areaId: z.string().max(100),
} as const satisfies Record<ClientWriteField, z.ZodTypeAny>;

export const AUTOMATION_CONSENT_CHOICES = ["unanswered", "yes", "no"] as const;
export const AutomationConsentChoiceSchema = z.enum(AUTOMATION_CONSENT_CHOICES);
export type AutomationConsentChoice = z.infer<typeof AutomationConsentChoiceSchema>;

export const AUTOMATION_INPUT_FIELD_NAMES = ["automationChoice", "noSend"] as const;
export type AutomationInputField = (typeof AUTOMATION_INPUT_FIELD_NAMES)[number];

const CLIENT_CLEARABLE_FIELD_NAMES = CLIENT_WRITE_FIELD_NAMES.filter(
    (field): field is Exclude<ClientWriteField, "name" | "phone"> => field !== "name" && field !== "phone",
);

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

function strictSetVariants() {
    const clientVariants = CLIENT_WRITE_FIELD_NAMES.map((field) => z.object({
        op: z.literal("set"),
        field: z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
    }).strict());

    return [
        ...clientVariants,
        z.object({
            op: z.literal("set"),
            field: z.literal("automationChoice"),
            value: AutomationConsentChoiceSchema,
        }).strict(),
        z.object({
            op: z.literal("set"),
            field: z.literal("noSend"),
            value: z.boolean(),
        }).strict(),
    ] as const;
}

function strictTentativeVariants() {
    return CLIENT_WRITE_FIELD_NAMES.map((field) => z.object({
        op: z.literal("mark-tentative"),
        field: z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
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

/** A bounded, path-free, field-level conversational edit. */
export type ClientInputOperation = SetOperation | MarkTentativeOperation | ClearOperation;

export const ClientInputOperationSchema: z.ZodType<ClientInputOperation> = z.union([
    ...strictSetVariants(),
    ...strictTentativeVariants(),
    ...strictClearVariants(),
] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]) as z.ZodType<ClientInputOperation>;
export type ClientSetOperation = SetOperation;
export type ClientMarkTentativeOperation = MarkTentativeOperation;
export type ClientClearOperation = ClearOperation;

export const ClientInputOperationsSchema = z.array(ClientInputOperationSchema).max(100);

export const ClientDuplicateCheckStatusSchema = z.enum([
    "not_checked",
    "checking",
    "clear",
    "duplicate",
    "failed",
]);

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
    tentative: ClientWriteFields;
    automationChoice: AutomationConsentChoice;
    noSend: boolean;
}

const EMPTY_CLIENT_INPUT_STATE: ClientInputState = {
    confirmed: {},
    tentative: {},
    automationChoice: "unanswered",
    noSend: false,
};

/**
 * Remove presentation punctuation only where the input is unambiguous.  An
 * unexpected character returns null so callers retain the original input and
 * readiness can report a concrete validation issue instead of guessing.
 */
export function normalizeClientPhone(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed) return "";
    if (!/^[0-9\s().-]+$/.test(trimmed)) return null;

    const digits = trimmed.replace(/[\s().-]/g, "");
    return digits || null;
}

export const normalizeClientPhoneInput = normalizeClientPhone;

function normalizeOperationValue(field: ClientWriteField, value: unknown): unknown {
    if (field === "phone") {
        const normalized = normalizeClientPhone(value);
        return normalized ?? value;
    }

    return value;
}

function cloneClientFields(values: ClientWriteFields | undefined): ClientWriteFields {
    return values ? { ...values } : {};
}

/**
 * Apply only validated operations.  `mark-tentative` never writes to
 * `confirmed`, and omission is naturally a no-op because operations are the
 * only input accepted by this helper.
 */
export function applyClientInputOperations(
    operations: readonly unknown[],
    initial: Partial<ClientInputState> = {},
): ClientInputState {
    const state: ClientInputState = {
        confirmed: cloneClientFields(initial.confirmed),
        tentative: cloneClientFields(initial.tentative),
        automationChoice: initial.automationChoice ?? EMPTY_CLIENT_INPUT_STATE.automationChoice,
        noSend: initial.noSend ?? EMPTY_CLIENT_INPUT_STATE.noSend,
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

export const applyClientInputPatch = applyClientInputOperations;
export const ClientTaskInputOperationSchema = ClientInputOperationSchema;
export const AgentTaskInputOperationSchema = ClientInputOperationSchema;
export const ClientInputPatchOperationSchema = ClientInputOperationSchema;

function normalizeName(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Readiness deliberately requires a server result.  The helper never treats a
 * syntactically valid phone as duplicate-free and never manufactures a check.
 */
export function evaluateClientReadiness(
    values: Partial<ClientWriteFields> | null | undefined,
    duplicateCheck: ClientDuplicateCheckResult | null | undefined,
): ClientReadinessResult {
    const issues: ClientReadinessIssue[] = [];
    const name = normalizeName(values?.name);
    if (!name) issues.push("name_required");

    const normalizedPhone = normalizeClientPhone(values?.phone);
    if (!normalizedPhone) {
        issues.push("phone_required");
    } else if (!/^\d{11}$/.test(normalizedPhone)) {
        issues.push("phone_must_be_11_digits");
    }

    if (!duplicateCheck || duplicateCheck.status === "not_checked" || duplicateCheck.status === "checking") {
        issues.push("phone_duplicate_check_required");
    } else if (duplicateCheck.status === "duplicate") {
        issues.push("phone_duplicate");
    } else if (duplicateCheck.status === "failed") {
        issues.push("phone_duplicate_check_failed");
    } else if (duplicateCheck.status === "clear") {
        if (!normalizedPhone || duplicateCheck.checkedPhone !== normalizedPhone) {
            issues.push("phone_duplicate_check_required");
        }
    }

    return {
        ready: issues.length === 0,
        issues,
        ...(normalizedPhone && /^\d{11}$/.test(normalizedPhone) ? { normalizedPhone } : {}),
    };
}

export const getClientReadiness = evaluateClientReadiness;
export const validateClientReadiness = evaluateClientReadiness;
export const getTaskReadiness = evaluateClientReadiness;
export const isClientReadyForTask = (
    values: Partial<ClientWriteFields> | null | undefined,
    duplicateCheck: ClientDuplicateCheckResult | null | undefined,
): boolean => evaluateClientReadiness(values, duplicateCheck).ready;
export const isReadyForTask = isClientReadyForTask;

export const CLIENT_CREATE_DEFAULTS = {
    voucherClient: false,
    serviceStatus: "pre_booking",
} as const;

export const AUTOMATION_CHOICE_DEFAULT: AutomationConsentChoice = "unanswered";

export function createClientInputState(): ClientInputState {
    return {
        confirmed: { ...CLIENT_CREATE_DEFAULTS },
        tentative: {},
        automationChoice: AUTOMATION_CHOICE_DEFAULT,
        noSend: false,
    };
}

export const ClientWriteFieldSchema = z.enum(CLIENT_WRITE_FIELD_NAMES);
export const ClientClearableFieldSchema = z.enum(CLIENT_CLEARABLE_FIELD_NAMES);
export const ClientAutomationInputFieldSchema = z.enum(AUTOMATION_INPUT_FIELD_NAMES);

export const normalizeTaskPhone = normalizeClientPhone;
