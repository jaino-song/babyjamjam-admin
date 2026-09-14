import {
    BadRequestException,
    HttpException,
    ValidationError,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
    IsArray,
    IsDefined,
    IsEmail,
    IsInt,
    IsNotEmpty,
    IsString,
    IsUUID,
    Length,
    Max,
    Min,
    ValidateNested,
} from "class-validator";

import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { GlobalValidationPipe } from "./global-validation.pipe";

class RequiredDto {
    @IsDefined()
    @IsNotEmpty()
    title!: string;

    @IsDefined()
    @IsNotEmpty()
    email!: string;
}

class FormatAndRangeDto {
    @IsEmail()
    email!: string;

    @IsString()
    @Length(3, 5)
    code!: string;

    @IsInt()
    @Min(1)
    @Max(10)
    count!: number;
}

class NestedItemDto {
    @IsString()
    "path/with~escape"!: string;
}

class NestedArrayDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => NestedItemDto)
    items!: NestedItemDto[];
}

class KnownFieldDto {
    @IsString()
    name!: string;
}

class UnknownConstraintDto {
    @IsUUID()
    id!: string;
}

class ConvertibleDto {
    @IsInt()
    count!: number;
}

class UntransformedDto {
    @IsString()
    name!: string;
}

function createStrictPipe(): GlobalValidationPipe {
    return new GlobalValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    });
}

async function captureHttpException(promise: Promise<unknown>): Promise<HttpException> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof HttpException) {
            return error;
        }
        throw error;
    }

    throw new Error("Expected validation to reject");
}

function getResponse(exception: HttpException): Record<string, unknown> {
    const response = exception.getResponse();
    if (typeof response !== "object" || response === null) {
        throw new Error("Expected a structured HTTP exception response");
    }
    return response as Record<string, unknown>;
}

function getErrors(response: Record<string, unknown>): Array<Record<string, unknown>> {
    const errors = response["errors"];
    if (!Array.isArray(errors)) {
        throw new Error("Expected structured validation errors");
    }
    return errors as Array<Record<string, unknown>>;
}

