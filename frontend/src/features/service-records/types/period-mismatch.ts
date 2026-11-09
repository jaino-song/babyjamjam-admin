export interface KeepPeriodMismatchResponse {
    keptSessionIndexes: number[];
}

export interface FitPeriodMismatchResponse {
    startDate: string;
    endDate: string;
}

export function normalizeKeepPeriodMismatch(value: unknown): KeepPeriodMismatchResponse {
    const indexes = (value as KeepPeriodMismatchResponse | null)?.keptSessionIndexes;
    if (!Array.isArray(indexes) || !indexes.every((index) => Number.isSafeInteger(index) && index > 0)) {
        throw new Error("Invalid period-mismatch keep response");
    }
    return { keptSessionIndexes: indexes };
}

export function normalizeFitPeriodMismatch(value: unknown): FitPeriodMismatchResponse {
    const result = value as FitPeriodMismatchResponse | null;
    if (!result || !isDateOnly(result.startDate) || !isDateOnly(result.endDate)) {
        throw new Error("Invalid period-mismatch fit response");
    }
    return { startDate: result.startDate, endDate: result.endDate };
}

function isDateOnly(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
