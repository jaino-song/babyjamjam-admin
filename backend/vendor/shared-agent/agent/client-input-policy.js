"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTaskPhone = exports.ClientAutomationInputFieldSchema = exports.ClientClearableFieldSchema = exports.ClientWriteFieldSchema = exports.AUTOMATION_CHOICE_DEFAULT = exports.CLIENT_CREATE_DEFAULTS = exports.isReadyForTask = exports.isClientReadyForTask = exports.getTaskReadiness = exports.validateClientReadiness = exports.getClientReadiness = exports.ClientInputPatchOperationSchema = exports.AgentTaskInputOperationSchema = exports.ClientTaskInputOperationSchema = exports.applyClientInputPatch = exports.normalizeClientPhoneInput = exports.ClientReadinessResultSchema = exports.ClientReadinessIssueSchema = exports.ClientDuplicateCheckResultSchema = exports.ClientDuplicateCheckStatusSchema = exports.ClientInputOperationsSchema = exports.ClientInputOperationSchema = exports.AUTOMATION_INPUT_FIELD_NAMES = exports.AutomationConsentChoiceSchema = exports.AUTOMATION_CONSENT_CHOICES = exports.ClientWriteFieldsSchema = exports.CLIENT_WRITE_FIELD_NAMES = void 0;
exports.normalizeClientPhone = normalizeClientPhone;
exports.applyClientInputOperations = applyClientInputOperations;
exports.evaluateClientReadiness = evaluateClientReadiness;
exports.createClientInputState = createClientInputState;
const zod_1 = require("zod");
/**
 * Fields that the existing client write provider accepts.  Keep this list
 * deliberately closed: conversational input is allowed to edit only these
 * business fields plus the two explicit automation controls below.
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
const DATE_VALUE_SCHEMA = zod_1.z.string().trim().min(1).max(100);
const NON_EMPTY_STRING_SCHEMA = zod_1.z.string().trim().min(1);
/**
 * This mirrors the existing provider's write surface without importing
 * backend code into the shared package.  Nullable values are represented in
 * the full value snapshot, while conversational `set` operations intentionally
 * require a non-null value; `clear` is the only deletion operation.
 */
exports.ClientWriteFieldsSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    address: zod_1.z.string().trim().max(300).nullable().optional(),
    phone: zod_1.z.string().trim().max(40).nullable().optional(),
    type: zod_1.z.string().trim().max(40).nullable().optional(),
    duration: zod_1.z.number().int().nonnegative().nullable().optional(),
    fullPrice: zod_1.z.string().trim().max(40).nullable().optional(),
    grant: zod_1.z.string().trim().max(80).nullable().optional(),
    actualPrice: zod_1.z.string().trim().max(40).nullable().optional(),
    startDate: DATE_VALUE_SCHEMA.nullable().optional(),
    endDate: DATE_VALUE_SCHEMA.nullable().optional(),
    careCenter: zod_1.z.boolean().nullable().optional(),
    voucherClient: zod_1.z.boolean().optional(),
    birthday: zod_1.z.string().regex(/^\d{6}$/).nullable().optional(),
    dueDate: DATE_VALUE_SCHEMA.nullable().optional(),
    birthDate: DATE_VALUE_SCHEMA.nullable().optional(),
    serviceStatus: zod_1.z.enum([
        "pre_booking",
        "waiting",
        "replacement_requested",
        "active",
        "completed",
        "terminated",
    ]).nullable().optional(),
    breastPump: zod_1.z.boolean().optional(),
    areaId: zod_1.z.string().max(100).nullable().optional(),
}).strict();
const CLIENT_OPERATION_VALUE_SCHEMAS = {
    name: zod_1.z.string().trim().min(1).max(120),
    address: zod_1.z.string().trim().max(300),
    phone: zod_1.z.string().trim().min(1).max(40),
    type: zod_1.z.string().trim().max(40),
    duration: zod_1.z.number().int().nonnegative(),
    fullPrice: zod_1.z.string().trim().max(40),
    grant: zod_1.z.string().trim().max(80),
    actualPrice: zod_1.z.string().trim().max(40),
    startDate: DATE_VALUE_SCHEMA,
    endDate: DATE_VALUE_SCHEMA,
    careCenter: zod_1.z.boolean(),
    voucherClient: zod_1.z.boolean(),
    birthday: zod_1.z.string().regex(/^\d{6}$/),
    dueDate: DATE_VALUE_SCHEMA,
    birthDate: DATE_VALUE_SCHEMA,
    serviceStatus: zod_1.z.enum([
        "pre_booking",
        "waiting",
        "replacement_requested",
        "active",
        "completed",
        "terminated",
    ]),
    breastPump: zod_1.z.boolean(),
    areaId: zod_1.z.string().max(100),
};
exports.AUTOMATION_CONSENT_CHOICES = ["unanswered", "yes", "no"];
exports.AutomationConsentChoiceSchema = zod_1.z.enum(exports.AUTOMATION_CONSENT_CHOICES);
exports.AUTOMATION_INPUT_FIELD_NAMES = ["automationChoice", "noSend"];
const CLIENT_CLEARABLE_FIELD_NAMES = exports.CLIENT_WRITE_FIELD_NAMES.filter((field) => field !== "name" && field !== "phone");
function strictSetVariants() {
    const clientVariants = exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("set"),
        field: zod_1.z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
    }).strict());
    return [
        ...clientVariants,
        zod_1.z.object({
            op: zod_1.z.literal("set"),
            field: zod_1.z.literal("automationChoice"),
            value: exports.AutomationConsentChoiceSchema,
        }).strict(),
        zod_1.z.object({
            op: zod_1.z.literal("set"),
            field: zod_1.z.literal("noSend"),
            value: zod_1.z.boolean(),
        }).strict(),
    ];
}
function strictTentativeVariants() {
    return exports.CLIENT_WRITE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("mark-tentative"),
        field: zod_1.z.literal(field),
        value: CLIENT_OPERATION_VALUE_SCHEMAS[field],
    }).strict());
}
function strictClearVariants() {
    const clientVariants = CLIENT_CLEARABLE_FIELD_NAMES.map((field) => zod_1.z.object({
        op: zod_1.z.literal("clear"),
        field: zod_1.z.literal(field),
    }).strict());
    return [
        ...clientVariants,
        zod_1.z.object({ op: zod_1.z.literal("clear"), field: zod_1.z.literal("automationChoice") }).strict(),
        zod_1.z.object({ op: zod_1.z.literal("clear"), field: zod_1.z.literal("noSend") }).strict(),
    ];
}
exports.ClientInputOperationSchema = zod_1.z.union([
    ...strictSetVariants(),
    ...strictTentativeVariants(),
    ...strictClearVariants(),
]);
exports.ClientInputOperationsSchema = zod_1.z.array(exports.ClientInputOperationSchema).max(100);
exports.ClientDuplicateCheckStatusSchema = zod_1.z.enum([
    "not_checked",
    "checking",
    "clear",
    "duplicate",
    "failed",
]);
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
const EMPTY_CLIENT_INPUT_STATE = {
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
exports.normalizeClientPhoneInput = normalizeClientPhone;
function normalizeOperationValue(field, value) {
    if (field === "phone") {
        const normalized = normalizeClientPhone(value);
        return normalized ?? value;
    }
    return value;
}
function cloneClientFields(values) {
    return values ? { ...values } : {};
}
/**
 * Apply only validated operations.  `mark-tentative` never writes to
 * `confirmed`, and omission is naturally a no-op because operations are the
 * only input accepted by this helper.
 */
function applyClientInputOperations(operations, initial = {}) {
    const state = {
        confirmed: cloneClientFields(initial.confirmed),
        tentative: cloneClientFields(initial.tentative),
        automationChoice: initial.automationChoice ?? EMPTY_CLIENT_INPUT_STATE.automationChoice,
        noSend: initial.noSend ?? EMPTY_CLIENT_INPUT_STATE.noSend,
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
            }
        }
        else if (operation.op === "mark-tentative") {
            state.tentative[operation.field] = normalizeOperationValue(operation.field, operation.value);
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
        }
    }
    return state;
}
exports.applyClientInputPatch = applyClientInputOperations;
exports.ClientTaskInputOperationSchema = exports.ClientInputOperationSchema;
exports.AgentTaskInputOperationSchema = exports.ClientInputOperationSchema;
exports.ClientInputPatchOperationSchema = exports.ClientInputOperationSchema;
function normalizeName(value) {
    return typeof value === "string" ? value.trim() : "";
}
/**
 * Readiness deliberately requires a server result.  The helper never treats a
 * syntactically valid phone as duplicate-free and never manufactures a check.
 */
