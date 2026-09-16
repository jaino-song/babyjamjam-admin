"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientModelInputOperationsSchema = exports.ClientModelInputOperationSchema = exports.ClientModelTaskOperationsSchema = exports.ClientModelTaskOperationSchema = exports.ClientModelReferenceFieldSchema = exports.ClientModelValueReferenceSchema = exports.ClientModelLiteralFieldSchema = exports.CLIENT_MODEL_LITERAL_FIELD_NAMES = exports.ClientAutomationInputFieldSchema = exports.ClientWriteFieldSchema = exports.AUTOMATION_CHOICE_DEFAULT = exports.CLIENT_CREATE_DEFAULTS = exports.isClientReadyForTask = exports.ClientReadinessResultSchema = exports.ClientReadinessIssueSchema = exports.ClientDuplicateCheckResultSchema = exports.ClientDuplicateCheckStatusSchema = exports.ClientInputOperationsSchema = exports.ClientInputOperationSchema = exports.ClientClearedFieldsSchema = exports.ClientClearableFieldSchema = exports.CLIENT_CLEARABLE_FIELD_NAMES = exports.AUTOMATION_INPUT_FIELD_NAMES = exports.AutomationConsentChoiceSchema = exports.AUTOMATION_CONSENT_CHOICES = exports.ClientTentativeValuesSchema = exports.ClientConfirmedValuesSchema = exports.ClientWriteFieldsSchema = exports.ClientServiceStatusSchema = exports.ClientDateInputValueSchema = exports.CLIENT_WRITE_FIELD_NAMES = void 0;
exports.normalizeClientPhone = normalizeClientPhone;
exports.applyClientInputOperations = applyClientInputOperations;
exports.evaluateClientReadiness = evaluateClientReadiness;
exports.createClientInputState = createClientInputState;
const zod_1 = require("zod");
/**
 * Fields accepted by the existing client write provider. Conversational input
 * is closed over this list plus the explicit automation controls below.
 */
exports.CLIENT_WRITE_FIELD_NAMES = [
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
];
const DateOnlyInput = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
exports.ClientDateInputValueSchema = zod_1.z.union([DateOnlyInput, zod_1.z.string().datetime({ offset: true })]);
const DateInputValue = exports.ClientDateInputValueSchema;
const DateInput = DateInputValue.nullable().optional();
const KoreanWonInput = zod_1.z.string().trim().regex(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:원)?$/u, "Amount must be a whole Korean-won value with no trailing text or decimals");
function isCalendarValidYymmdd(value) {
    if (!/^\d{6}$/.test(value))
        return false;
    const year = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day < 1)
        return false;
    const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (daysInMonth[month - 1] ?? 0);
}
const ClientBirthdaySchema = zod_1.z.string()
    .regex(/^\d{6}$/, "Birthday must be six numeric YYMMDD digits")
    .refine(isCalendarValidYymmdd, "Birthday must be a calendar-valid YYMMDD date")
    .nullable()
    .optional();
