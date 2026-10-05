import { api } from "@/lib/api/client";
import { holidayCalendarApi, type BranchHolidayYear } from "@/services/holidays";

export type HolidayOverrideKind = "add" | "exclude";

export interface CreateHolidayOverrideInput {
    /** YYYY-MM-DD */
    date: string;
    kind: HolidayOverrideKind;
    /** Required (1-50 chars) for "add"; omitted for "exclude". */
    name?: string;
}

export interface HolidaySyncYearResult {
    year: number;
    status: "updated" | "unchanged" | "failed";
    added: number;
    removed: number;
    error?: string;
}

export interface HolidaySyncResponse {
    results: HolidaySyncYearResult[];
}

/** Owner/admin/manager writes plus the settings view's year read. */
export const holidaySettingsApi = {
    getYear: (branchId: string, year: number): Promise<BranchHolidayYear> =>
        holidayCalendarApi.getYear(branchId, year),
    createOverride: async (branchId: string, input: CreateHolidayOverrideInput): Promise<void> => {
        await api.post(`/branches/${branchId}/holidays/overrides`, input);
    },
    deleteOverride: async (branchId: string, overrideId: string): Promise<void> => {
        await api.delete(`/branches/${branchId}/holidays/overrides/${overrideId}`);
    },
    syncNow: async (branchId: string): Promise<HolidaySyncResponse> => {
        const { data } = await api.post(`/branches/${branchId}/holidays/sync`);
        return data;
    },
};
