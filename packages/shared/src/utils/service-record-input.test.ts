import {
    HEADER_FIELDS,
    getServiceRecordHeaderErrors,
    getServiceRecordHeaderFieldError,
} from "./service-record-input";

const NOW = new Date("2026-09-21T00:00:00Z");

describe("service record header fields", () => {
    it("drops the format suffix from labels and uses realistic example dates", () => {
        const byKey = Object.fromEntries(HEADER_FIELDS.map((field) => [field.k, field]));
        expect(byKey.momBirth).toMatchObject({ label: "산모 생년월일", ph: "1994-03-15", inputMode: "numeric" });
        expect(byKey.babyBirth).toMatchObject({ label: "신생아 출생일자", ph: "2026-09-20", inputMode: "numeric" });
        for (const field of HEADER_FIELDS) {
            expect(field.label).not.toContain("YYYY");
            expect(field).not.toHaveProperty("helper");
        }
    });
});

describe("service record header messages", () => {
    it.each([
        ["momName", "이 예지", "띄어쓰기 없이 입력해 주세요"],
        ["momBirth", "1999", "YYYY-MM-DD 형식으로 입력해 주세요"],
        ["momBirth", "1990-02-30", "존재하지 않는 날짜예요"],
        ["momBirth", "1899-12-31", "존재하지 않는 날짜예요"],
        ["momBirth", "2026-10-01", "오늘 이후 날짜는 안 돼요"],
        ["babyWeight", "0", "0보다 큰 숫자로 (예: 3.2)"],
        ["deliveryType", "기타", "분만형태를 선택해 주세요"],
        ["momName", 3, "입력 형식을 확인해 주세요"],
    ])("%s %p -> %s", (key, value, message) => {
        expect(getServiceRecordHeaderFieldError(key as Parameters<typeof getServiceRecordHeaderFieldError>[0], value, NOW)).toBe(message);
    });

    it("builds the required messages with the matching object particle", () => {
        const errors = getServiceRecordHeaderErrors({}, NOW, { required: true });
        expect(errors).toEqual({
            momName: "산모 성명을 입력해 주세요",
            momBirth: "산모 생년월일을 입력해 주세요",
            babyName: "신생아 성명을 입력해 주세요",
            babyBirth: "신생아 출생일자를 입력해 주세요",
            deliveryType: "분만형태를 선택해 주세요",
            babyWeight: "신생아 몸무게를 입력해 주세요",
        });
    });

    it("keeps validation logic identical: valid values pass and partial drafts stay silent", () => {
        expect(getServiceRecordHeaderFieldError("momBirth", "1994-03-15", NOW)).toBeNull();
        expect(getServiceRecordHeaderFieldError("babyBirth", "2026-09-20", NOW)).toBeNull();
        expect(getServiceRecordHeaderFieldError("babyWeight", "3.2", NOW)).toBeNull();
        expect(getServiceRecordHeaderErrors({}, NOW)).toEqual({});
    });
});
