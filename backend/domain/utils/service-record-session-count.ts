import { countBusinessDaysKr } from "./business-days";

/** 바우처 일수와 구분하여 실제 서비스 기간 안에서 제공할 회차 수를 계산한다. */
export function serviceRecordSessionCount(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
    storedCount: number | null,
): number | null {
    if (!startDate || !endDate) return storedCount;
    const businessDays = countBusinessDaysKr(
        startDate.toISOString().slice(0, 10),
        endDate.toISOString().slice(0, 10),
    );
    if (businessDays === null) return storedCount;
    // 이관으로 짧아진 기간은 제한하되, 일정 연기로 늘어난 기간은 회차를 늘리지 않는다.
    return storedCount === null ? businessDays : Math.min(storedCount, businessDays);
}
