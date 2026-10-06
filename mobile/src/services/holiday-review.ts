import { api } from "@/lib/api/client";

export type HolidayReviewChange = "added" | "removed";
/** "kasi" = public data; "branch" = this branch's own override (what the backend writes). */
export type HolidayReviewSource = "kasi" | "branch";
export type HolidayReviewCategory = "safe" | "risk";
export type HolidayReviewItemStatus = "open" | "fixed" | "kept" | "obsolete";
export type HolidayReviewResolveAction = "fix" | "keep";

export type HolidayReviewReason =
    | "no_sessions_after_date"
    | "session_on_or_after_date"
    | "finalized"
    | "locked_session_after_new_end";

export interface HolidayReviewEvent {
    id: string;
    /** YYYY-MM-DD */
    date: string;
    change: HolidayReviewChange;
    name: string | null;
    source: HolidayReviewSource;
    safeOpen: number;
    riskOpen: number;
    /** Full ISO timestamp. */
    createdAt: string;
}

export interface HolidayReviewItem {
    id: string;
    clientId: string;
    clientName: string;
    /** YYYY-MM-DD */
    storedEnd: string;
    /** YYYY-MM-DD */
    recalculatedEnd: string;
    category: HolidayReviewCategory;
    reason: HolidayReviewReason;
    status: HolidayReviewItemStatus;
}

export interface HolidayReviewItemFilters {
    category?: HolidayReviewCategory;
    status?: HolidayReviewItemStatus;
    q?: string;
}

export interface HolidayReviewSkip {
    itemId: string;
    /** A backend skip code, a backend problem code, or REQUEST_FAILED (a chunk whose request failed here). */
    code: string;
}

export interface HolidayReviewResolveResult {
    fixed: number;
    kept: number;
    skipped: HolidayReviewSkip[];
}

/** The backend caps one `fix` request at 50 ids and one `keep` request at 500. */
export const RESOLVE_CHUNK_SIZE: Record<HolidayReviewResolveAction, number> = { fix: 50, keep: 500 };

export const REQUEST_FAILED_CODE = "REQUEST_FAILED";

export const holidayReviewKeys = {
    events: (branchId: string) => ["holiday-review-events", branchId] as const,
    itemsAll: (branchId: string) => ["holiday-review-items", branchId] as const,
    items: (branchId: string, eventId: string, filters: HolidayReviewItemFilters) =>
        ["holiday-review-items", branchId, eventId, filters] as const,
};

function chunk<T>(values: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function reviewBase(branchId: string): string {
    return `/branches/${branchId}/holidays/review-events`;
}

export const holidayReviewApi = {
    listEvents: async (branchId: string): Promise<HolidayReviewEvent[]> => {
        const { data } = await api.get(reviewBase(branchId));
        return data;
    },
    listItems: async (
        branchId: string,
        eventId: string,
        filters: HolidayReviewItemFilters = {},
    ): Promise<HolidayReviewItem[]> => {
        const params: Record<string, string> = {};
        if (filters.category) params.category = filters.category;
        if (filters.status) params.status = filters.status;
        if (filters.q) params.q = filters.q;
        const { data } = await api.get(`${reviewBase(branchId)}/${eventId}/items`, { params });
        return data;
    },
    /**
     * Resolves in request-sized chunks, sequentially, and merges the results. If a later chunk's request
     * fails, the ids not yet handled come back as skipped (REQUEST_FAILED) so the earlier progress is
     * not lost; a failure on the first chunk rethrows.
     */
    resolve: async (
        branchId: string,
        eventId: string,
        itemIds: readonly string[],
        action: HolidayReviewResolveAction,
    ): Promise<HolidayReviewResolveResult> => {
        const merged: HolidayReviewResolveResult = { fixed: 0, kept: 0, skipped: [] };
        const chunks = chunk(itemIds, RESOLVE_CHUNK_SIZE[action]);
        for (let index = 0; index < chunks.length; index += 1) {
            try {
                const { data } = await api.post<HolidayReviewResolveResult>(
                    `${reviewBase(branchId)}/${eventId}/resolve`,
                    { itemIds: chunks[index], action },
                );
                merged.fixed += data.fixed;
                merged.kept += data.kept;
                merged.skipped.push(...data.skipped);
            } catch (error) {
                if (index === 0) throw error;
                for (const rest of chunks.slice(index)) {
                    merged.skipped.push(...rest.map((itemId) => ({ itemId, code: REQUEST_FAILED_CODE })));
                }
                break;
            }
        }
        return merged;
    },
};
