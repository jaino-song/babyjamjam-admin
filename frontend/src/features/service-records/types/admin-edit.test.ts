import { scheduleFailureMessage } from "@/components/app/service-record/service-record-schedule-model";

import { AdminServiceRecordEditApiError, pickServiceRecordScheduleErrorExtension } from "./admin-edit";

const scheduleCode = "SERVICE_DATE_OUT_OF_RANGE";

describe("schedule error session indexes", () => {
    it.each([1, 3, Number.MAX_SAFE_INTEGER])("keeps the positive safe integer %s", (sessionIndex) => {
        const body = { scheduleCode, sessionIndex, message: "private upstream message" };
        expect(pickServiceRecordScheduleErrorExtension({ response: { status: 400, data: body } }))
            .toEqual({ scheduleCode, sessionIndex });
        expect(new AdminServiceRecordEditApiError(400, body).sessionIndex).toBe(sessionIndex);
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "3", null, undefined])(
        "drops an invalid session index %s", (sessionIndex) => {
            const body = { scheduleCode, sessionIndex };
            expect(pickServiceRecordScheduleErrorExtension({ response: { status: 400, data: body } }))
                .toEqual({ scheduleCode });
            expect(new AdminServiceRecordEditApiError(400, body).sessionIndex).toBeUndefined();
        },
    );

    it("drops an index when the schedule code was not kept, even with blocking reasons", () => {
        expect(pickServiceRecordScheduleErrorExtension({ response: { status: 400, data: {
            scheduleCode: "UNKNOWN", sessionIndex: 3,
            blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 2, message: "private" }],
        } } })).toEqual({ blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 2 }] });
    });

    it.each([401, 403, 500])("does not extend a %s response", (status) => {
        expect(pickServiceRecordScheduleErrorExtension({ response: { status, data: { scheduleCode, sessionIndex: 3 } } }))
            .toBeNull();
    });

    it("preserves the schedule dialog's generic fallback for the newly allowed code", () => {
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(400, {
            scheduleCode, sessionIndex: 3, message: "private upstream message",
        }))).toBe("일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    });
});
