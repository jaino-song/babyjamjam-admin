import { Prisma } from "@prisma/client";

/**
 * Backend mirror of `normalizeKoreanPhoneLookupKey` from
 * `packages/shared/src/utils/phone.ts` (the helper the client message-history
 * matcher uses). The vendored `@babyjamjam/shared` the backend consumes does not
 * export that module, so it is mirrored here; `stored-phone-lookup.spec.ts`
 * pins it to the shared implementation case by case.
 */
export function normalizeKoreanPhoneLookupKey(value: string | number | null | undefined): string {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return "";

    // Some providers send the international access prefix instead of "+".
    const nationalDigits = digits.startsWith("0082") ? digits.slice(2) : digits;
    if (!nationalDigits) return "";

    if (nationalDigits.startsWith("82")) {
        const domesticDigits = nationalDigits.slice(2);
        if (!domesticDigits) return "";
        return domesticDigits.startsWith("0") ? domesticDigits : `0${domesticDigits}`;
    }

    // Some provider payloads omit the leading 0 of a 1xx number.
    if (/^1\d{9}$/.test(nationalDigits)) return `0${nationalDigits}`;

    return nationalDigits;
}

/**
 * Upper bound on unowned (client_id IS NULL) history rows one phone number can
 * pull into a client's history. The cap keeps the id list bound into the page
 * query small; the newest rows win.
 */
export const UNOWNED_PHONE_MATCH_LIMIT = 2000;

/**
 * Every digits-only spelling a stored phone value can have and still collapse to
 * `lookupKey` under `normalizeKoreanPhoneLookupKey` (domestic, `82`, `0082`, and
 * the provider form that drops the leading 0 of a 1xx number).
 *
 * The stored column is compared after stripping everything but digits, so a
 * hyphenated or `+82`-prefixed stored value matches the same way the shared
 * lookup key treats it, instead of requiring an exact raw-string match. Each
 * candidate is re-checked through the lookup key above, so the list can never
 * contain a spelling that would not normalise to `lookupKey`.
 */
export function koreanPhoneStoredDigitCandidates(lookupKey: string | null | undefined): string[] {
    const key = lookupKey ?? "";
    if (key.length === 0) return [];

    const candidates = new Set<string>([key]);
    if (key.startsWith("0")) {
        const withoutTrunkZero = key.slice(1);
        candidates.add(`82${withoutTrunkZero}`);
        candidates.add(`0082${withoutTrunkZero}`);
        candidates.add(`82${key}`);
        candidates.add(`0082${key}`);
        candidates.add(withoutTrunkZero);
    }

    return [...candidates].filter(
        (candidate) => candidate.length > 0 && normalizeKoreanPhoneLookupKey(candidate) === key,
    );
}

function digitsOnly(value: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`regexp_replace(COALESCE(${value}, ''), '[^0-9]', '', 'g')`;
}

/**
 * SQL predicate: the single phone `column` (or any one of the `;`/`,`/newline
 * separated numbers when `splitList` is set) normalises to one of `candidates`.
 */
export function storedPhoneMatchesSql(
    column: Prisma.Sql,
    candidates: readonly string[],
    options: { splitList?: boolean } = {},
): Prisma.Sql {
    const list = [...candidates];
    if (!options.splitList) {
        return Prisma.sql`${digitsOnly(column)} = ANY(${list}::text[])`;
    }
    return Prisma.sql`EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(COALESCE(${column}, ''), '[,;' || chr(10) || ']')) AS phone_piece
        WHERE ${digitsOnly(Prisma.sql`phone_piece`)} = ANY(${list}::text[])
    )`;
}
