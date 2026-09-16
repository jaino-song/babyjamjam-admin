import { NextResponse } from "next/server";

import { validationProblemResponse } from "@/lib/api/problem-responses";

/**
 * Local path validation for the admin service-record link proxies. Mirrors
 * the schedule-change sibling: only positive integers count as schedule ids,
 * and the rejection is a registered VALIDATION_FAILED problem (400) whose
 * `detail` is re-stamped from the shared catalog locale copy.
 */
export function isPositiveScheduleId(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

export function invalidScheduleIdResponse(): NextResponse {
    return validationProblemResponse("Invalid schedule id", [
        { pointer: "/scheduleId", code: "INVALID_FORMAT", detail: "일정 ID 형식이 올바르지 않아요.", location: "path" },
    ]);
}
