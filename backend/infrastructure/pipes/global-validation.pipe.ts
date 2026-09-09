import {
    ArgumentMetadata,
    BadRequestException,
    HttpException,
    HttpStatus,
    Injectable,
    ValidationError,
    ValidationPipe,
    ValidationPipeOptions,
} from "@nestjs/common";
import { PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

type ValidationErrorCode =
    | "REQUIRED"
    | "UNEXPECTED_FIELD"
    | "OUT_OF_RANGE"
    | "INVALID_FORMAT"
    | "INVALID_VALUE";

type ValidationLocation = "body" | "query" | "path" | "custom";

interface StructuredValidationError {
    pointer: string;
    code: ValidationErrorCode;
    detail: string;
    location: ValidationLocation;
}

interface StructuredValidationResponse {
    code: "VALIDATION_FAILED";
    message: string[];
    errors: StructuredValidationError[];
    outcome: "NOT_APPLIED";
}

const CONSTRAINT_ERROR_CODES: Readonly<Record<string, ValidationErrorCode>> = {
    isDefined: "REQUIRED",
    isNotEmpty: "REQUIRED",
    whitelistValidation: "UNEXPECTED_FIELD",
    min: "OUT_OF_RANGE",
    max: "OUT_OF_RANGE",
    length: "OUT_OF_RANGE",
    isLength: "OUT_OF_RANGE",
    minLength: "OUT_OF_RANGE",
    maxLength: "OUT_OF_RANGE",
    isString: "INVALID_FORMAT",
    isNumber: "INVALID_FORMAT",
    isInt: "INVALID_FORMAT",
    isBoolean: "INVALID_FORMAT",
    isArray: "INVALID_FORMAT",
    isDateString: "INVALID_FORMAT",
    isEmail: "INVALID_FORMAT",
    matches: "INVALID_FORMAT",
    isPhoneNumber: "INVALID_FORMAT",
};

function getValidationLocation(type: ArgumentMetadata["type"]): ValidationLocation {
    if (type === "body" || type === "query") {
        return type;
    }
    if (type === "param") {
        return "path";
    }
    return "custom";
}

function escapeJsonPointerSegment(segment: string): string {
    return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendJsonPointerSegment(pointer: string, segment: string): string {
    return `${pointer}/${escapeJsonPointerSegment(segment)}`;
}

function getValidationErrorCode(constraint: string): ValidationErrorCode {
    return Object.prototype.hasOwnProperty.call(CONSTRAINT_ERROR_CODES, constraint)
        ? (CONSTRAINT_ERROR_CODES[constraint] ?? "INVALID_VALUE")
        : "INVALID_VALUE";
}

function collectStructuredValidationErrors(
    validationErrors: ValidationError[],
    location: ValidationLocation,
    parentPointer = "",
): StructuredValidationError[] {
    const structuredErrors: StructuredValidationError[] = [];

    for (const validationError of validationErrors) {
        const pointer = typeof validationError.property === "string"
            ? appendJsonPointerSegment(parentPointer, validationError.property)
            : parentPointer;

        for (const constraint of Object.keys(validationError.constraints ?? {})) {
            const code = getValidationErrorCode(constraint);
            structuredErrors.push({
                pointer,
                code,
                detail: PROBLEM_CATALOG.VALIDATION_FAILED.fieldErrors["ko-KR"][code],
                location,
            });
        }

        if (validationError.children?.length) {
            structuredErrors.push(
                ...collectStructuredValidationErrors(validationError.children, location, pointer),
            );
        }
    }

    return structuredErrors;
}

function createStructuredValidationException(
    validationErrors: ValidationError[],
    location: ValidationLocation,
    statusCode: number,
): HttpException {
    const errors = collectStructuredValidationErrors(validationErrors, location);
    const response: StructuredValidationResponse = {
        code: "VALIDATION_FAILED",
        message: errors.map((error) => error.detail),
        errors,
        outcome: "NOT_APPLIED",
    };

    if (statusCode === HttpStatus.BAD_REQUEST) {
        return new BadRequestException(response);
    }

    return new HttpException(response, statusCode);
}

function createStructuredValidationExceptionFactory(
    location: ValidationLocation,
    statusCode: number,
): NonNullable<ValidationPipeOptions["exceptionFactory"]> {
    return (validationErrors: ValidationError[]) =>
        createStructuredValidationException(validationErrors, location, statusCode);
}

/**
 * Application-wide validation pipe.
 *
 * Strict by default: constructed in main.ts with forbidNonWhitelisted so a
 * request body carrying fields no DTO declares is rejected (400) instead of
 * silently stripped — mass-assignment / client-server contract-drift hygiene.
 *
 * EXEMPT: inbound third-party webhook payloads whose shape we do not control.
 * NestJS applies a global pipe and any controller/route-level @UsePipes
 * ADDITIVELY (global first), so a permissive controller pipe cannot relax a
 * stricter global one — the global 400s before the local pipe runs. Branching
 * on the parameter's DTO metatype here is the route-agnostic way to carve out
 * the exemption: exempted DTOs are validated permissively (whitelist still
 * strips unknown fields, we just don't reject them).
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
    private readonly configuredOptions: ValidationPipeOptions;
    private readonly callerExceptionFactory: ValidationPipeOptions["exceptionFactory"] | undefined;

    // DTOs received from external systems whose payload shape we don't own.
    // Add a webhook/callback DTO here when it must tolerate undeclared fields.
    private static readonly PERMISSIVE_DTOS: ReadonlySet<unknown> = new Set<unknown>([
        EformsignWebhookPayloadDto,
    ]);

    constructor(options: ValidationPipeOptions = {}) {
        super(options);
        this.configuredOptions = { ...options };
        this.callerExceptionFactory = options.exceptionFactory;

        if (!this.callerExceptionFactory) {
            this.exceptionFactory = createStructuredValidationExceptionFactory(
                "custom",
                options.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST,
            );
        }
    }

    override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
        const isPermissiveDto = metadata.metatype
            && GlobalValidationPipe.PERMISSIVE_DTOS.has(metadata.metatype);
        const location = getValidationLocation(metadata.type);
        const exceptionFactory = this.callerExceptionFactory
            ?? createStructuredValidationExceptionFactory(
                location,
                this.configuredOptions.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST,
            );
        const options: ValidationPipeOptions = {
            ...this.configuredOptions,
            exceptionFactory,
        };

        if (isPermissiveDto) {
            options.whitelist = true;
            options.transform = true;
            options.forbidNonWhitelisted = false;
        }

        // A fresh pipe keeps metadata-bound error factories isolated when
        // concurrent requests enter this global singleton.
        return new ValidationPipe(options).transform(value, metadata);
    }
}
