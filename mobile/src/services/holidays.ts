import { api } from "@/lib/api/client";
import type { HolidayYearPayload } from "@babyjamjam/shared/utils/holiday-calendar";

export type HolidaySource = "public" | "builtin" | "branch_add";

export interface BranchHoliday {
    date: string;
    name: string;
    source: HolidaySource;
    /** True when the branch excluded this (public/builtin) date. */
    excluded: boolean;
    overrideId: string | null;
}

export interface InactiveHolidayOverride {
    id: string;
    date: string;
    kind: "add" | "exclude";
    name: string | null;
}

/**
 * `GET /branches/:branchId/holidays?year=` — a superset of HolidayYearPayload,
 * so it feeds buildCalendarFromHolidayYears directly while the settings UI can
 * still read source/override details.
 */
export interface BranchHolidayYear extends Omit<HolidayYearPayload, "holidays"> {
    synced: boolean;
    lastSyncedAt: string | null;
    holidays: BranchHoliday[];
    inactiveOverrides: InactiveHolidayOverride[];
}

export const holidayCalendarApi = {
    getYear: async (branchId: string, year: number): Promise<BranchHolidayYear> => {
        const { data } = await api.get(`/branches/${branchId}/holidays`, { params: { year } });
        return data;
    },
};
