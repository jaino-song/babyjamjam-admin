import { BadRequestException, ConflictException } from "@nestjs/common";

import type { ProblemCode, ProblemDetails, ProblemError } from "@babyjamjam/shared/errors/problem-details";

import { assertValidPhone, INVALID_PHONE_MESSAGE, normalizePhone } from "application/utils/normalize-phone";
import { ClientEntity, clientDurationOutOfRangeMessage } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { isServiceStatus, SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";
import {
    countBusinessDaysKr,
    UnsupportedKoreanHolidayYearError,
} from "domain/utils/business-days";

interface AreaLookup {
    area: {
        findFirst(args: {
            where: {
                id: string;
                OR: Array<{ branchId: string } | { branchId: null }>;
            };
            select: { id: true };
        }): Promise<{ id: string } | null>;
    };
}

type ClientDateField = "startDate" | "endDate" | "dueDate" | "birthDate";

/**
 * Shape a client pre-write rejection as a public problem contract body.
 * The HTTP boundary replaces the texts with locale catalog copies, so the
 * codes and pointers here only have to identify the cause.
 *
 * `message` is an in-process compatibility alias for callers that read
 * `HttpException.message` (Nest derives it from a string `message` member);
 * the HTTP mapper copies only contract members, so it never reaches clients.
 */
export function clientProblemBody(
    code: ProblemCode,
    error: ProblemError,
): Pick<ProblemDetails, "code" | "params" | "outcome" | "recovery" | "errors"> & { message: string } {
    return {
        code,
        params: {},
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        errors: [error],
        message: error.detail,
    };
}

/**
 * Shape a client rejection that carries only its public code — no field
 * errors (resource-not-found, delete retention). Same contract members as
 * `clientProblemBody` minus `errors`; `message` stays the in-process
 * compatibility alias and never reaches clients through the HTTP boundary.
 */
export function clientCodeOnlyProblemBody(
    code: ProblemCode,
    message: string,
): Pick<ProblemDetails, "code" | "params" | "outcome" | "recovery"> & { message: string } {
    return {
        code,
        params: {},
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        message,
    };
}

export interface ClientDateUpdate {
    startDate?: Date | null;
    endDate?: Date | null;
}

export interface MergedClientServicePeriod {
    startDate: Date | null;
    endDate: Date | null;
}

export interface ClientPhoneMatch {
    normalizedPhone: string | null;
    existingClient: ClientEntity | null;
}

/** Validate a client write before any lookup or side effect. */
export function assertClientPhoneInput(phone: string | null | undefined): string | null {
    try {
        return assertValidPhone(phone);
    } catch (error) {
        if (error instanceof Error && error.name === "InvalidPhoneError") {
            throw new BadRequestException(clientProblemBody("VALIDATION_FAILED", {
                pointer: "/phone",
                code: "INVALID_FORMAT",
                detail: INVALID_PHONE_MESSAGE,
                location: "body",
            }));
        }
        throw error;
    }
}

/**
 * Parse a client calendar date without allowing timezone offsets to change
 * the submitted day. Client date columns are calendar dates, not instants.
 */
export function parseClientDate(value: string | null | undefined, field: ClientDateField): Date | null | undefined {
    if (value === undefined || value === null) return value;

    const dateProblem = (): BadRequestException => new BadRequestException(clientProblemBody("VALIDATION_FAILED", {
        pointer: `/${field}`,
        code: "INVALID_FORMAT",
        detail: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)",
        location: "body",
    }));

    if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) {
        throw dateProblem();
    }

    const calendarDate = value.slice(0, 10);
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendarDate) {
        throw dateProblem();
    }
    return parsed;
}

/**
 * Derive a client's persisted duration from its authoritative calendar dates.
 * The count is inclusive and skips Korean weekends/holidays exactly as the
 * service-record lifecycle does. A missing endpoint remains nullable for
 * pre-booking clients that do not yet have a complete service period.
 */
export function deriveClientDuration(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
): number | null {
    if (!startDate || !endDate) return null;
    if (
        Number.isNaN(startDate.getTime())
        || Number.isNaN(endDate.getTime())
        || startDate.getTime() > endDate.getTime()
    ) {
        throw new BadRequestException(clientProblemBody("CLIENT_SERVICE_PERIOD_INVALID", {
            pointer: "/endDate",
            code: "INVALID_VALUE",
            detail: "서비스 시작일은 종료일보다 늦을 수 없습니다.",
            location: "body",
        }));
    }

    try {
        const duration = countBusinessDaysKr(
            startDate.toISOString().slice(0, 10),
            endDate.toISOString().slice(0, 10),
        );
        if (duration === null) {
            throw new BadRequestException(clientProblemBody("CLIENT_SERVICE_PERIOD_UNCOMPUTABLE", {
                pointer: "/endDate",
                code: "INVALID_VALUE",
                detail: "서비스 기간을 계산할 수 없습니다.",
                location: "body",
            }));
        }
        return duration;
    } catch (error) {
        if (error instanceof UnsupportedKoreanHolidayYearError) {
            // 기술 영문 메시지(지원 연도 범위)는 공개 계약으로 노출하지 않는다.
            throw new BadRequestException(clientProblemBody("CLIENT_SERVICE_PERIOD_UNCOMPUTABLE", {
                pointer: "/endDate",
                code: "INVALID_VALUE",
                detail: "서비스 기간을 계산할 수 없습니다. 시작일과 종료일을 확인해 주세요.",
                location: "body",
            }));
        }
        throw error;
    }
}

