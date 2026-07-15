/**
 * Pure mapper: `service_record` header + `service_record_day` rows → eformsign prefill fields
 * for the 제공기록지 template. No NestJS/Prisma imports so it is trivially unit-testable.
 *
 * Field ids and value encodings come from `service-record-field-ids.ts` (captured live in Spike B).
 * `serviceDate` is a Prisma `@db.Date` (UTC-midnight) — read it with UTC accessors, never local ones.
 */
import {
    CHECKBOX_CHECKED_VALUE,
    CHECKBOX_UNCHECKED_VALUE,
    FEEDBACK_HEADER_FIELD_IDS,
    FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT,
    feedbackDayFieldIds,
} from "./service-record-field-ids";

export interface FeedbackHeaderInput {
    momName: string | null;
    momBirth: string | null; // YYMMDD
    babyName: string | null;
    babyBirth: string | null; // YYMMDD
    deliveryType: string | null; // "자연분만" | "제왕절개"
    babyWeight: string | null;
}

export interface FeedbackDayInput {
    sessionIndex: number;
    serviceDate: Date;
    answers: Record<string, unknown>;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    momApproval: string | null; // non-null => approved
}

export interface EformsignField {
    id: string;
    value: string;
}

/**
 * 2-digit-year → ISO date. Pivot at 30: 00–29 → 2000–2029, 30–99 → 1930–1999. Covers every
 * mother's birth year and every newborn's birth year for this app's era; revisit before 2030.
 * Returns null for anything that is not 6 digits forming a plausible date.
 */
export function yymmddToIso(yymmdd: string | null | undefined): string | null {
    if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
    const yy = Number(yymmdd.slice(0, 2));
    const mm = Number(yymmdd.slice(2, 4));
    const dd = Number(yymmdd.slice(4, 6));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const century = yy < 30 ? "20" : "19";
    return `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

/** UTC month as 2-digit "MM" (template field type date_MM). */
function utcMonth(date: Date): string {
    return String(date.getUTCMonth() + 1).padStart(2, "0");
}

/** UTC day as 2-digit "DD" (template field type date_DD). */
function utcDay(date: Date): string {
    return String(date.getUTCDate()).padStart(2, "0");
}

/** Split sessions into fixed-size chunks (one eformsign document per chunk). */
export function chunkSessions<T>(days: T[], size: number = FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT): T[][] {
    if (size < 1) throw new Error("chunk size must be >= 1");
    const chunks: T[][] = [];
    for (let i = 0; i < days.length; i += size) {
        chunks.push(days.slice(i, i + size));
    }
    return chunks;
}

function asText(value: unknown): string {
    if (value == null) return "";
    return String(value).trim();
}

/**
 * Build the eformsign prefill field list for ONE document covering up to
 * FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT sessions (`days` is a single chunk).
 *
 * Empty text/date values are omitted. The required creation-step marks (결제 확인 N / 산모확인서명 N)
 * are emitted for ALL 5 slots — including unused ones (as unchecked) — or eformsign rejects
 * creation with "Required input value not found".
 */
export function buildFeedbackDocumentFields(input: {
    header: FeedbackHeaderInput | null;
    orgName: string;
    employeeName: string;
    days: FeedbackDayInput[];
}): EformsignField[] {
    const { header, orgName, employeeName, days } = input;
    const fields: EformsignField[] = [];

    const pushText = (id: string, raw: unknown) => {
        const value = asText(raw);
        if (value !== "") fields.push({ id, value });
    };
    // Required-at-creation fields must be PRESENT in every request (creation 400s otherwise);
    // an empty value passes the required check and renders blank — verified live.
    const pushRequired = (id: string, raw: unknown) => {
        fields.push({ id, value: asText(raw) });
    };
    const pushCheck = (id: string, checked: boolean) => {
        fields.push({ id, value: checked ? CHECKBOX_CHECKED_VALUE : CHECKBOX_UNCHECKED_VALUE });
    };

    // ── Header (once per document) — every header field is required at creation ──
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.orgName, orgName);
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.employeeName, employeeName);
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.momName, header?.momName);
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.momBirth, yymmddToIso(header?.momBirth));
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.babyName, header?.babyName);
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.babyBirth, yymmddToIso(header?.babyBirth));
    pushRequired(FEEDBACK_HEADER_FIELD_IDS.babyWeight, header?.babyWeight);
    // Both delivery-type marks are required — send the pair, checked per deliveryType.
    pushCheck(FEEDBACK_HEADER_FIELD_IDS.deliveryNatural, header?.deliveryType === "자연분만");
    pushCheck(FEEDBACK_HEADER_FIELD_IDS.deliveryCSection, header?.deliveryType === "제왕절개");

    // ── Session slots 1..5 ──
    for (let slot = 1; slot <= FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT; slot++) {
        const ids = feedbackDayFieldIds(slot);
        const day = days[slot - 1];

        if (!day) {
            // Unused slot: required creation fields only — dates blank, marks unchecked.
            pushRequired(ids.month, "");
            pushRequired(ids.day, "");
            pushCheck(ids.paymentConfirmed, false);
            pushCheck(ids.momApproval, false);
            continue;
        }

        const answers = day.answers ?? {};
        const selectOne = (group: Record<string, string>, value: unknown) => {
            const key = asText(value);
            const id = key ? group[key] : undefined;
            if (id) pushCheck(id, true);
        };
        const selectMany = (group: Record<string, string>, value: unknown) => {
            if (!Array.isArray(value)) return;
            for (const option of value) {
                const id = group[asText(option)];
                if (id) pushCheck(id, true);
            }
        };

        // Date
        fields.push({ id: ids.month, value: utcMonth(day.serviceDate) });
        fields.push({ id: ids.day, value: utcDay(day.serviceDate) });

        // 산모 ①–⑤
        selectMany(ids.perineum, answers["perineum"]);
        selectMany(ids.breast, answers["breast"]);
        selectMany(ids.excretion, answers["excretion"]);
        selectOne(ids.sitzBath, answers["sitzBath"]);
        pushText(ids.meals, answers["meals_meal"]);
        pushText(ids.snack, answers["meals_snack"]);

        // 신생아 ⑥–⑪
        pushText(ids.temperature, answers["temperature_temp"]);
        selectOne(ids.sleep, answers["sleep"]);
        pushText(ids.breastFeedingCount, answers["breastFeeding_count"]);
        pushText(ids.formulaFeedingCount, answers["formulaFeeding_count"]);
        pushText(ids.formulaFeedingMl, answers["formulaFeeding_ml"]);
        selectOne(ids.stool, answers["stool"]);
        pushText(ids.stoolColor, answers["stool_color"]);
        selectOne(ids.bath, answers["bath"]);

        // 마무리
        pushText(ids.etcService, day.etcService);
        pushText(ids.notes, day.notes);
        pushCheck(ids.paymentConfirmed, day.paymentConfirmed === true);
        pushCheck(ids.momApproval, day.momApproval != null && day.momApproval !== "");
    }

    return fields;
}
