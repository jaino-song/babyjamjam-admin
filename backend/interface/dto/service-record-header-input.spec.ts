import { validate } from "class-validator";
import { SaveServiceHeaderDto } from "./service-record-entry.dto";

describe("SaveServiceHeaderDto strict input policy", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([
        ["momName", "이 예지"], ["babyName", "이\u00a0아기"],
        ["momBirth", "1999 01 01"], ["momBirth", "19990101"], ["momBirth", "990101"],
        ["momBirth", "1999-01-01\n"], ["momBirth", "1999-1-01"],
        ["babyBirth", "1999-02-29"], ["babyBirth", "2026-10-01"],
        ["babyBirth", "2026-06-"], ["babyBirth", "260615"],
        ["babyWeight", "3.2kg"], ["babyWeight", "3.2\n"], ["babyWeight", "0"],
        ["deliveryType", "기타"], ["momName", ""], ["momName", null], ["babyWeight", 3.2],
    ])("rejects malformed supplied %s without reaching persistence", async (key, value) => {
        const dto = Object.assign(new SaveServiceHeaderDto(), { [key as string]: value });
        const errors = await validate(dto);
        expect(errors.map((error) => error.property)).toContain(key);
        expect(dto[key as keyof SaveServiceHeaderDto]).toBe(value);
    });
    it.each(["1999-01-01", "2000-02-29", "2026-09-21"])("accepts a valid full-year birthday without rewriting it: %s", async (value) => {
        const dto = Object.assign(new SaveServiceHeaderDto(), { momBirth: value, babyBirth: value });
        expect(await validate(dto)).toHaveLength(0);
        expect(dto.momBirth).toBe(value);
        expect(dto.babyBirth).toBe(value);
    });
    it("continues to support partial updates without accepting null or empty replacements", async () => {
        expect(await validate(new SaveServiceHeaderDto())).toHaveLength(0);
        expect(await validate(Object.assign(new SaveServiceHeaderDto(), { momName: "이예지" }))).toHaveLength(0);
        expect(await validate(Object.assign(new SaveServiceHeaderDto(), {
            momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
            deliveryType: "자연분만", babyWeight: "3.2",
        }))).toHaveLength(0);
    });
});
