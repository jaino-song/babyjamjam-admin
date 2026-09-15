/**
 * @jest-environment node
 */
import {
    invalidScheduleChangeRequestIdResponse,
    invalidScheduleDateResponse,
    invalidScheduleIdResponse,
    isPositiveScheduleId,
    isValidIsoDate,
    isValidScheduleChangeRequestId,
} from "../schedule-change-route-utils";

describe("schedule-change-route-utils", () => {
    describe("isValidScheduleChangeRequestId", () => {
        it.each(["request-11", "A_b9", "x"])("accepts %s", (value) => {
            expect(isValidScheduleChangeRequestId(value)).toBe(true);
        });

        it.each(["", "bad id!", "한글", `${"a".repeat(129)}`])("rejects %s", (value) => {
            expect(isValidScheduleChangeRequestId(value)).toBe(false);
        });
    });

    describe("isPositiveScheduleId", () => {
        it.each(["1", "11", "987654"])("accepts %s", (value) => {
            expect(isPositiveScheduleId(value)).toBe(true);
        });

        it.each(["0", "-1", "01", "1.5", "abc", ""])("rejects %s", (value) => {
            expect(isPositiveScheduleId(value)).toBe(false);
        });
    });

    describe("isValidIsoDate", () => {
        it("accepts a real calendar date", () => {
            expect(isValidIsoDate("2026-07-23")).toBe(true);
        });

        it("rejects non-ISO shapes and impossible dates", () => {
            expect(isValidIsoDate("07/23/2026")).toBe(false);
            expect(isValidIsoDate("2026-02-30")).toBe(false);
            expect(isValidIsoDate("2026-13-01")).toBe(false);
            expect(isValidIsoDate(undefined)).toBe(false);
            expect(isValidIsoDate(123)).toBe(false);
        });
    });

    describe("problem responses", () => {
        it("builds a request-id problem on /id", async () => {
            const response = invalidScheduleChangeRequestIdResponse();
            expect(response.status).toBe(400);
            expect(response.headers.get("content-type")).toBe("application/problem+json");
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "VALIDATION_FAILED",
                outcome: "NOT_APPLIED",
                error: "Invalid schedule change request id",
                errors: [{
                    pointer: "/id",
                    code: "INVALID_FORMAT",
                    detail: "입력 형식이 올바르지 않아요.",
                    location: "path",
                }],
            }));
        });

        it("builds a schedule id problem on /scheduleId", async () => {
            const response = invalidScheduleIdResponse();
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "VALIDATION_FAILED",
                error: "Invalid schedule id",
                errors: [expect.objectContaining({ pointer: "/scheduleId", location: "path" })],
            }));
        });

        it("builds a schedule date problem on /toDate", async () => {
            const response = invalidScheduleDateResponse();
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "VALIDATION_FAILED",
                error: "Invalid schedule date",
                errors: [expect.objectContaining({ pointer: "/toDate", location: "body" })],
            }));
        });
    });
});
