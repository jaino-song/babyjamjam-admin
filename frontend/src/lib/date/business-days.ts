// Korean holidays, including substitute holidays and election days.
// Source-aligned with mobile/src/lib/date/business-days.ts.
export const KR_HOLIDAYS = new Set<string>([
    // 2026
    "2026-01-01", // New Year's Day
    "2026-02-16", "2026-02-17", "2026-02-18", // Seollal
    "2026-03-01", // Independence Movement Day
    "2026-03-02", // substitute holiday
    "2026-05-01", // Labor Day
    "2026-05-05", // Children's Day
    "2026-05-24", "2026-05-25", // Buddha's Birthday + substitute
    "2026-06-03", // local elections
    "2026-06-06", // Memorial Day
    "2026-07-17", // Constitution Day
    "2026-08-15", // Liberation Day
    "2026-08-17", // substitute holiday
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // Chuseok + substitute
    "2026-10-03", "2026-10-05", // National Foundation Day + substitute
    "2026-10-09", // Hangeul Day
    "2026-12-25", // Christmas
    // 2027
    "2027-01-01", // New Year's Day
    "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // Seollal + substitute
    "2027-03-01", // Independence Movement Day
    "2027-05-01", // Labor Day
    "2027-05-05", // Children's Day
    "2027-05-13", // Buddha's Birthday
    "2027-06-06", "2027-06-07", // Memorial Day + substitute
    "2027-07-17", // Constitution Day
    "2027-08-15", "2027-08-16", // Liberation Day + substitute
    "2027-09-14", "2027-09-15", "2027-09-16", // Chuseok
    "2027-10-03", "2027-10-04", // National Foundation Day + substitute
    "2027-10-09", // Hangeul Day
    "2027-12-25", // Christmas
]);

export function isBusinessDayKr(iso: string): boolean {
    if (!iso) return false;
    const date = new Date(`${iso}T00:00:00Z`);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    return !KR_HOLIDAYS.has(iso);
}

// Counts startISO as day 1. If startISO is not a business day, the next
// Korean business day becomes day 1.
export function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string {
    if (!startISO || !Number.isFinite(numberOfBusinessDays) || numberOfBusinessDays <= 0) return "";
    if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(startISO)) return "";

    const cursor = new Date(`${startISO}T00:00:00Z`);
    let counted = 0;

    for (let i = 0; i < 365 && counted < numberOfBusinessDays; i += 1) {
        const iso = cursor.toISOString().slice(0, 10);
        if (isBusinessDayKr(iso)) {
            counted += 1;
            if (counted === numberOfBusinessDays) return iso;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return "";
}
