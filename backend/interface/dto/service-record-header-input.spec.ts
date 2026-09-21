import { validate } from "class-validator";
import { SaveServiceHeaderDto } from "./service-record-entry.dto";

describe("SaveServiceHeaderDto strict input policy", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([
        ["momName", "이 예지"], ["babyName", "이\u00a0아기"],
        ["momBirth", "1990 01 01"], ["momBirth", "19900101"],
        ["babyBirth", "900230"], ["babyBirth", "261001"],
        ["babyWeight", "3.2kg"], ["babyWeight", "3.2\n"], ["babyWeight", "0"],
        ["deliveryType", "기타"], ["momName", ""], ["momName", null], ["babyWeight", 3.2],
    ])("rejects malformed supplied %s without reaching persistence", async (key, value) => {
        const dto = Object.assign(new SaveServiceHeaderDto(), { [key as string]: value });
        const errors = await validate(dto);
        expect(errors.map((error) => error.property)).toContain(key);
        expect(dto[key as keyof SaveServiceHeaderDto]).toBe(value);
    });
    it("continues to support partial updates without accepting null or empty replacements", async () => {
        expect(await validate(new SaveServiceHeaderDto())).toHaveLength(0);
        expect(await validate(Object.assign(new SaveServiceHeaderDto(), { momName: "이예지" }))).toHaveLength(0);
        expect(await validate(Object.assign(new SaveServiceHeaderDto(), {
            momName: "이예지", momBirth: "000101", babyName: "이아기", babyBirth: "260615",
            deliveryType: "자연분만", babyWeight: "3.2",
        }))).toHaveLength(0);
    });
});