function evaluateClientReadiness(values, duplicateCheck) {
    const issues = [];
    const name = normalizeName(values?.name);
    if (!name)
        issues.push("name_required");
    const normalizedPhone = normalizeClientPhone(values?.phone);
    if (!normalizedPhone) {
        issues.push("phone_required");
    }
    else if (!/^\d{11}$/.test(normalizedPhone)) {
        issues.push("phone_must_be_11_digits");
    }
    if (!duplicateCheck || duplicateCheck.status === "not_checked" || duplicateCheck.status === "checking") {
        issues.push("phone_duplicate_check_required");
    }
    else if (duplicateCheck.status === "duplicate") {
        issues.push("phone_duplicate");
    }
    else if (duplicateCheck.status === "failed") {
        issues.push("phone_duplicate_check_failed");
    }
    else if (duplicateCheck.status === "clear") {
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
exports.getClientReadiness = evaluateClientReadiness;
exports.validateClientReadiness = evaluateClientReadiness;
exports.getTaskReadiness = evaluateClientReadiness;
const isClientReadyForTask = (values, duplicateCheck) => evaluateClientReadiness(values, duplicateCheck).ready;
exports.isClientReadyForTask = isClientReadyForTask;
exports.isReadyForTask = exports.isClientReadyForTask;
exports.CLIENT_CREATE_DEFAULTS = {
    voucherClient: false,
    serviceStatus: "pre_booking",
};
exports.AUTOMATION_CHOICE_DEFAULT = "unanswered";
function createClientInputState() {
    return {
        confirmed: { ...exports.CLIENT_CREATE_DEFAULTS },
        tentative: {},
        automationChoice: exports.AUTOMATION_CHOICE_DEFAULT,
        noSend: false,
    };
}
exports.ClientWriteFieldSchema = zod_1.z.enum(exports.CLIENT_WRITE_FIELD_NAMES);
exports.ClientClearableFieldSchema = zod_1.z.enum(CLIENT_CLEARABLE_FIELD_NAMES);
exports.ClientAutomationInputFieldSchema = zod_1.z.enum(exports.AUTOMATION_INPUT_FIELD_NAMES);
exports.normalizeTaskPhone = normalizeClientPhone;
