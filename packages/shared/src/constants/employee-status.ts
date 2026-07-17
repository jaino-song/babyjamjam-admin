/**
 * Canonical employee status/availability labels (M6: employee status label
 * drift).
 *
 * Desktop and mobile agree on `available`/`unavailable` but disagree on
 * `working`:
 *   - frontend/src/app/(protected)/employees/page.tsx:63 — `"근무중"` (no space)
 *   - mobile/src/app/(shell)/employees/page.tsx:99      — `"근무 중"` (with space)
 * Canonical value is `"근무 중"` (with a space), matching mobile.
 */
export type EmployeeStatus = "available" | "working" | "unavailable";

export const EMPLOYEE_STATUS_LABELS: Readonly<Record<EmployeeStatus, string>> = {
    available: "근무 가능",
    working: "근무 중",
    unavailable: "근무 불가",
};

/**
 * Labels for the `openToNextWork` (다음 배정 가능 여부) toggle, kept
 * separate from `EMPLOYEE_STATUS_LABELS` so the two concepts — an
 * employee's current work status vs. whether they're open to being
 * assigned next — don't collide on the same Korean wording (both existing
 * UIs currently render this toggle as "근무 가능"/"근무 불가", which reads
 * identically to the `available` status label above even though they are
 * different fields).
 */
export const OPEN_TO_NEXT_WORK_LABELS: Readonly<Record<"true" | "false", string>> = {
    true: "배정 가능",
    false: "배정 불가",
};

export function getOpenToNextWorkLabel(openToNextWork: boolean): string {
    return OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"];
}
