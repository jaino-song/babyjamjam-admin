import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

describe("SbMessageTriggerJobRepository.findUpcomingByClient", () => {
    function sqlText(value: unknown): string {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) return strings.join("");
        }
        return String(value);
    }

    it("uses a read-only branch/client-fenced query with automatic and reserved exclusions", async () => {
        const queryRaw = jest.fn().mockResolvedValue([
            {
                id: "job-1",
                ruleName: "모니터링 설문",
                templateKey: "SURVEY",
                status: "pending",
                scheduledFor: "2026-09-28T06:00:00.000Z",
                nextAttemptAt: "2026-09-28T06:30:00.000Z",
                effectiveDueAt: "2026-09-28T06:30:00.000Z",
                recipientType: "CLIENT",
                recipientName: "김고객",
            },
        ]);
        const messageTriggerJob = {
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findMany: jest.fn(),
        };
        const repository = new SbMessageTriggerJobRepository({ $queryRaw: queryRaw, message_trigger_job: messageTriggerJob } as unknown as PrismaService);

        const result = await repository.findUpcomingByClient("branch-1", 42, 51);

        expect(result).toEqual([{
            id: "job-1",
            ruleName: "모니터링 설문",
            templateKey: "SURVEY",
            status: "pending",
            scheduledFor: new Date("2026-09-28T06:00:00.000Z"),
            nextAttemptAt: new Date("2026-09-28T06:30:00.000Z"),
            effectiveDueAt: new Date("2026-09-28T06:30:00.000Z"),
            recipientType: "CLIENT",
            recipientName: "김고객",
        }]);
        const text = sqlText(queryRaw.mock.calls[0]?.[0]).replace(/\s+/g, " ");
        expect(text).toContain('job.branch_id = ');
        expect(text).toContain('job.client_id = ');
        expect(text).toContain("job.status IN ('pending', 'processing', 'dispatching')");
        expect(text).toContain("NOT");
        expect(text).toContain("jsonb_typeof(job.payload->'recipientName')");
        expect(text).toContain('ORDER BY "effectiveDueAt" ASC, id ASC');
        expect(messageTriggerJob.create).not.toHaveBeenCalled();
        expect(messageTriggerJob.update).not.toHaveBeenCalled();
        expect(messageTriggerJob.updateMany).not.toHaveBeenCalled();
    });

    it("adds the effectiveDueAt/id keyset boundary for retry pages", async () => {
        const queryRaw = jest.fn().mockResolvedValue([]);
        const repository = new SbMessageTriggerJobRepository({
            $queryRaw: queryRaw,
            message_trigger_job: {},
        } as unknown as PrismaService);

        await repository.findUpcomingByClient(
            "branch-1",
            42,
            2,
            { effectiveDueAt: new Date("2026-09-28T06:30:00.000Z"), id: "job-1" },
        );

        const text = sqlText(queryRaw.mock.calls[0]?.[0]).replace(/\s+/g, " ");
        expect(text).toContain('"effectiveDueAt" > ');
        expect(text).toContain('"effectiveDueAt" = ');
        expect(text).toContain("id > ");
    });
});
