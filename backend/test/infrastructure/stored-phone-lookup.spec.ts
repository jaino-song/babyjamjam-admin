import { normalizeKoreanPhoneLookupKey as sharedNormalizeKoreanPhoneLookupKey } from "../../../packages/shared/src/utils/phone";
import {
    koreanPhoneStoredDigitCandidates,
    normalizeKoreanPhoneLookupKey,
    storedPhoneMatchesSql,
} from "infrastructure/database/repositories/stored-phone-lookup";
import { Prisma } from "@prisma/client";

const VARIANTS = [
    "01099900001",
    "010-9990-0001",
    "010 9990 0001",
    "010.9990.0001",
    "(010) 9990-0001",
    "+82 10-9990-0001",
    "+82 010-9990-0001",
    "82-10-9990-0001",
    "821099900001",
    "0082 10 9990 0001",
    "00821099900001",
    "1099900001",
    "010-9990-0002",
    "02-1234-5678",
    "+82 2-1234-5678",
    "031-123-4567",
    "1588-0000",
    "",
    "   ",
    "abc",
    "82",
    "0082",
];

describe("normalizeKoreanPhoneLookupKey (backend mirror)", () => {
    it.each(VARIANTS)("matches the shared helper for %p", (value) => {
        expect(normalizeKoreanPhoneLookupKey(value)).toBe(sharedNormalizeKoreanPhoneLookupKey(value));
    });

    it("treats null and undefined as no phone", () => {
        expect(normalizeKoreanPhoneLookupKey(null)).toBe("");
        expect(normalizeKoreanPhoneLookupKey(undefined)).toBe("");
    });
});

describe("koreanPhoneStoredDigitCandidates", () => {
    const stripToDigits = (value: string) => value.replace(/[^0-9]/g, "");

    it("returns nothing for an empty key", () => {
        expect(koreanPhoneStoredDigitCandidates("")).toEqual([]);
        expect(koreanPhoneStoredDigitCandidates(null)).toEqual([]);
        expect(koreanPhoneStoredDigitCandidates(undefined)).toEqual([]);
    });

    it("never lists a spelling that would not normalise to the key", () => {
        for (const key of ["01099900001", "0212345678", "0311234567", "15880000"]) {
            for (const candidate of koreanPhoneStoredDigitCandidates(key)) {
                expect(normalizeKoreanPhoneLookupKey(candidate)).toBe(key);
            }
        }
    });

    it("accepts a stored value exactly when the shared lookup key says it is the same number", () => {
        const key = normalizeKoreanPhoneLookupKey("010-9990-0001");
        const candidates = new Set(koreanPhoneStoredDigitCandidates(key));

        for (const stored of VARIANTS) {
            const matchesViaSql = candidates.has(stripToDigits(stored));
            const matchesViaLookupKey = normalizeKoreanPhoneLookupKey(stored) === key;
            expect([stored, matchesViaSql]).toEqual([stored, matchesViaLookupKey]);
        }
    });

    it("covers a hyphenated and a +82 stored value for a landline key as well", () => {
        const key = normalizeKoreanPhoneLookupKey("02-1234-5678");
        const candidates = new Set(koreanPhoneStoredDigitCandidates(key));

        expect(candidates.has(stripToDigits("02-1234-5678"))).toBe(true);
        expect(candidates.has(stripToDigits("+82 2-1234-5678"))).toBe(true);
        expect(candidates.has(stripToDigits("031-123-4567"))).toBe(false);
    });
});

describe("storedPhoneMatchesSql", () => {
    const toText = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

    it("compares the digits of the stored column against the candidate list", () => {
        const sql = storedPhoneMatchesSql(Prisma.sql`recipient_phone`, ["01099900001", "821099900001"]);

        expect(toText(sql)).toContain("regexp_replace(COALESCE(recipient_phone, ''), '[^0-9]', '', 'g') = ANY(?::text[])");
        expect(sql.values).toEqual([["01099900001", "821099900001"]]);
    });

    it("splits a multi-recipient column on comma, semicolon and newline before comparing", () => {
        const sql = storedPhoneMatchesSql(Prisma.sql`receiver`, ["01099900001"], { splitList: true });
        const text = toText(sql);

        expect(text).toContain("regexp_split_to_array(COALESCE(receiver, ''), '[,;' || chr(10) || ']')");
        expect(text).toContain("regexp_replace(COALESCE(phone_piece, ''), '[^0-9]', '', 'g') = ANY(?::text[])");
    });
});