exports.ClientServiceStatusSchema = zod_1.z.enum([
    "pre_booking",
    "waiting",
    "replacement_requested",
    "active",
    "completed",
    "terminated",
]);
const ServiceStatusSchema = exports.ClientServiceStatusSchema;
/** Confirmed values mirror the provider's shape and validators. */
exports.ClientWriteFieldsSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    address: zod_1.z.string().trim().max(300).nullable().optional(),
    phone: zod_1.z.string().trim().max(40).nullable().optional(),
    type: zod_1.z.string().trim().max(40).nullable().optional(),
    duration: zod_1.z.number().int().nonnegative().nullable().optional(),
    fullPrice: KoreanWonInput.max(40).nullable().optional(),
    grant: KoreanWonInput.max(80).nullable().optional(),
    actualPrice: KoreanWonInput.max(40).nullable().optional(),
    startDate: DateInput,
    endDate: DateInput,
    careCenter: zod_1.z.boolean().nullable().optional(),
    voucherClient: zod_1.z.boolean().optional(),
    birthday: ClientBirthdaySchema,
    dueDate: DateInput,
    birthDate: DateInput,
    serviceStatus: ServiceStatusSchema.nullable().optional(),
    breastPump: zod_1.z.boolean().optional(),
    areaId: zod_1.z.string().max(100).nullable().optional(),
}).strict();
exports.ClientConfirmedValuesSchema = exports.ClientWriteFieldsSchema;
const TentativeText = (max) => zod_1.z.string().trim().min(1).max(max);
const TentativeDate = TentativeText(100);
/** Tentative facts may be approximate wishes; they are never promoted here. */
exports.ClientTentativeValuesSchema = zod_1.z.object({
    name: TentativeText(120).optional(),
    address: TentativeText(300).nullable().optional(),
    phone: TentativeText(40).nullable().optional(),
    type: TentativeText(40).nullable().optional(),
    duration: zod_1.z.union([zod_1.z.number().int().nonnegative(), TentativeText(40)]).nullable().optional(),
    fullPrice: TentativeText(40).nullable().optional(),
    grant: TentativeText(80).nullable().optional(),
    actualPrice: TentativeText(40).nullable().optional(),
    startDate: TentativeDate.nullable().optional(),
    endDate: TentativeDate.nullable().optional(),
    careCenter: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]).nullable().optional(),
    voucherClient: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]).optional(),
    birthday: TentativeText(40).nullable().optional(),
    dueDate: TentativeDate.nullable().optional(),
    birthDate: TentativeDate.nullable().optional(),
    serviceStatus: TentativeText(80).nullable().optional(),
    breastPump: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]).optional(),
    areaId: TentativeText(100).nullable().optional(),
}).strict();
const CLIENT_OPERATION_VALUE_SCHEMAS = {
    name: zod_1.z.string().trim().min(1).max(120),
    address: zod_1.z.string().trim().max(300),
    phone: zod_1.z.string().trim().min(1).max(40),
    type: zod_1.z.string().trim().max(40),
    duration: zod_1.z.number().int().nonnegative(),
    fullPrice: KoreanWonInput.max(40),
    grant: KoreanWonInput.max(80),
    actualPrice: KoreanWonInput.max(40),
    startDate: DateInputValue,
    endDate: DateInputValue,
    careCenter: zod_1.z.boolean(),
    voucherClient: zod_1.z.boolean(),
    birthday: zod_1.z.string().regex(/^\d{6}$/).refine(isCalendarValidYymmdd),
    dueDate: DateInputValue,
    birthDate: DateInputValue,
    serviceStatus: ServiceStatusSchema,
    breastPump: zod_1.z.boolean(),
    areaId: zod_1.z.string().max(100),
};
const CLIENT_TENTATIVE_OPERATION_VALUE_SCHEMAS = {
    name: TentativeText(120),
    address: TentativeText(300),
    phone: TentativeText(40),
    type: TentativeText(40),
    duration: zod_1.z.union([zod_1.z.number().int().nonnegative(), TentativeText(40)]),
    fullPrice: TentativeText(40),
    grant: TentativeText(80),
    actualPrice: TentativeText(40),
    startDate: TentativeDate,
    endDate: TentativeDate,
    careCenter: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]),
    voucherClient: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]),
    birthday: TentativeText(40),
    dueDate: TentativeDate,
    birthDate: TentativeDate,
    serviceStatus: TentativeText(80),
    breastPump: zod_1.z.union([zod_1.z.boolean(), TentativeText(40)]),
    areaId: TentativeText(100),
};
exports.AUTOMATION_CONSENT_CHOICES = ["unanswered", "yes", "no"];
exports.AutomationConsentChoiceSchema = zod_1.z.enum(exports.AUTOMATION_CONSENT_CHOICES);
exports.AUTOMATION_INPUT_FIELD_NAMES = ["automationChoice", "noSend"];
/**
 * Provider-nullable business fields that may be explicitly deleted. Required
 * identity fields and non-nullable booleans use set:false or set values and
 * never enter this marker set.
 */
