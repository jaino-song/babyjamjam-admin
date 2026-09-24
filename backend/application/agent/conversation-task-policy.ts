import { createHash } from "node:crypto";
import { z } from "zod";

import {
    AgentTaskDisplayedChoiceHintSchema,
    AgentTaskIdSchema,
    AgentTaskRevisionSchema,
    AgentTaskSourceSchema,
    ClientInputOperationSchema,
    ClientModelTaskOperationsSchema,
    type AgentTaskDisplayedChoiceHint,
    type ClientInputOperation,
    type ClientModelTaskOperation,
} from "@babyjamjam/shared";
import { redactExplicitLabeledText, redactFreeText, redactKnownValues } from "./agent-model-redaction";

/**
 * A mutation origin is supplied by a trusted server call site.  It is never
 * accepted from the REST body or from model arguments.  Keeping this type in
 * the conversation layer makes it difficult to accidentally treat a model
 * literal as an accepted user correction.
 */
export const ConversationMutationOriginSchema = AgentTaskSourceSchema;
export type ConversationMutationOrigin = z.infer<typeof AgentTaskSourceSchema>;

export const CONVERSATION_INTAKE_PROTOCOL = "conversation-intake-v1" as const;
export const CONVERSATION_CHOICE_PROTOCOL = "conversation-choice-v1" as const;

export const ConversationCanonicalMessageSchema = z.object({
    protocol: z.literal(CONVERSATION_INTAKE_PROTOCOL),
    userId: z.string().min(1).max(200),
    branchId: z.string().min(1).max(200),
    sessionId: AgentTaskIdSchema,
    messageId: z.string().trim().min(1).max(200),
    role: z.literal("user"),
    textDigest: z.string().regex(/^[a-f0-9]{64}$/),
    formDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    displayedChoice: AgentTaskDisplayedChoiceHintSchema.optional(),
}).strict();
export type ConversationCanonicalMessage = z.infer<typeof ConversationCanonicalMessageSchema>;

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }
    return value;
}

