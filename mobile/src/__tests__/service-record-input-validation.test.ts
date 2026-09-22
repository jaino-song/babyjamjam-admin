import {
    getServiceRecordHeaderErrors,
    getServiceRecordHeaderFieldError,
    getServiceRecordNumericFieldError,
    isServiceRecordHeaderComplete,
} from "../../../packages/service-record-ui/src/form-definition";
import { formatBirthdayInput, normalizeBirthdayIsoDate } from "../../../packages/shared/src/utils/birthday";

const NOW = new Date("2026-09-21T00:00:00Z");
const validHeader = {
    momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
    deliveryType: "자연분만", babyWeight: "3.2",
};

describe("service record input policy", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
    afterEach(() => jest.useRealTimers());

    it.each(["이 예지", " 이예지", "이예지 ", "이\t예지", "이\u00a0예지", "이\u200b예지"])("rejects name spacing: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momName", value, NOW)).toContain("띄어쓰기");
        expect(getServiceRecordHeaderFieldError("babyName", value, NOW)).toContain("띄어쓰기");
    });
    it.each(["이예지", "O'Connor", "José", "김"])("does not invent name-alphabet/length restrictions: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momName", value, NOW)).toBeNull();
    });
    it.each([
        ["", ""], ["1999", "1999"], ["19990", "1999-0"], ["199901", "1999-01"],
        ["1999010", "1999-01-0"], ["19990101", "1999-01-01"],
        ["1999-01-01", "1999-01-01"], ["1999 01 01", "1999-01-01"],
        ["1999.01.01", "1999-01-01"], ["20260615", "2026-06-15"],
        ["1999-01-", "1999-01"], ["1999-", "1999"],
        ["19990101123", "1999-01-01"], ["990101", "9901-01"],
    ])("formats date input %p as %p without guessing a century", (value, expected) => {
        expect(formatBirthdayInput(value)).toBe(expected);
    });
    it.each([
        "900101", "19990101", "1999 01 01", "99-01-01", "1999-1-01", "1999-01-1",
        "1999", "1999-01-", "1999-01-01 ", "1999-01-01\n", "１９９９-０１-０１",
    ])("requires an exact YYYY-MM-DD value at the validation boundary: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toContain("YYYY-MM-DD");
        expect(getServiceRecordHeaderFieldError("babyBirth", value, NOW)).toContain("YYYY-MM-DD");
    });
    it.each(["1990-02-30", "1999-02-29", "2026-10-01", "2026-13-01", "1899-12-31"])("rejects nonexistent, out-of-range or future dates: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toContain("날짜");
        expect(getServiceRecordHeaderFieldError("babyBirth", value, NOW)).toContain("날짜");
    });
    it.each(["1900-01-01", "1926-09-21", "1999-01-01", "2000-01-01", "2000-02-29", "2024-02-29", "2026-09-21"])("preserves explicit years, leading zeros and leap days: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toBeNull();
        expect(getServiceRecordHeaderFieldError("babyBirth", value, NOW)).toBeNull();
    });
    it("uses Korean midnight for the future-date boundary", () => {
        expect(getServiceRecordHeaderFieldError("babyBirth", "2026-09-22", new Date("2026-09-21T14:59:59Z"))).not.toBeNull();
        expect(getServiceRecordHeaderFieldError("babyBirth", "2026-09-22", new Date("2026-09-21T15:00:00Z"))).toBeNull();
    });
    it("keeps legacy reads separate from the new input contract", () => {
        expect(normalizeBirthdayIsoDate("990101", NOW)).toBe("1999-01-01");
        expect(getServiceRecordHeaderFieldError("momBirth", "990101", NOW)).not.toBeNull();
        expect(normalizeBirthdayIsoDate("1926-09-21", NOW)).toBe("1926-09-21");
    });
    it.each(["3.2kg", " 3.2", "3.2\n", "0", "-1", "3,2", "1e2", "Infinity", {}, 3.2, "9".repeat(400)])("rejects invalid weight: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("babyWeight", value, NOW)).not.toBeNull();
    });
    it.each(["3.2", "0.5", ".5", "4"])("accepts positive decimal weight: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("babyWeight", value, NOW)).toBeNull();
    });
    it("distinguishes partial drafts from completed employee forms without changing input", () => {
        expect(getServiceRecordHeaderErrors({}, NOW)).toEqual({});
        expect(Object.keys(getServiceRecordHeaderErrors({}, NOW, { required: true }))).toHaveLength(6);
        const raw = Object.freeze({ ...validHeader, momName: "이 예지", momBirth: "1999 01 01" });
        expect(Object.keys(getServiceRecordHeaderErrors(raw, NOW))).toEqual(["momName", "momBirth"]);
        expect(raw.momName).toBe("이 예지");
        expect(raw.momBirth).toBe("1999 01 01");
    });
    it("cannot continue just because every field contains some text", () => {
        expect(isServiceRecordHeaderComplete(validHeader)).toBe(true);
        expect(isServiceRecordHeaderComplete({ ...validHeader, momName: "이 예지" })).toBe(false);
        expect(isServiceRecordHeaderComplete({ ...validHeader, babyBirth: "20260615" })).toBe(false);
        expect(isServiceRecordHeaderComplete({ ...validHeader, babyBirth: "2026-06-" })).toBe(false);
        expect(isServiceRecordHeaderComplete({ ...validHeader, deliveryType: "기타" })).toBe(false);
    });
    it("keeps existing numeric boundaries without inventing clinical limits", () => {
        expect(getServiceRecordNumericFieldError("meals_meal", "0")).toBeNull();
        expect(getServiceRecordNumericFieldError("meals_meal", "-1")).not.toBeNull();
        expect(getServiceRecordNumericFieldError("meals_meal", "1.5")).toContain("소수점 없이");
        expect(getServiceRecordNumericFieldError("temperature_temp", "36.5")).toBeNull();
        expect(getServiceRecordNumericFieldError("temperature_temp", "36.55")).toContain("소수점 첫째");
    });
});
