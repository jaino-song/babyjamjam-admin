import {
    type KrBusinessDayCalendar,
    type ServiceDayPolicy,
    UnsupportedKoreanHolidayYearError,
} from "./business-days";

/**
 * Immutable state for the "제공기록지 일정 변경" day picker. The admin must end
 * with exactly `requiredCount` selected service days. The picker owns the
 * service-day policy so undo and validity stay consistent; callers derive the
 * calendar as `baseCalendar.withServiceDays(state.policy)`. All dates are
 * `YYYY-MM-DD`; `initial` and `selected` are kept sorted ascending and unique.
 */
export interface ServiceDayPickerState {
    startDate: string;
    requiredCount: number;
    initial: readonly string[];
    selected: readonly string[];
    initialPolicy: ServiceDayPolicy;
    policy: ServiceDayPolicy;
}

export type ServiceDayClass = "before-start" | "unavailable" | "selected" | "skipped" | "available";

export type ServiceDayToggleOutcome = "removed" | "added" | "full" | "not-selectable";

export interface CreateServiceDayPickerInput {
    startDate: string;
    requiredCount: number;
    initialDates: readonly string[];
    policy: ServiceDayPolicy;
}

const AUTO_FILL_SEARCH_LIMIT_DAYS = 366 * 2;

function sortedUnique(dates: readonly string[]): string[] {
    return [...new Set(dates)].sort();
}

function copyPolicy(policy: ServiceDayPolicy): ServiceDayPolicy {
    return { saturday: policy.saturday, sunday: policy.sunday, holiday: policy.holiday };
}

/**
 * A year without holiday data is "not a service day" for display purposes:
 * the month view can be navigated anywhere and must render rather than throw.
 * Only UnsupportedKoreanHolidayYearError is swallowed.
 */
function isServiceDaySafe(calendar: KrBusinessDayCalendar, iso: string): boolean {
    try {
        return calendar.isBusinessDay(iso);
    } catch (error) {
        if (error instanceof UnsupportedKoreanHolidayYearError) return false;
        throw error;
    }
}

function nextIso(iso: string): string {
    const cursor = new Date(`${iso}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return cursor.toISOString().slice(0, 10);
}

export function createServiceDayPicker(input: CreateServiceDayPickerInput): ServiceDayPickerState {
    const dates = sortedUnique(input.initialDates);
    return {
        startDate: input.startDate,
        requiredCount: input.requiredCount,
        initial: dates,
        selected: dates,
        initialPolicy: copyPolicy(input.policy),
        policy: copyPolicy(input.policy),
    };
}

/**
 * The first `count` service days on/after `startDate` per `calendar`. Used when
 * a case has no stored dates yet. Fails closed: reaching a year without holiday
 * data lets UnsupportedKoreanHolidayYearError propagate instead of guessing.
 */
export function autoFillServiceDays(startDate: string, count: number, calendar: KrBusinessDayCalendar): string[] {
    if (!Number.isInteger(count) || count <= 0) return [];
    const result: string[] = [];
    let cursor = startDate;
    for (let i = 0; i < AUTO_FILL_SEARCH_LIMIT_DAYS && result.length < count; i += 1) {
        if (calendar.isBusinessDay(cursor)) result.push(cursor);
        cursor = nextIso(cursor);
    }
    return result;
}

export function classifyServiceDay(
    state: ServiceDayPickerState,
    iso: string,
    calendar: KrBusinessDayCalendar,
): ServiceDayClass {
    if (iso < state.startDate) return "before-start";
    if (state.selected.includes(iso)) return "selected";
    if (!isServiceDaySafe(calendar, iso)) return "unavailable";
    if (state.initial.includes(iso)) return "skipped";
    const lastSelected = state.selected[state.selected.length - 1];
    if (lastSelected !== undefined && iso < lastSelected) return "skipped";
    return "available";
}

export function toggleServiceDay(
    state: ServiceDayPickerState,
    iso: string,
    calendar: KrBusinessDayCalendar,
): { state: ServiceDayPickerState; outcome: ServiceDayToggleOutcome } {
    if (state.selected.includes(iso)) {
        return {
            state: { ...state, selected: state.selected.filter((date) => date !== iso) },
            outcome: "removed",
        };
    }
    if (iso < state.startDate || !isServiceDaySafe(calendar, iso)) {
        return { state, outcome: "not-selectable" };
    }
    // Never auto-drop another date to make room: the admin removes one first.
    if (state.selected.length >= state.requiredCount) return { state, outcome: "full" };
    return {
        state: { ...state, selected: sortedUnique([...state.selected, iso]) },
        outcome: "added",
    };
}

/**
 * Switches the policy and drops selected dates the new policy forbids. It does
 * not add replacements; the admin picks those.
 */
export function setServiceDayPolicy(
    state: ServiceDayPickerState,
    policy: ServiceDayPolicy,
    baseCalendar: KrBusinessDayCalendar,
): { state: ServiceDayPickerState; dropped: string[] } {
    const next = baseCalendar.withServiceDays(policy);
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const iso of state.selected) {
        (isServiceDaySafe(next, iso) ? kept : dropped).push(iso);
    }
    return { state: { ...state, policy: copyPolicy(policy), selected: kept }, dropped };
}

/** Undo restores both the dates and the toggles; restoring only dates could re-select a day the toggle forbids. */
export function revertServiceDayPicker(state: ServiceDayPickerState): ServiceDayPickerState {
    return { ...state, selected: state.initial, policy: copyPolicy(state.initialPolicy) };
}

/**
 * Save is allowed only when `complete`. Stored dates can be invalid (a day that
 * later became a holiday), so the count alone must never enable save.
 */
export function serviceDayPickerProgress(
    state: ServiceDayPickerState,
    calendar: KrBusinessDayCalendar,
): { selectedCount: number; requiredCount: number; invalid: string[]; complete: boolean } {
    const invalid = state.selected.filter((iso) => !isServiceDaySafe(calendar, iso));
    const selectedCount = state.selected.length;
    return {
        selectedCount,
        requiredCount: state.requiredCount,
        invalid,
        complete: selectedCount === state.requiredCount && invalid.length === 0,
    };
}