exports.CLIENT_CLEARABLE_FIELD_NAMES = [
    "address",
    "type",
    "duration",
    "fullPrice",
    "grant",
    "actualPrice",
    "startDate",
    "endDate",
    "careCenter",
    "birthday",
    "dueDate",
    "birthDate",
    "serviceStatus",
    "areaId",
];
exports.ClientClearableFieldSchema = zod_1.z.enum(exports.CLIENT_CLEARABLE_FIELD_NAMES);
/** Canonical marker representation used in state and persisted task drafts. */
exports.ClientClearedFieldsSchema = zod_1.z.array(exports.ClientClearableFieldSchema).transform((fields) => [
    ...new Set(fields),
].sort());
function strictSetVariants() {
    const clientVariants = exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("set"),
        field: zod_1.z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
    }).strict());
    return [
        ...clientVariants,
        zod_1.z.object({ op: zod_1.z.literal("set"), field: zod_1.z.literal("automationChoice"), value: exports.AutomationConsentChoiceSchema }).strict(),
        zod_1.z.object({ op: zod_1.z.literal("set"), field: zod_1.z.literal("noSend"), value: zod_1.z.boolean() }).strict(),
    ];
}
function strictTentativeVariants() {
    return exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("mark-tentative"),
        field: zod_1.z.literal(field),
        value: CLIENT_TENTATIVE_OPERATION_VALUE_SCHEMAS[field],
    }).strict());
}
function strictClearVariants() {
    const clientVariants = exports.CLIENT_CLEARABLE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("clear"),
        field: zod_1.z.literal(field),
    }).strict());
    return [
        ...clientVariants,
        zod_1.z.object({ op: zod_1.z.literal("clear"), field: zod_1.z.literal("automationChoice") }).strict(),
        zod_1.z.object({ op: zod_1.z.literal("clear"), field: zod_1.z.literal("noSend") }).strict(),
    ];
}
function strictDiscardChangeVariants() {
    return exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("discard-change"),
        field: zod_1.z.literal(field),
    }).strict());
}
const ClientInputOperationRawSchema = zod_1.z.union([
    ...strictSetVariants(),
    ...strictTentativeVariants(),
    ...strictClearVariants(),
    ...strictDiscardChangeVariants(),
]);
function normalizeParsedOperation(operation) {
    if ((operation.op === "set" || operation.op === "mark-tentative") && operation.field === "phone") {
        return { ...operation, value: normalizeClientPhone(operation.value) ?? operation.value };
    }
    return operation;
}
exports.ClientInputOperationSchema = ClientInputOperationRawSchema.transform((operation) => normalizeParsedOperation(operation));
exports.ClientInputOperationsSchema = zod_1.z.array(exports.ClientInputOperationSchema).max(100);
exports.ClientDuplicateCheckStatusSchema = zod_1.z.enum(["not_checked", "checking", "clear", "duplicate", "failed"]);
exports.ClientDuplicateCheckResultSchema = zod_1.z.object({
    status: exports.ClientDuplicateCheckStatusSchema,
    checkedPhone: zod_1.z.string().regex(/^\d{11}$/).optional(),
}).strict();
exports.ClientReadinessIssueSchema = zod_1.z.enum([
    "name_required",
    "phone_required",
    "phone_must_be_11_digits",
    "phone_duplicate_check_required",
    "phone_duplicate",
    "phone_duplicate_check_failed",
]);
exports.ClientReadinessResultSchema = zod_1.z.object({
    ready: zod_1.z.boolean(),
    issues: zod_1.z.array(exports.ClientReadinessIssueSchema),
    normalizedPhone: zod_1.z.string().regex(/^\d{11}$/).optional(),
}).strict();
/** Remove presentation punctuation only when unambiguous. */
function normalizeClientPhone(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return "";
    if (!/^[0-9\s().-]+$/.test(trimmed))
        return null;
    const digits = trimmed.replace(/[\s().-]/g, "");
    return digits || null;
}
function normalizeOperationValue(field, value) {
    if (field === "phone")
        return normalizeClientPhone(value) ?? value;
    return value;
}
function cloneConfirmed(values) {
    return values ? { ...values } : {};
}
function cloneTentative(values) {
    return values ? { ...values } : {};
}
function hasClearedConfirmedField(confirmed, clearedFields) {
    return clearedFields.some((field) => Object.prototype.hasOwnProperty.call(confirmed, field));
}
function removeClearedField(fields, field) {
    return fields.filter((candidate) => candidate !== field);
}
function addClearedField(fields, field) {
    return exports.ClientClearedFieldsSchema.parse([...fields, field]);
}
/** Apply only validated operations; tentative values never promote themselves. */
function applyClientInputOperations(operations, initial = {}) {
    const clearedFields = exports.ClientClearedFieldsSchema.parse(initial.clearedFields ?? []);
    const confirmed = cloneConfirmed(initial.confirmed);
    if (hasClearedConfirmedField(confirmed, clearedFields)) {
        throw new Error("A cleared field cannot also have a confirmed value");
    }
    const state = {
        confirmed,
        tentative: cloneTentative(initial.tentative),
        clearedFields,
        automationChoice: initial.automationChoice ?? "unanswered",
        noSend: initial.noSend ?? false,
    };
    for (const rawOperation of operations) {
        const operation = exports.ClientInputOperationSchema.parse(rawOperation);
        if (operation.op === "set") {
            if (operation.field === "automationChoice") {
                state.automationChoice = operation.value;
            }
            else if (operation.field === "noSend") {
                state.noSend = operation.value;
            }
            else {
                const field = operation.field;
                state.confirmed[field] = normalizeOperationValue(field, operation.value);
                delete state.tentative[field];
                if (exports.ClientClearableFieldSchema.safeParse(field).success) {
                    state.clearedFields = removeClearedField(state.clearedFields, field);
                }
            }
        }
        else if (operation.op === "mark-tentative") {
            state.tentative[operation.field] = normalizeOperationValue(operation.field, operation.value);
        }
        else if (operation.op === "discard-change") {
            delete state.confirmed[operation.field];
            delete state.tentative[operation.field];
            if (exports.ClientClearableFieldSchema.safeParse(operation.field).success) {
                state.clearedFields = removeClearedField(state.clearedFields, operation.field);
            }
        }
        else if (operation.field === "automationChoice") {
            state.automationChoice = "unanswered";
        }
        else if (operation.field === "noSend") {
            state.noSend = false;
        }
        else {
            const field = operation.field;
            delete state.confirmed[field];
            delete state.tentative[field];
            state.clearedFields = addClearedField(state.clearedFields, field);
        }
    }
    return state;
}
function normalizeName(value) {
    return typeof value === "string" ? value.trim() : "";
}
/** Readiness requires a matching server duplicate-check result. */
function evaluateClientReadiness(values, duplicateCheck) {
    const issues = [];
    const name = normalizeName(values?.name);
    if (!name)
        issues.push("name_required");
    const normalizedPhone = normalizeClientPhone(values?.phone);
    if (!normalizedPhone)
        issues.push("phone_required");
    else if (!/^\d{11}$/.test(normalizedPhone))
        issues.push("phone_must_be_11_digits");
    if (!duplicateCheck || duplicateCheck.status === "not_checked" || duplicateCheck.status === "checking") {
        issues.push("phone_duplicate_check_required");
    }
    else if (duplicateCheck.status === "duplicate") {
        issues.push("phone_duplicate");
    }
    else if (duplicateCheck.status === "failed") {
        issues.push("phone_duplicate_check_failed");
    }
    else if (duplicateCheck.status === "clear" && (!normalizedPhone || duplicateCheck.checkedPhone !== normalizedPhone)) {
        issues.push("phone_duplicate_check_required");
    }
    return {
        ready: issues.length === 0,
        issues,
        ...(normalizedPhone && /^\d{11}$/.test(normalizedPhone) ? { normalizedPhone } : {}),
    };
}
const isClientReadyForTask = (values, duplicateCheck) => evaluateClientReadiness(values, duplicateCheck).ready;
exports.isClientReadyForTask = isClientReadyForTask;
exports.CLIENT_CREATE_DEFAULTS = { voucherClient: false, serviceStatus: "pre_booking" };
exports.AUTOMATION_CHOICE_DEFAULT = "unanswered";
function createClientInputState() {
    return {
        confirmed: { ...exports.CLIENT_CREATE_DEFAULTS },
        tentative: {},
        clearedFields: [],
        automationChoice: exports.AUTOMATION_CHOICE_DEFAULT,
        noSend: false,
    };
}
exports.ClientWriteFieldSchema = zod_1.z.enum(exports.CLIENT_WRITE_FIELD_NAMES);
exports.ClientAutomationInputFieldSchema = zod_1.z.enum(exports.AUTOMATION_INPUT_FIELD_NAMES);
/**
 * Model task edits use a deliberately smaller vocabulary than REST edits.
 * Protected identity/PII fields can only be addressed by a server-issued
 * value reference; the model never gets a free-form literal for those keys.
 */
