import {
    getServiceRecordHeaderErrors,
    getServiceRecordHeaderFieldError,
    getServiceRecordNumericFieldError,
    isServiceRecordHeaderComplete,
} from "../../../packages/service-record-ui/src/form-definition";

const NOW = new Date("2026-09-21T00:00:00Z");
const validHeader = {
    momName: "이예지", momBirth: "900101", babyName: "이아기", babyBirth: "260615",
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
    it.each(["19900101", "1990 01 01", "90-01-01", "90010", "9001011", "900101 ", "900101\n", "９００１０１"])("requires exactly six ASCII date digits: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toContain("6자리");
        expect(getServiceRecordHeaderFieldError("babyBirth", value, NOW)).toContain("6자리");
    });
    it.each(["900230", "990229", "261001", "261332"])("rejects nonexistent or future dates: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toContain("날짜");
    });
    it.each(["900101", "000101", "000229", "240229", "260921"])("preserves valid leading zeros and leap days: %p", (value) => {
        expect(getServiceRecordHeaderFieldError("momBirth", value, NOW)).toBeNull();
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
        const raw = Object.freeze({ ...validHeader, momName: "이 예지", momBirth: "1990 01 01" });
        expect(Object.keys(getServiceRecordHeaderErrors(raw, NOW))).toEqual(["momName", "momBirth"]);
        expect(raw.momName).toBe("이 예지");
        expect(raw.momBirth).toBe("1990 01 01");
    });
    it("cannot continue just because every field contains some text", () => {
        expect(isServiceRecordHeaderComplete(validHeader)).toBe(true);
        expect(isServiceRecordHeaderComplete({ ...validHeader, momName: "이 예지" })).toBe(false);
        expect(isServiceRecordHeaderComplete({ ...validHeader, babyBirth: "20260615" })).toBe(false);
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