export function digestConversationValue(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/** Build the event hash without raw text or protected form values. */
export function canonicalConversationMessage(input: {
    userId: string;
    branchId: string;
    sessionId: string;
    messageId: string;
    text: string;
    form?: unknown;
    displayedChoice?: unknown;
}): ConversationCanonicalMessage {
    const hint = input.displayedChoice === undefined
        ? undefined
        : AgentTaskDisplayedChoiceHintSchema.parse(input.displayedChoice);
    return ConversationCanonicalMessageSchema.parse({
        protocol: CONVERSATION_INTAKE_PROTOCOL,
        userId: input.userId,
        branchId: input.branchId,
        sessionId: AgentTaskIdSchema.parse(input.sessionId),
        messageId: input.messageId,
        role: "user",
        textDigest: digestConversationValue(input.text),
        ...(input.form === undefined ? {} : { formDigest: digestConversationValue(input.form) }),
        ...(hint ? { displayedChoice: hint } : {}),
    });
}

export function conversationMessageHash(input: Parameters<typeof canonicalConversationMessage>[0]): string {
    return digestConversationValue(canonicalConversationMessage(input));
}

/**
 * Derive a UUID-shaped event id from a caller message id.  The database event
 * table intentionally remains UUID-compatible while retries continue to use
 * the stable caller id as their semantic input.
 */
export function conversationMessageEventId(input: {
    userId: string;
    branchId: string;
    sessionId: string;
    messageId: string;
}): string {
    const digest = createHash("sha256")
        .update(`${CONVERSATION_INTAKE_PROTOCOL}:${input.userId}:${input.branchId}:${input.sessionId}:${input.messageId}`)
        .digest("hex")
        .slice(0, 32);
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${digest.slice(18, 20)}-${digest.slice(20)}`;
}

export function isExplicitUserOrigin(origin: ConversationMutationOrigin): boolean {
    return origin === "user" || origin === "wizard";
}

export function modelOperations(raw: unknown): ClientModelTaskOperation[] {
    return ClientModelTaskOperationsSchema.parse(raw);
}

/** Model tools may only produce finite operations. REST validation is separate. */
export function assertModelOperations(raw: unknown): ClientModelTaskOperation[] {
    return modelOperations(raw);
}

/**
 * Remove values from explicitly labelled free-text fields before a message can
 * enter a model prompt or a persisted transcript.  This is deliberately a
 * narrow capture rule: arbitrary Korean prose is not treated as a name/address
 * parser and remains subject to the ordinary regex masking only.
 */
function safeTaskSnapshotPart(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    const keep = ["taskId", "snapshotRef", "kind", "capabilityId", "revision", "state", "fieldStatus"] as const;
    if (keep.some((key) => value[key] === undefined)) return null;
    const fieldStatus = Array.isArray(value["fieldStatus"])
        ? value["fieldStatus"].flatMap((entry): Record<string, unknown>[] => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const item = entry as Record<string, unknown>;
            if (typeof item["field"] !== "string" || typeof item["status"] !== "string") return [];
            const status = item["status"];
            if (!new Set(["missing", "confirmed", "tentative", "confirmed-and-tentative"]).has(status)) return [];
            const valueRef = item["valueRef"];
            return [{
                field: item["field"],
                status,
                ...(typeof valueRef === "string" && AgentTaskIdSchema.safeParse(valueRef).success ? { valueRef } : {}),
            }];
        })
        : [];
    return {
        taskId: value["taskId"],
        snapshotRef: value["snapshotRef"],
        kind: value["kind"],
        capabilityId: value["capabilityId"],
        revision: value["revision"],
        state: value["state"],
        fieldStatus,
    };
}

function safeEntitySelectPart(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    const taskId = value["taskId"];
    const choiceSetRef = value["choiceSetRef"];
    const optionIds = value["optionIds"];
    if (typeof taskId !== "string" || typeof choiceSetRef !== "string" || !Array.isArray(optionIds)) return null;
    return {
        taskId,
        choiceSetRef,
        optionIds: optionIds.filter((optionId): optionId is string => typeof optionId === "string"),
    };
}

function safeTaskPatchPart(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    const taskId = value["taskId"];
    const eventId = value["eventId"];
    const acceptedRevision = value["acceptedRevision"];
    const currentSnapshotRef = value["currentSnapshotRef"];
    if (typeof taskId !== "string" || typeof eventId !== "string"
        || !Number.isSafeInteger(acceptedRevision) || typeof currentSnapshotRef !== "string") return null;
    return { taskId, eventId, acceptedRevision, currentSnapshotRef };
}

function safeFormPart(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    if (typeof value["formId"] !== "string") return null;
    // Form labels are presentation metadata, but field values and free-form
    // placeholders are not needed in transcript/model context. Keep only the
    // form identity and bounded field names/types for recovery continuity.
    const fields = Array.isArray(value["fields"])
        ? value["fields"].flatMap((field): Record<string, unknown>[] => {
            if (!field || typeof field !== "object" || Array.isArray(field)) return [];
            const item = field as Record<string, unknown>;
            if (typeof item["name"] !== "string" || typeof item["type"] !== "string") return [];
            return [{ name: item["name"], type: item["type"], ...(typeof item["required"] === "boolean" ? { required: item["required"] } : {}) }];
        }).slice(0, 100)
        : undefined;
    return {
        formId: value["formId"],
        ...(typeof value["schemaVersion"] === "string" ? { schemaVersion: value["schemaVersion"] } : {}),
        ...(fields && fields.length > 0 ? { fields } : {}),
    };
}

/** Keep only structural data parts that are safe to replay into context. */
function sanitizeStructuredPart(type: string, data: unknown): Record<string, unknown> | null {
    if (type === "data-form-submit") {
        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        const formId = (data as Record<string, unknown>)["formId"];
        return typeof formId === "string" ? { type, data: { formId } } : null;
    }
    if (type === "data-task-snapshot") {
        const safe = safeTaskSnapshotPart(data);
        return safe ? { type, data: safe } : null;
    }
    if (type === "data-entity-select") {
        const safe = safeEntitySelectPart(data);
        return safe ? { type, data: safe } : null;
    }
    if (type === "data-task-patch") {
        const safe = safeTaskPatchPart(data);
        return safe ? { type, data: safe } : null;
    }
    if (type === "data-form") {
        const safe = safeFormPart(data);
        return safe ? { type, data: safe } : null;
    }
    // Entity-choice, action proposal/result, attachment and arbitrary custom
    // data parts can contain labels, IDs or protected payloads. They remain in
    // the live UI stream where their owner can render them, but never enter a
    // task-linked transcript/model message.
    return null;
}

/**
 * Strip protected form values before persistence or model conversion.  The
 * form id is retained as a structural cue; its values are task-owned data and
 * must not enter transcript JSON.
 */
export function sanitizeConversationMessage(message: {
    id: string;
    role: "user" | "assistant" | "system";
    parts: readonly unknown[];
    displayedChoice?: AgentTaskDisplayedChoiceHint;
    protectedValues?: readonly unknown[];
}): {
    id: string;
    role: "user" | "assistant" | "system";
    parts: unknown[];
    displayedChoice?: AgentTaskDisplayedChoiceHint;
} {
    const parsedDisplayedChoice = message.displayedChoice === undefined
        ? undefined
        : AgentTaskDisplayedChoiceHintSchema.safeParse(message.displayedChoice);
    const parts: unknown[] = message.parts.flatMap((part): unknown[] => {
        if (!part || typeof part !== "object") return [];
        const value = part as Record<string, unknown>;
        if (value["type"] === "data-form-submit") {
            const data = value["data"];
            if (data && typeof data === "object" && typeof (data as Record<string, unknown>)["formId"] === "string") {
                return [{ type: "data-form-submit", data: { formId: (data as Record<string, unknown>)["formId"] } }];
            }
            return [];
        }
        if (typeof value["type"] === "string" && value["type"].startsWith("data-") && "data" in value) {
            const safe = sanitizeStructuredPart(value["type"], value["data"]);
            return safe ? [safe] : [];
        }
        if (value["type"] === "text" && typeof value["text"] === "string") {
            return [{
                type: "text",
                text: redactKnownValues(redactFreeText(redactExplicitLabeledText(value["text"])), message.protectedValues),
            }];
        }
        return [];
    });
    return {
        id: message.id,
        role: message.role,
        parts,
        ...(parsedDisplayedChoice?.success ? { displayedChoice: parsedDisplayedChoice.data } : {}),
    };
}

/** Extract user text without interpreting arbitrary structured payloads. */
export function conversationText(message: { parts: readonly unknown[] }): string {
    return message.parts
        .filter((part): part is { type: "text"; text: string } => {
            if (!part || typeof part !== "object") return false;
            const value = part as Record<string, unknown>;
            return value["type"] === "text" && typeof value["text"] === "string";
        })
        .map((part) => part.text)
        .join(" ")
        .trim();
}

/** Explicitly labelled facts only; this is intentionally not Korean NER. */
export function extractExplicitUserOperations(text: string): ClientInputOperation[] {
    const operations: ClientInputOperation[] = [];
    const labelled = [
        { field: "name" as const, pattern: /(?:이름|성명)\s*[:：]\s*([^,，\n]{1,120})/u },
        { field: "address" as const, pattern: /주소\s*[:：]\s*([^,，\n]{1,300})/u },
        { field: "phone" as const, pattern: /(?:전화번호|휴대폰|연락처)\s*[:：]\s*([+()\d\s.-]{7,40})/u },
        { field: "type" as const, pattern: /서비스\s*유형\s*[:：]\s*([^,，\n]{1,40})/u },
    ];
    for (const candidate of labelled) {
        const match = candidate.pattern.exec(text);
        if (!match?.[1]) continue;
        const value = match[1].trim();
        const parsed = ClientInputOperationSchema.safeParse({ op: "set", field: candidate.field, value });
        if (parsed.success) operations.push(parsed.data as ClientInputOperation);
    }

    // Exact ISO dates are safe literals.  Approximate Korean date wishes stay
    // tentative, but are still captured only when the field is labelled.
    const dateFields = [
        { field: "startDate" as const, labels: "startDate|시작일|이용\\s*시작일" },
        { field: "endDate" as const, labels: "endDate|종료일|이용\\s*종료일" },
        { field: "dueDate" as const, labels: "dueDate|출산\\s*예정일|예정일" },
        { field: "birthDate" as const, labels: "birthDate|출생일" },
    ] as const;
    for (const { field, labels } of dateFields) {
        const exact = new RegExp(`(?:${labels})\\s*[:：]\\s*(\\d{4}-\\d{2}-\\d{2}(?:T[^\\s,，]+)?)`, "u").exec(text);
        if (exact?.[1]) {
            const parsed = ClientInputOperationSchema.safeParse({ op: "set", field, value: exact[1] });
            if (parsed.success) operations.push(parsed.data as ClientInputOperation);
            continue;
        }
        const approximate = new RegExp(`(?:${labels})\\s*[:：]\\s*([^,，\\n]{1,100})`, "u").exec(text);
        if (approximate?.[1] && /(?:월|주|초|말|쯤|경)/u.test(approximate[1])) {
            const parsed = ClientInputOperationSchema.safeParse({ op: "mark-tentative", field, value: approximate[1].trim() });
            if (parsed.success) operations.push(parsed.data as ClientInputOperation);
        }
    }

    const deletion = /(?:주소|서비스\s*유형|이용\s*기간|종료일|시작일|출산\s*예정일|생년월일)\s*(?:을|를)?\s*(?:삭제|지워|비워|없애)/u;
    const deletionMatch = deletion.exec(text);
    if (deletionMatch) {
        const field = deletionMatch[0].includes("주소") ? "address"
            : deletionMatch[0].includes("유형") ? "type"
                : deletionMatch[0].includes("기간") ? "duration"
                    : deletionMatch[0].includes("종료") ? "endDate"
                        : deletionMatch[0].includes("시작") ? "startDate"
                            : deletionMatch[0].includes("예정") ? "dueDate" : "birthday";
        const parsed = ClientInputOperationSchema.safeParse({ op: "clear", field });
        if (parsed.success) operations.push(parsed.data as ClientInputOperation);
    }

    if (/(?:문자|알림|메시지).*(?:보내지\s*마|전송하지\s*마|발송하지\s*마)/u.test(text)) {
        operations.push({ op: "set", field: "noSend", value: true });
    }
    return operations;
}

/**
 * A trailing imperative mutation verb ("바꿔줘", "수정해 주세요", ...) makes the whole text a
 * write request even when an earlier clause contains a question-like keyword (e.g. "확인하고
 * ... 바꿔줘"). Matched only at the end of the (trimmed) text.
 */
const IMPERATIVE_CHANGE_REQUEST = new RegExp(
    "(?:바꿔|바꾸어|변경해|수정해|고쳐|등록해|추가해|만들어|생성해|설정해|지정해|해제해|삭제해|지워|넣어|입력해|저장해|전환해|돌려)"
    + "\\s*(?:줘|주세요|줄래|주라|주십시오)?\\s*[.!！。]*\\s*$",
    "u",
);
const IMPERATIVE_CHANGE_REQUEST_NARROW = /(?:하게|으로|로)\s*해\s*(?:줘|주세요)\s*[.!！。]*\s*$/u;

export function isQuestionLike(text: string): boolean {
    const normalized = text.trim();
    if (normalized.endsWith("?") || normalized.endsWith("？")) return true;
    if (IMPERATIVE_CHANGE_REQUEST.test(normalized) || IMPERATIVE_CHANGE_REQUEST_NARROW.test(normalized)) return false;
    return /(?:알려|조회|확인|가능|어떻게|무엇|언제|어디|왜|찾아|보여|정리해|답해)/u.test(normalized);
}

/** A topic-labelled answer is grounded in the original text, never in model output. */
export function explicitAutomationAnswer(text: string): ClientInputOperation[] {
    const match = /^\s*자동\s*문자(?:\s*적용)?\s*[:：]\s*(예|네|아니요|아니오)\s*[.!]?\s*$/u.exec(text);
    if (!match) return [];
    return [{ op: "set", field: "automationChoice", value: match[1] === "예" || match[1] === "네" ? "yes" : "no" }];
}

export function displayedChoiceMatches(
    hint: unknown,
    expected: { taskId: string; choiceSetRef: string; revision: number },
): boolean {
    const parsed = AgentTaskDisplayedChoiceHintSchema.safeParse(hint);
    return parsed.success
        && parsed.data.taskId === expected.taskId
        && parsed.data.choiceSetRef === expected.choiceSetRef
        && parsed.data.revision === expected.revision;
}

export function canonicalChoiceDigest(input: {
    taskId: string;
    expectedRevision: number;
    producer: "client-target" | "phone-candidate";
    results: readonly Record<string, unknown>[];
}): string {
    return digestConversationValue({
        protocol: CONVERSATION_CHOICE_PROTOCOL,
        taskId: AgentTaskIdSchema.parse(input.taskId),
        expectedRevision: AgentTaskRevisionSchema.parse(input.expectedRevision),
        producer: input.producer,
        results: input.results,
    });
}
