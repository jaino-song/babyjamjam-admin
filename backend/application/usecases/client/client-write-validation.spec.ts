import { ConflictException } from "@nestjs/common";

import { INVALID_PHONE_MESSAGE } from "application/utils/normalize-phone";
import { clientDurationOutOfRangeMessage } from "domain/entities/client.entity";
import { createKrBusinessDayCalendar, KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertClientDurationMatchesDates,
    assertClientPhoneInput,
    assertPhoneAvailable,
    deriveClientDuration,
    findClientByNormalizedPhone,
    mergeAndValidateClientServicePeriod,
    BOOKING_STATUS_CONFIRM_ONLY_DETAIL,
    parseClientDate,
    PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL,
    resolveSavedServiceStatus,
    type SavedServiceStatusInput,
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
        const conflict: unknown = await assertPhoneAvailable(repository, "branch-a", "010 1234 5678", 10)
            .catch((caught) => caught);
        expect(conflict).toBeInstanceOf(ConflictException);
        expect((conflict as { getResponse: () => unknown }).getResponse())
            .toMatchObject(problemResponse("CLIENT_PHONE_ALREADY_REGISTERED", "/phone", "INVALID_VALUE", "같은 전화번호의 고객이 이미 등록되어 있습니다."));
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
        expect(thrownErrorOf(() => deriveClientDuration(new Date("2026-01-02"), new Date("2026-01-01"), KR_BUILTIN_CALENDAR)))
            .toMatchObject(publicProblem("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."));
        expect(thrownErrorOf(() => assertClientDurationMatchesDates(15, 14)))
            .toMatchObject(publicProblem("CLIENT_DURATION_OUT_OF_RANGE", "/duration", "OUT_OF_RANGE", clientDurationOutOfRangeMessage(14)));
    });

    it("counts business days with the supplied branch calendar and fails closed on an unsupported year", () => {
        const branchCalendar = createKrBusinessDayCalendar(
            [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), "2026-05-07"],
            { supportedYears: [2026], version: "branch-test" },
        );
        const start = new Date("2026-05-04");
        const end = new Date("2026-05-08");
        expect(deriveClientDuration(start, end, KR_BUILTIN_CALENDAR)).toBe(4);
        expect(deriveClientDuration(start, end, branchCalendar)).toBe(3);
        expect(thrownErrorOf(() => deriveClientDuration(new Date("2027-01-04"), new Date("2027-01-08"), branchCalendar)))
            .toMatchObject(publicProblem("CLIENT_SERVICE_PERIOD_UNCOMPUTABLE", "/endDate", "INVALID_VALUE", "서비스 기간을 계산할 수 없습니다. 시작일과 종료일을 확인해 주세요."));
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

describe("resolveSavedServiceStatus (rule 고객-04: a save may not change 예약 전)", () => {
    // 2026-11-05 (KST): a 2026-11-02..2026-11-13 period is running, so a confirmed client's D is "active".
    const now = new Date("2026-11-05T03:00:00.000Z");
    const confirmedAt = new Date("2026-10-01T00:00:00.000Z");
    const start = new Date("2026-11-02T00:00:00.000Z");
    const end = new Date("2026-11-13T00:00:00.000Z");
    const dated = { startDate: start, endDate: end };
    const undated = { startDate: null, endDate: null };
    const unconfirmed = { bookingConfirmedAt: null };
    const confirmed = { bookingConfirmedAt: confirmedAt };

    const resolve = (input: Partial<SavedServiceStatusInput> & { suppliedServiceStatus: string | null | undefined }) =>
        resolveSavedServiceStatus({
            currentServiceStatus: "pre_booking",
            bookingConfirmedAt: null,
            ...dated,
            ...input,
        }, now);
    const refusal = (detail: string) => expect.objectContaining({
        status: 400,
        response: expect.objectContaining({
            code: "VALIDATION_FAILED",
            errors: [expect.objectContaining({
                pointer: "/serviceStatus",
                code: "INVALID_VALUE",
                detail,
                location: "body",
            })],
        }),
    });

    type Case = [
        label: string,
        client: Partial<SavedServiceStatusInput>,
        supplied: string | null | undefined,
        expected: { writes: string | undefined } | { refuses: string },
    ];
    const cases: Case[] = [
        // 1: not supplied
        ["row 1: unconfirmed, not supplied", { ...unconfirmed }, undefined, { writes: undefined }],
        ["row 1: confirmed, not supplied", { ...confirmed, currentServiceStatus: "active" }, undefined, { writes: undefined }],
        // 2: null is S = D
        ["row 2: confirmed, null, stored status already the derived one", { ...confirmed, currentServiceStatus: "active" }, null, { writes: undefined }],
        ["row 2: confirmed, null over a stored terminated is un-terminated to D", { ...confirmed, currentServiceStatus: "terminated" }, null, { writes: "active" }],
        ["row 2: unconfirmed, null (D = 예약 전 = E)", { ...unconfirmed }, null, { writes: undefined }],
        ["row 2: unconfirmed stored terminated, null becomes 예약 전", { ...unconfirmed, currentServiceStatus: "terminated" }, null, { writes: "pre_booking" }],
        // 3: S equals E
        ["row 3: unconfirmed, pre_booking", { ...unconfirmed }, "pre_booking", { writes: undefined }],
        ["row 3: confirmed, S equals the date-derived E (stored value is stale)", { ...confirmed, currentServiceStatus: "waiting" }, "active", { writes: undefined }],
        ["row 3: confirmed stored terminated, terminated", { ...confirmed, currentServiceStatus: "terminated" }, "terminated", { writes: undefined }],
        ["row 3: confirmed stored replacement_requested, replacement_requested", { ...confirmed, currentServiceStatus: "replacement_requested" }, "replacement_requested", { writes: undefined }],
        // 4: replacement_requested on a 예약 전 client
        ["row 4: unconfirmed, replacement_requested", { ...unconfirmed }, "replacement_requested", { refuses: PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL }],
        ["row 4: unconfirmed stored terminated, replacement_requested", { ...unconfirmed, currentServiceStatus: "terminated" }, "replacement_requested", { refuses: PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL }],
        ["row 4: confirmed but a date missing, replacement_requested", { ...confirmed, ...undated }, "replacement_requested", { refuses: PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL }],
        // 5: unconfirmed -> date-derived states
        ["row 5: unconfirmed, waiting", { ...unconfirmed }, "waiting", { refuses: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }],
        ["row 5: unconfirmed, active", { ...unconfirmed }, "active", { refuses: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }],
        ["row 5: unconfirmed, completed", { ...unconfirmed }, "completed", { refuses: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }],
        // 6 / 7: unchanged for an unconfirmed client
        ["row 6: unconfirmed, terminated is stored", { ...unconfirmed }, "terminated", { writes: "terminated" }],
        ["row 7: unconfirmed stored terminated, pre_booking is stored", { ...unconfirmed, currentServiceStatus: "terminated" }, "pre_booking", { writes: "pre_booking" }],
        // 8: confirmed -> 예약 전
        ["row 8: confirmed with dates, pre_booking", { ...confirmed, currentServiceStatus: "active" }, "pre_booking", { refuses: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }],
        ["row 8: confirmed stored terminated, pre_booking", { ...confirmed, currentServiceStatus: "terminated" }, "pre_booking", { refuses: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }],
        // 9: confirmed + date-derived state is never authoritative
        ["row 9: confirmed, completed while D is active stores D", { ...confirmed, currentServiceStatus: "active" }, "completed", { writes: "active" }],
        ["row 9: confirmed stored terminated, waiting un-terminates to D", { ...confirmed, currentServiceStatus: "terminated" }, "waiting", { writes: "active" }],
        ["row 9: confirmed stored replacement_requested, waiting un-requests to D", { ...confirmed, currentServiceStatus: "replacement_requested" }, "waiting", { writes: "active" }],
        ["row 9: confirmed but a date missing, active stores 예약 전", { ...confirmed, ...undated, currentServiceStatus: "pre_booking" }, "active", { writes: "pre_booking" }],
        // 10: manual states stay manual
        ["row 10: confirmed, terminated is stored", { ...confirmed, currentServiceStatus: "active" }, "terminated", { writes: "terminated" }],
        ["row 10: confirmed, replacement_requested is stored", { ...confirmed, currentServiceStatus: "active" }, "replacement_requested", { writes: "replacement_requested" }],
        ["row 10: confirmed stored replacement_requested, terminated is stored", { ...confirmed, currentServiceStatus: "replacement_requested" }, "terminated", { writes: "terminated" }],
    ];

    it.each(cases)("%s", (_label, client, supplied, expected) => {
        const run = () => resolve({ ...client, suppliedServiceStatus: supplied });
        if ("refuses" in expected) {
            expect(thrownErrorOf(run)).toEqual(refusal(expected.refuses));
        } else {
            expect(run()).toBe(expected.writes);
        }
    });

    it("judges E on the dates AS THEY WILL BE after the save", () => {
        const base = { ...confirmed, currentServiceStatus: "active" };
        // Clearing both dates leaves a confirmed client in 예약 전, so S = pre_booking equals E (row 3).
        expect(resolve({ ...base, ...undated, suppliedServiceStatus: "pre_booking" })).toBeUndefined();
        // Keeping the dates, the same request would move an in-service client back to 예약 전 (row 8).
        expect(thrownErrorOf(() => resolve({ ...base, ...dated, suppliedServiceStatus: "pre_booking" })))
            .toEqual(refusal(BOOKING_STATUS_CONFIRM_ONLY_DETAIL));
    });

    it("uses the 예약 전 sentence the request-replacement route refuses with", () => {
        expect(PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL).toBe("예약 전 고객은 제공인력 교체를 요청할 수 없습니다");
    });
});
