import { EmployeeScheduleAgentCapabilitiesProvider } from "./employee-schedule-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko",
};

describe("EmployeeScheduleAgentCapabilitiesProvider", () => {
    it("returns schedules whose employee ids include the legacy id 0 without failing output validation", async () => {
        const listSchedules = {
            execute: jest.fn().mockResolvedValue([
                { id: 140, clientId: 161, primaryEmployeeId: 0, secondaryEmployeeId: null, startDate: new Date("2026-09-21T00:00:00.000Z"), endDate: new Date("2026-09-25T00:00:00.000Z"), replaced: false },
                { id: 12, clientId: 83, primaryEmployeeId: 5, secondaryEmployeeId: 0, startDate: new Date("2026-07-31T00:00:00.000Z"), endDate: new Date("2026-08-13T00:00:00.000Z"), replaced: false },
            ]),
        };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(listSchedules as never).getCapabilities();

        const output = await schedulesList!.execute(context, { date: "2026-09-24" });
        const parsed = schedulesList!.outputSchema.parse(output) as { schedules: Array<{ id: number; primaryEmployeeId: number }> };

        expect(listSchedules.execute).toHaveBeenCalledWith("branch-a");
        expect(parsed.schedules).toEqual([expect.objectContaining({ id: 140, primaryEmployeeId: 0 })]);
    });
});
