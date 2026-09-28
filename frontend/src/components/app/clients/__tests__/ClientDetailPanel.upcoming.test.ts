import {
    formatClientUpcomingDate,
    getClientUpcomingMessageDisplay,
} from "../ClientDetailPanel";
import type { ClientUpcomingMessageTriggerJob } from "@/features/message-triggers/types";

const baseJob: ClientUpcomingMessageTriggerJob = {
    id: "job-1",
    ruleName: "모니터링 설문",
    templateKey: "SURVEY",
    scheduledFor: "2026-09-29T06:00:00.000Z",
    nextAttemptAt: null,
    effectiveDueAt: "2026-09-29T06:00:00.000Z",
    status: "pending",
    recipientType: "CLIENT",
    recipientName: "고객",
};

describe("ClientDetailPanel upcoming message presentation", () => {
    const now = Date.parse("2026-09-28T06:00:00.000Z");

    it("labels a future pending job as 발송 예정 at the scheduled time", () => {
        expect(getClientUpcomingMessageDisplay(baseJob, now)).toMatchObject({
            label: "발송 예정",
            timeLabel: "발송 시각",
            time: baseJob.scheduledFor,
        });
    });

    it("labels a pending retry after the original due time as 재시도 예정", () => {
        expect(getClientUpcomingMessageDisplay({
            ...baseJob,
            scheduledFor: "2026-09-27T06:00:00.000Z",
            effectiveDueAt: "2026-09-27T06:00:00.000Z",
            nextAttemptAt: "2026-09-28T09:00:00.000Z",
        }, now)).toMatchObject({
            label: "재시도 예정",
            timeLabel: "재시도 시각",
            time: "2026-09-28T09:00:00.000Z",
        });
    });

    it("labels due pending and processing jobs without exposing message content", () => {
        expect(getClientUpcomingMessageDisplay({
            ...baseJob,
            scheduledFor: "2026-09-27T06:00:00.000Z",
            effectiveDueAt: "2026-09-27T06:00:00.000Z",
        }, now).label).toBe("발송 대기");
        expect(getClientUpcomingMessageDisplay({
            ...baseJob,
            status: "processing",
        }, now)).toMatchObject({
            label: "발송 처리 중",
            timeLabel: "요청 시각",
        });
        expect(JSON.stringify(baseJob)).not.toContain("messageBody");
        expect(JSON.stringify(baseJob)).not.toContain("buttonUrl");
    });

    it("formats dates in KST", () => {
        expect(formatClientUpcomingDate("2026-09-29T06:00:00.000Z")).toContain("15:00");
    });
});
