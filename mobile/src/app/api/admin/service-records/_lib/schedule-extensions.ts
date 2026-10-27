import { NextResponse } from "next/server";

/**
 * The shared problem sanitizer drops every upstream member it does not know, so
 * the schedule editor would lose the reason a save was refused. These helpers
 * re-attach the two members the editor keys on after the sanitizer ran, each
 * validated down to a fixed allow-list or a short safe token:
 *
 * - `scheduleCode` on a 400/409: why a whole-set schedule was rejected.
 * - `blockingReasons[]` on a 400/409, reduced to `{ code, sessionIndex }`: why a
 *   preview/confirm was blocked (a 409 `REQUEST_CONFLICT` carries them).
 */

export const SCHEDULE_CODES: ReadonlySet<string> = new Set([
    "SCHEDULE_COUNT_MISMATCH",
    "SCHEDULE_WITH_DATE_MOVE",
    "UNSUPPORTED_HOLIDAY_YEAR",
    "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
    "INVALID_DATE",
    "DUPLICATE_SERVICE_DATE",
    "DUPLICATE_SESSION_INDEX",
    "INCOMPLETE_VECTOR",
    "INVALID_SESSION_COUNT",
    "INVALID_SESSION_INDEX",
    "INVERTED_SERVICE_DATES",
    "MISSING_ASSIGNMENT_PROVENANCE",
    "MISSING_PROVENANCE_VERSION",
    "NON_BUSINESS_DATE",
]);

const SAFE_BLOCKING_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_BLOCKING_REASONS = 50;

export interface ScheduleBlockingReason {
    code: string;
    sessionIndex?: number;
}

export interface ScheduleExtensions {
    scheduleCode?: string;
    blockingReasons?: ScheduleBlockingReason[];
}

function upstreamResponse(error: unknown): { status?: unknown; data?: unknown } | null {
    if (typeof error !== "object" || error === null) return null;
    const response = (error as { response?: unknown }).response;
    return typeof response === "object" && response !== null ? response : null;
}

function readBlockingReasons(value: unknown): ScheduleBlockingReason[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const reasons: ScheduleBlockingReason[] = [];
    for (const entry of value.slice(0, MAX_BLOCKING_REASONS)) {
        if (typeof entry !== "object" || entry === null) continue;
        const { code, sessionIndex } = entry as { code?: unknown; sessionIndex?: unknown };
        if (typeof code !== "string" || !SAFE_BLOCKING_CODE.test(code)) continue;
        const safeIndex = typeof sessionIndex === "number" && Number.isSafeInteger(sessionIndex) && sessionIndex > 0
            ? sessionIndex
            : undefined;
        reasons.push(safeIndex === undefined ? { code } : { code, sessionIndex: safeIndex });
    }
    return reasons.length > 0 ? reasons : undefined;
}

/** Reads the allow-listed extensions off an upstream 400/409; anything else yields `null`. */
export function readScheduleExtensions(error: unknown): ScheduleExtensions | null {
    const response = upstreamResponse(error);
    if (!response || (response.status !== 400 && response.status !== 409)) return null;
    const data = response.data;
    if (typeof data !== "object" || data === null) return null;
    const { scheduleCode, blockingReasons } = data as { scheduleCode?: unknown; blockingReasons?: unknown };
    const extensions: ScheduleExtensions = {};
    if (typeof scheduleCode === "string" && SCHEDULE_CODES.has(scheduleCode)) {
        extensions.scheduleCode = scheduleCode;
    }
    const reasons = readBlockingReasons(blockingReasons);
    if (reasons) extensions.blockingReasons = reasons;
    return extensions.scheduleCode !== undefined || extensions.blockingReasons !== undefined ? extensions : null;
}

/** Re-attaches the validated extensions to the already sanitized problem response. */
export async function withScheduleExtensions(sanitized: NextResponse, error: unknown): Promise<NextResponse> {
    const extensions = readScheduleExtensions(error);
    if (!extensions) return sanitized;
    const body = await sanitized.json().catch(() => ({}));
    const headers = new Headers(sanitized.headers);
    headers.delete("content-length");
    return NextResponse.json(
        { ...(typeof body === "object" && body !== null ? body : {}), ...extensions },
        { status: sanitized.status, headers },
    );
}

export const REALIGNMENT_REQUIRES_MANUAL_SCHEDULE = "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE";

/**
 * Client update only: a 409 whose `scheduleCode` is `REALIGNMENT_REQUIRES_MANUAL_SCHEDULE` keeps that
 * one member, so the client form can send the admin to the schedule editor. Nothing else is re-attached.
 */
export async function withManualScheduleRequired(sanitized: NextResponse, error: unknown): Promise<NextResponse> {
    const response = upstreamResponse(error);
    if (!response || response.status !== 409) return sanitized;
    const data = response.data;
    if (typeof data !== "object" || data === null) return sanitized;
    if ((data as { scheduleCode?: unknown }).scheduleCode !== REALIGNMENT_REQUIRES_MANUAL_SCHEDULE) return sanitized;
    const body = await sanitized.json().catch(() => ({}));
    const headers = new Headers(sanitized.headers);
    headers.delete("content-length");
    return NextResponse.json(
        {
            ...(typeof body === "object" && body !== null ? body : {}),
            scheduleCode: REALIGNMENT_REQUIRES_MANUAL_SCHEDULE,
        },
        { status: sanitized.status, headers },
    );
}
