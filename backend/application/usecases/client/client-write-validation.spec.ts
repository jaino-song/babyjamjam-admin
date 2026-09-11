import { ConflictException } from "@nestjs/common";

import { INVALID_PHONE_MESSAGE } from "application/utils/normalize-phone";
import { clientDurationOutOfRangeMessage } from "domain/entities/client.entity";

import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertClientDurationMatchesDates,
    assertClientPhoneInput,
    assertPhoneAvailable,
    deriveClientDuration,
    findClientByNormalizedPhone,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
} from "./client-write-validation";

/** Capture the exception thrown by a synchronous validation call. */
function thrownErrorOf(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    throw new Error("Expected the call to throw");
}

/** Partner-side problem entry inside the public client problem contract. */
const problemError = (pointer: string, code: string, detail: unknown) => expect.objectContaining({
    pointer,
    code,
    detail,
    location: "body",
});

/** Public problem response body shape carried by converted client throws. */
const problemResponse = (topCode: string, pointer: string, errorCode: string, detail: unknown) => ({
    code: topCode,
    params: {},
    outcome: "NOT_APPLIED",
    recovery: { action: "NONE", retry: { mode: "NEVER" } },
    errors: expect.arrayContaining([problemError(pointer, errorCode, detail)]),
});

/** Full thrown shape (HTTP status + problem response body) for client problems. */
const publicProblem = (topCode: string, pointer: string, errorCode: string, detail: unknown) => ({
    status: 400,
    response: problemResponse(topCode, pointer, errorCode, detail),
});

describe("client write validation", () => {
    it("accepts branch-local and global areas but rejects foreign areas with one structured problem", async () => {
        const prisma = { area: { findFirst: jest.fn() } };
        prisma.area.findFirst.mockResolvedValueOnce({ id: "local" });
        await expect(assertAllowedClientArea(prisma, "branch-a", "local")).resolves.toBeUndefined();

        prisma.area.findFirst.mockResolvedValueOnce({ id: "global" });
        await expect(assertAllowedClientArea(prisma, "branch-a", "global")).resolves.toBeUndefined();

        prisma.area.findFirst.mockResolvedValueOnce(null);
        await expect(assertAllowedClientArea(prisma, "branch-a", "foreign"))
            .rejects.toMatchObject(publicProblem("CLIENT_AREA_UNAVAILABLE", "/areaId", "INVALID_VALUE", "선택한 관할 지역을 사용할 수 없습니다."));
        expect(prisma.area.findFirst).toHaveBeenLastCalledWith({
            where: { id: "foreign", OR: [{ branchId: "branch-a" }, { branchId: null }] },
            select: { id: true },
        });
    });

    it("normalizes formatted phones, allows self, and rejects another client in the same branch", async () => {
        const ownClient = { id: 10 } as never;
        const otherClient = { id: 11 } as never;
        const repository = { findByPhone: jest.fn() };

        repository.findByPhone.mockResolvedValueOnce(ownClient);
        await expect(assertPhoneAvailable(repository, "branch-a", "010-1234-5678", 10)).resolves.toBe("01012345678");
        expect(repository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");

        repository.findByPhone.mockResolvedValueOnce(otherClient);
        await expect(assertPhoneAvailable(repository, "branch-a", "010 1234 5678", 10)).rejects.toBeInstanceOf(ConflictException);
        expect(repository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");

        repository.findByPhone.mockResolvedValueOnce(null);
        await expect(findClientByNormalizedPhone(repository, "branch-a", "010.1234.5678"))
            .resolves.toEqual({ normalizedPhone: "01012345678", existingClient: null });
    });

    it("turns invalid client phone and date input into structured VALIDATION_FAILED problems", () => {
        expect(thrownErrorOf(() => assertClientPhoneInput("not-a-phone")))
            .toMatchObject(publicProblem("VALIDATION_FAILED", "/phone", "INVALID_FORMAT", INVALID_PHONE_MESSAGE));
        expect(thrownErrorOf(() => parseClientDate("내일", "birthDate")))
            .toMatchObject(publicProblem("VALIDATION_FAILED", "/birthDate", "INVALID_FORMAT", "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)"));
        expect(parseClientDate("2024-02-29T23:30:00-09:00", "birthDate")).toEqual(new Date("2024-02-29T00:00:00.000Z"));
        expect(parseClientDate(null, "birthDate")).toBeNull();
        expect(parseClientDate(undefined, "birthDate")).toBeUndefined();
    });

    it("structures derived duration failures with client-specific problem codes", () => {
        expect(thrownErrorOf(() => deriveClientDuration(new Date("2026-01-02"), new Date("2026-01-01"))))
            .toMatchObject(publicProblem("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."));
        expect(thrownErrorOf(() => assertClientDurationMatchesDates(15, 14)))
            .toMatchObject(publicProblem("CLIENT_DURATION_OUT_OF_RANGE", "/duration", "OUT_OF_RANGE", clientDurationOutOfRangeMessage(14)));
    });

    it("enforces merged date ordering while preserving canonical null and equal-date behavior", () => {
        const existing = {
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
        };
        expect(thrownErrorOf(() => mergeAndValidateClientServicePeriod(existing, {
            endDate: new Date("2023-12-31T00:00:00.000Z"),
        }))).toMatchObject(publicProblem("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."));
        expect(mergeAndValidateClientServicePeriod(existing, {
            endDate: existing.startDate,
        })).toEqual({ startDate: existing.startDate, endDate: existing.startDate });
        expect(mergeAndValidateClientServicePeriod(existing, { startDate: null })).toEqual({
            startDate: null,
            endDate: existing.endDate,
        });
        expect(mergeAndValidateClientServicePeriod(existing, { endDate: null })).toEqual({
            startDate: existing.startDate,
            endDate: null,
        });
        expect(mergeAndValidateClientServicePeriod(existing, { startDate: null, endDate: null })).toEqual({
            startDate: null,
            endDate: null,
        });
    });

    it("accepts only canonical service statuses and keeps calendar date components", () => {
        expect(() => assertAllowedServiceStatus("active")).not.toThrow();
        expect(() => assertAllowedServiceStatus(null)).not.toThrow();
        expect(thrownErrorOf(() => assertAllowedServiceStatus("pending")))
            .toMatchObject(publicProblem("CLIENT_SERVICE_STATUS_INVALID", "/serviceStatus", "INVALID_VALUE", expect.stringContaining("계약 상태가 올바르지 않습니다. 허용 값:")));
    });
});

describe("confirmed business-day mismatch", () => {
    it("only relaxes the business-day ceiling after explicit confirmation", () => {
        expect(() => assertClientDurationMatchesDates(15, 14)).toThrow();
        expect(() => assertClientDurationMatchesDates(15, 14, false)).toThrow();
        expect(() => assertClientDurationMatchesDates(15, 14, true)).not.toThrow();
        expect(() => assertClientDurationMatchesDates(3, 0, true)).not.toThrow();
    });
    it.each([null, 0, -1, 1.5, NaN, Infinity])("still rejects invalid duration %s after confirmation", (duration) => {
        expect(() => assertClientDurationMatchesDates(duration, 14, true)).toThrow();
    });
});
