export const HOLIDAY_SYNC_REPOSITORY = "HOLIDAY_SYNC_REPOSITORY";

export interface HolidaySyncItem {
    /** `YYYY-MM-DD` */
    date: string;
    name: string;
}

export interface HolidaySyncWriteInput {
    year: number;
    /** Validated, one row per date (same-date KASI names already merged). */
    items: HolidaySyncItem[];
    /** Raw KASI item count summed over the 12 months; stored as the snapshot `itemCount`. */
    rawCount: number;
}

export interface HolidaySyncWriteResult {
    status: "updated" | "unchanged";
    /** Public change events (`added`) written. 0 when the previous set was unknown (year unsupported before). */
    added: number;
    /** Public change events (`removed`) written. */
    removed: number;
}

export interface IHolidaySyncRepository {
    /**
     * Applies one validated KASI year in a single serialized transaction: previous-set
     * resolution, public change events, row replacement, revision bump and snapshot upsert.
     */
    applyYearSync(input: HolidaySyncWriteInput): Promise<HolidaySyncWriteResult>;
}