exports.CLIENT_MODEL_LITERAL_FIELD_NAMES = [
    "duration",
    "startDate",
    "endDate",
    "dueDate",
    "birthDate",
    "careCenter",
    "voucherClient",
    "breastPump",
    "serviceStatus",
];
exports.ClientModelLiteralFieldSchema = zod_1.z.enum(exports.CLIENT_MODEL_LITERAL_FIELD_NAMES);
const MODEL_LITERAL_VALUE_SCHEMAS = {
    duration: zod_1.z.number().int().nonnegative(),
    startDate: DateInputValue,
    endDate: DateInputValue,
    dueDate: DateInputValue,
    birthDate: DateInputValue,
    careCenter: zod_1.z.boolean(),
    voucherClient: zod_1.z.boolean(),
    breastPump: zod_1.z.boolean(),
    serviceStatus: ServiceStatusSchema,
};
/** Model references are opaque UUIDs resolved against the current task/turn. */
exports.ClientModelValueReferenceSchema = zod_1.z.object({ valueRef: zod_1.z.uuid() }).strict();
const MODEL_REFERENCE_FIELD_NAMES = exports.CLIENT_WRITE_FIELD_NAMES.filter((field) => !exports.CLIENT_MODEL_LITERAL_FIELD_NAMES.includes(field));
exports.ClientModelReferenceFieldSchema = zod_1.z.enum(MODEL_REFERENCE_FIELD_NAMES);
function modelLiteralVariants(operation) {
    return exports.CLIENT_MODEL_LITERAL_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal(operation),
        field: zod_1.z.literal(field),
        value: MODEL_LITERAL_VALUE_SCHEMAS[field],
    }).strict());
}
function modelReferenceVariants(operation) {
    return MODEL_REFERENCE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal(operation),
        field: zod_1.z.literal(field),
        valueRef: zod_1.z.uuid(),
    }).strict());
}
const modelClearVariants = exports.CLIENT_CLEARABLE_FIELD_NAMES.map((field) => zod_1.z.object({
    op: zod_1.z.literal("clear"),
    field: zod_1.z.literal(field),
}).strict());
const modelDiscardVariants = exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
    op: zod_1.z.literal("discard-change"),
    field: zod_1.z.literal(field),
}).strict());
/** Independent finite schema used for model-facing task tools. */
exports.ClientModelTaskOperationSchema = zod_1.z.union([
    ...modelLiteralVariants("set"),
    ...modelReferenceVariants("set"),
    ...modelLiteralVariants("mark-tentative"),
    ...modelReferenceVariants("mark-tentative"),
    ...modelClearVariants,
    ...modelDiscardVariants,
]);
exports.ClientModelTaskOperationsSchema = zod_1.z.array(exports.ClientModelTaskOperationSchema).max(100);
/** Explicit aliases for callers that use the input-policy naming. */
exports.ClientModelInputOperationSchema = exports.ClientModelTaskOperationSchema;
exports.ClientModelInputOperationsSchema = exports.ClientModelTaskOperationsSchema;