describe("GlobalValidationPipe", () => {
    it("preserves every constraint for two missing fields in the structured response", async () => {
        const exception = await captureHttpException(
            createStrictPipe().transform({}, { type: "body", metatype: RequiredDto }),
        );

        expect(exception).toBeInstanceOf(BadRequestException);
        expect(exception.getStatus()).toBe(400);

        const response = getResponse(exception);
        const errors = getErrors(response);

        expect(response["code"]).toBe("VALIDATION_FAILED");
        expect(response["outcome"]).toBe("NOT_APPLIED");
        expect(errors).toEqual(expect.arrayContaining([
            {
                pointer: "/title",
                code: "REQUIRED",
                detail: "필수 항목이에요.",
                location: "body",
            },
            {
                pointer: "/title",
                code: "REQUIRED",
                detail: "필수 항목이에요.",
                location: "body",
            },
            {
                pointer: "/email",
                code: "REQUIRED",
                detail: "필수 항목이에요.",
                location: "body",
            },
            {
                pointer: "/email",
                code: "REQUIRED",
                detail: "필수 항목이에요.",
                location: "body",
            },
        ]));
        expect(errors).toHaveLength(4);
        expect(response["message"]).toEqual(errors.map((error) => error["detail"]));
    });

    it("maps range and format constraints from their keys without using messages", async () => {
        const exception = await captureHttpException(
            createStrictPipe().transform({
                email: "not-an-email",
                code: "x",
                count: 0,
            }, { type: "body", metatype: FormatAndRangeDto }),
        );

        const errors = getErrors(getResponse(exception));

        expect(errors).toEqual(expect.arrayContaining([
            {
                pointer: "/email",
                code: "INVALID_FORMAT",
                detail: "입력 형식이 올바르지 않아요.",
                location: "body",
            },
            {
                pointer: "/code",
                code: "OUT_OF_RANGE",
                detail: "허용 범위를 벗어난 값이에요.",
                location: "body",
            },
            {
                pointer: "/count",
                code: "OUT_OF_RANGE",
                detail: "허용 범위를 벗어난 값이에요.",
                location: "body",
            },
        ]));
    });

    it("escapes nested array and object property segments as RFC 6901 pointers", async () => {
        const exception = await captureHttpException(
            createStrictPipe().transform({
                items: [{ "path/with~escape": 123 }],
            }, { type: "body", metatype: NestedArrayDto }),
        );

        const errors = getErrors(getResponse(exception));
        expect(errors).toContainEqual({
            pointer: "/items/0/path~1with~0escape",
            code: "INVALID_FORMAT",
            detail: "입력 형식이 올바르지 않아요.",
            location: "body",
        });
    });

    it("keeps body and query locations isolated for concurrent transforms", async () => {
        const pipe = createStrictPipe();
        const [bodyException, queryException] = await Promise.all([
            captureHttpException(
                pipe.transform({ name: 123 }, { type: "body", metatype: KnownFieldDto }),
            ),
            captureHttpException(
                pipe.transform({ name: 456 }, { type: "query", metatype: KnownFieldDto }),
            ),
        ]);

        expect(getErrors(getResponse(bodyException))).toEqual(expect.arrayContaining([
            expect.objectContaining({ pointer: "/name", location: "body" }),
        ]));
        expect(getErrors(getResponse(queryException))).toEqual(expect.arrayContaining([
            expect.objectContaining({ pointer: "/name", location: "query" }),
        ]));
    });

    it("redacts values, targets, constraint text, and unknown labels from public fields", async () => {
        const unknownField = "unsafe/field~name";
        const secret = "do-not-return-this";
        const exception = await captureHttpException(
            createStrictPipe().transform({
                name: "ok",
                [unknownField]: secret,
            }, { type: "body", metatype: KnownFieldDto }),
        );

        const response = getResponse(exception);
        const serialized = JSON.stringify(response);
        const errors = getErrors(response);

        expect(errors).toContainEqual({
            pointer: "/unsafe~1field~0name",
            code: "UNEXPECTED_FIELD",
            detail: "허용되지 않는 항목이에요.",
            location: "body",
        });
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain("should not exist");
        expect(serialized).not.toContain("whitelistValidation");
    });

    it("falls back to INVALID_VALUE for unlisted constraint keys", async () => {
        const exception = await captureHttpException(
            createStrictPipe().transform({ id: "not-a-uuid" }, {
                type: "body",
                metatype: UnknownConstraintDto,
            }),
        );

        expect(getErrors(getResponse(exception))).toContainEqual({
            pointer: "/id",
            code: "INVALID_VALUE",
            detail: "허용되지 않는 값이에요.",
            location: "body",
        });
    });

    it("strips undeclared webhook fields while retaining the permissive DTO carveout", async () => {
        const result = await createStrictPipe().transform({
            webhook_id: "webhook-1",
            webhook_name: "contract-status",
            company_id: "company-1",
            event_type: "document",
            provider_extra: "top-level-secret",
            document: {
                id: "doc-1",
                document_title: "계약서",
                template_id: "template-1",
                template_name: "산모신생아 계약서",
                workflow_seq: 1,
                workflow_name: "서명",
                status: "doc_complete",
                updated_date: 1780000000000,
                comment: "provider addition",
                recipients: [{ phone: "010-0000-0000" }],
            },
        }, {
            type: "body",
            metatype: EformsignWebhookPayloadDto,
        }) as Record<string, unknown>;

        expect(result["provider_extra"]).toBeUndefined();
        const document = result["document"] as Record<string, unknown>;
        expect(document["comment"]).toBeUndefined();
        expect(document["recipients"]).toBeUndefined();
        expect(document["id"]).toBe("doc-1");
    });

    it("preserves caller options and a supplied exceptionFactory", async () => {
        const exceptionFactory = jest.fn((errors: ValidationError[]) =>
            new BadRequestException({ code: "CALLER_FACTORY", count: errors.length }));
        const pipe = new GlobalValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
            exceptionFactory,
        });

        const result = await pipe.transform({ count: "3" }, {
            type: "body",
            metatype: ConvertibleDto,
        }) as ConvertibleDto;
        expect(result.count).toBe(3);

        await expect(pipe.transform({ count: "not-a-number" }, {
            type: "body",
            metatype: ConvertibleDto,
        })).rejects.toMatchObject({
            response: { code: "CALLER_FACTORY" },
        });
        expect(exceptionFactory).toHaveBeenCalledTimes(1);
    });

    it("keeps whitelist and transform disabled when callers explicitly disable them", async () => {
        const pipe = new GlobalValidationPipe({
            whitelist: false,
            forbidNonWhitelisted: false,
            transform: false,
        });
        const input = { name: "ok", extra: "kept" };

        const result = await pipe.transform(input, {
            type: "body",
            metatype: UntransformedDto,
        }) as Record<string, unknown>;

        expect(result).toEqual(input);
        expect(result["extra"]).toBe("kept");
    });
});