/**
 * Reject a caller-provided duration that cannot fit within the authoritative
 * dates. `duration` is the contracted session count and is authoritative
 * once set; the service period only needs to be long enough to contain it
 * (it may be longer, e.g. when a session is postponed and the end date is
 * extended while the session count stays fixed), so a supplied duration must
 * be <= the derived business-day count, not equal to it. A confirmed admin
 * save may exceed it for services performed on weekends or holidays.
 * Confirmation never bypasses integer, positivity, or date validation.
 */
export function assertClientDurationMatchesDates(
    suppliedDuration: number | null | undefined,
    derivedDuration: number | null,
    allowBusinessDayMismatch = false,
): void {
    // Undefined means the caller omitted duration. Null is an explicit clear
    // and is only valid while no complete date range exists; once both dates
    // are present, every supplied value must fit within the derived count.
    if (suppliedDuration === undefined || derivedDuration === null) return;
    if (suppliedDuration === null || !Number.isSafeInteger(suppliedDuration) || suppliedDuration < 1 || (suppliedDuration > derivedDuration && allowBusinessDayMismatch !== true)) {
        throw new BadRequestException(clientProblemBody("CLIENT_DURATION_OUT_OF_RANGE", {
            pointer: "/duration",
            code: "OUT_OF_RANGE",
            detail: clientDurationOutOfRangeMessage(derivedDuration),
            location: "body",
        }));
    }
}

/**
 * Merge a partial service-period update with the persisted values and enforce
 * the canonical ordering rule. Null is an intentional absence of a date, so
 * ordering is only checked when both merged dates are present; equal dates are
 * valid.
 */
export function mergeAndValidateClientServicePeriod(
    existing: Pick<ClientEntity, "startDate" | "endDate"> | null,
    update: ClientDateUpdate,
): MergedClientServicePeriod {
    const startDate = update.startDate === undefined
        ? existing?.startDate ?? null
        : update.startDate;
    const endDate = update.endDate === undefined
        ? existing?.endDate ?? null
        : update.endDate;

    if (startDate && endDate && startDate > endDate) {
        throw new BadRequestException(clientProblemBody("CLIENT_SERVICE_PERIOD_INVALID", {
            pointer: "/endDate",
            code: "INVALID_VALUE",
            detail: "서비스 시작일은 종료일보다 늦을 수 없습니다.",
            location: "body",
        }));
    }

    return { startDate, endDate };
}

export function assertAllowedServiceStatus(status: string | null | undefined): void {
    if (status == null) return;

    if (!isServiceStatus(status)) {
        throw new BadRequestException(clientProblemBody("CLIENT_SERVICE_STATUS_INVALID", {
            pointer: "/serviceStatus",
            code: "INVALID_VALUE",
            detail: `계약 상태가 올바르지 않습니다. 허용 값: ${SERVICE_STATUS_VALUES.join(", ")}`,
            location: "body",
        }));
    }
}

/**
 * Validate an area without revealing whether a foreign-branch area exists.
 * A null branchId is the explicit global-area scope and is accepted here.
 */
export async function assertAllowedClientArea(
    prisma: AreaLookup,
    branchId: string,
    areaId: string | null | undefined,
): Promise<void> {
    if (!areaId) return;

    const area = await prisma.area.findFirst({
        where: {
            id: areaId,
            OR: [{ branchId: branchId }, { branchId: null }],
        },
        select: { id: true },
    });

    if (!area) {
        throw new BadRequestException(clientProblemBody("CLIENT_AREA_UNAVAILABLE", {
            pointer: "/areaId",
            code: "INVALID_VALUE",
            detail: "선택한 관할 지역을 사용할 수 없습니다.",
            location: "body",
        }));
    }
}

export async function findClientByNormalizedPhone(
    repository: Pick<IClientRepository, "findByPhone">,
    branchId: string,
    phone: string | null | undefined,
): Promise<ClientPhoneMatch> {
    const normalizedPhone = normalizePhone(phone ?? null);
    if (!normalizedPhone) return { normalizedPhone: null, existingClient: null };

    return {
        normalizedPhone,
        existingClient: await repository.findByPhone(branchId, normalizedPhone),
    };
}

/**
 * Reject a phone collision in the branch while allowing the current target to
 * keep its own normalized phone value.
 */
export async function assertPhoneAvailable(
    repository: Pick<IClientRepository, "findByPhone">,
    branchId: string,
    phone: string | null | undefined,
    currentClientId?: number,
): Promise<string | null> {
    const normalizedPhone = assertClientPhoneInput(phone);
    const existingClient = normalizedPhone
        ? await repository.findByPhone(branchId, normalizedPhone)
        : null;
    if (existingClient && existingClient.id !== currentClientId) {
        throw new ConflictException(clientProblemBody("CLIENT_PHONE_ALREADY_REGISTERED", {
            pointer: "/phone",
            code: "INVALID_VALUE",
            detail: "같은 전화번호의 고객이 이미 등록되어 있습니다.",
            location: "body",
        }));
    }
    return normalizedPhone;
}
