import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { SERVICE_RECORD_LAYOUT_ANSWER_KEYS, validateServiceRecordAnswers } from "application/policies/service-record-answer-validation.policy";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";

const positiveInt = z.number().int().min(1);
const dateOnly = z.iso.date().refine((value) => !value.startsWith("0000-"));
// PostgreSQL JSONB and text cannot store these characters.
const storableText = z.string().refine((value) => !/[\u0000\p{Surrogate}]/u.test(value));
const answers = z.custom<Record<string, unknown>>((value) => (
    typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key))
));
const sessionChanges = z.strictObject({
    answers: answers.optional(),
    etcService: storableText.max(SERVICE_RECORD_TEXT_LIMITS.etcService).optional(),
    notes: storableText.max(SERVICE_RECORD_TEXT_LIMITS.notes).optional(),
}).refine((changes) => Object.keys(changes).length > 0);
const sessionTarget = {
    sessionIndex: positiveInt.max(32767),
    serviceDate: dateOnly,
    changes: sessionChanges,
};
const requestSchema = z.strictObject({
    idempotencyKey: z.uuidv4().toLowerCase(),
    expectedCaseVersion: z.number().int().min(0).max(2147483647),
    expectedSourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/i).toLowerCase(),
    operations: z.array(z.discriminatedUnion("op", [
        z.strictObject({ op: z.literal("edit"), ...sessionTarget }),
        z.strictObject({ op: z.literal("fill"), ...sessionTarget }),
    ])).min(1).max(100),
});
const targetSchema = z.strictObject({
    clientId: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(positiveInt.max(2147483647)),
    caseId: z.uuid().toLowerCase(),
});

export type OwnerRecordJsonRequest = z.infer<typeof requestSchema>;
export type OwnerRecordJsonTarget = z.infer<typeof targetSchema>;

export function parseOwnerRecordJsonTarget(value: unknown): OwnerRecordJsonTarget {
    const result = targetSchema.safeParse(value);
    if (!result.success) throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
    return result.data;
}

export function parseOwnerRecordJsonRequest(value: unknown): OwnerRecordJsonRequest {
    const result = requestSchema.safeParse(value);
    if (!result.success) throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));

    const indexes = new Set<number>();
    const dates = new Set<string>();
    const body = result.data;
    for (const { sessionIndex, serviceDate, changes } of body.operations) {
        if (indexes.has(sessionIndex) || dates.has(serviceDate)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/operations",
                code: "INVALID_VALUE",
                detail: "Each session index and date may appear only once.",
                location: "body",
            }));
        }
        indexes.add(sessionIndex);
        dates.add(serviceDate);
        if (changes.answers !== undefined) {
            try {
                const validated = validateServiceRecordAnswers(changes.answers);
                for (const answer of Object.values(validated).flat()) {
                    if (typeof answer === "string" && !storableText.safeParse(answer).success) {
                        throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
                    }
                }
                changes.answers = validated;
            } catch (error) {
                if (error instanceof BadRequestException) {
                    throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
                }
                throw error;
            }
        }
    }
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 64 * 1024) {
        throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
    }
    return body;
}
