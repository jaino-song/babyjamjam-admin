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
        const clientRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const employeeRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
            listSchedules as never, clientRepository as never, employeeRepository as never,
        ).getCapabilities();

        const output = await schedulesList!.execute(context, { date: "2026-09-24" });
        const parsed = schedulesList!.outputSchema.parse(output) as { schedules: Array<{ id: number; primaryEmployeeId: number }> };

        expect(listSchedules.execute).toHaveBeenCalledWith("branch-a");
        expect(parsed.schedules).toEqual([expect.objectContaining({ id: 140, primaryEmployeeId: 0 })]);
    });

    it("resolves client/employee names in one batch lookup per repository, scoped to the branch", async () => {
        const listSchedules = {
            execute: jest.fn().mockResolvedValue([
                { id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: 3, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"), replaced: false },
            ]),
        };
        const clientRepository = { findNamesByIds: jest.fn().mockResolvedValue([{ id: 10, name: "산모" }]) };
        const employeeRepository = { findNamesByIds: jest.fn().mockResolvedValue([{ id: 2, name: "주담당" }, { id: 3, name: "부담당" }]) };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
            listSchedules as never, clientRepository as never, employeeRepository as never,
        ).getCapabilities();

        const output = await schedulesList!.execute(context, {}) as { schedules: Array<Record<string, unknown>> };

        expect(output.schedules).toEqual([expect.objectContaining({
            clientName: "산모", primaryEmployeeName: "주담당", secondaryEmployeeName: "부담당",
        })]);
        expect(clientRepository.findNamesByIds).toHaveBeenCalledTimes(1);
        expect(clientRepository.findNamesByIds).toHaveBeenCalledWith("branch-a", [10]);
        expect(employeeRepository.findNamesByIds).toHaveBeenCalledTimes(1);
        expect(employeeRepository.findNamesByIds).toHaveBeenCalledWith("branch-a", [2, 3]);
    });

    it("still resolves a name for a soft-deleted client or employee (repository returns it regardless)", async () => {
        const listSchedules = {
            execute: jest.fn().mockResolvedValue([
                { id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"), replaced: false },
            ]),
        };
        const clientRepository = { findNamesByIds: jest.fn().mockResolvedValue([{ id: 10, name: "삭제된 산모" }]) };
        const employeeRepository = { findNamesByIds: jest.fn().mockResolvedValue([{ id: 2, name: "삭제된 관리사" }]) };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
            listSchedules as never, clientRepository as never, employeeRepository as never,
        ).getCapabilities();

        const output = await schedulesList!.execute(context, {}) as { schedules: Array<Record<string, unknown>> };
        expect(output.schedules).toEqual([expect.objectContaining({ clientName: "삭제된 산모", primaryEmployeeName: "삭제된 관리사" })]);
    });

    it("still resolves without throwing when the name repositories have nothing to return", async () => {
        const listSchedules = {
            execute: jest.fn().mockResolvedValue([
                { id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"), replaced: false },
            ]),
        };
        const clientRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const employeeRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
            listSchedules as never, clientRepository as never, employeeRepository as never,
        ).getCapabilities();

        const output = await schedulesList!.execute(context, {}) as { schedules: Array<Record<string, unknown>> };
        expect(output.schedules).toEqual([expect.objectContaining({ clientName: null, primaryEmployeeName: null, secondaryEmployeeName: null })]);
    });

    it("filters by clientId and by employeeId matching either primary or secondary", async () => {
        const listSchedules = {
            execute: jest.fn().mockResolvedValue([
                { id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"), replaced: false },
                { id: 2, clientId: 11, primaryEmployeeId: 3, secondaryEmployeeId: 4, startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"), replaced: false },
            ]),
        };
        const clientRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const employeeRepository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
        const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
            listSchedules as never, clientRepository as never, employeeRepository as never,
        ).getCapabilities();

        const byClient = await schedulesList!.execute(context, { clientId: 11 }) as { schedules: Array<{ id: number }> };
        expect(byClient.schedules.map(({ id }) => id)).toEqual([2]);

        const bySecondaryEmployee = await schedulesList!.execute(context, { employeeId: 4 }) as { schedules: Array<{ id: number }> };
        expect(bySecondaryEmployee.schedules.map(({ id }) => id)).toEqual([2]);
    });

    describe("without a date", () => {
        beforeEach(() => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date("2026-09-24T03:00:00.000Z")); // 12:00 KST on 2026-09-24
        });
        afterEach(() => jest.useRealTimers());

        function day(iso: string): Date {
            return new Date(`${iso}T00:00:00.000Z`);
        }

        it("returns current and upcoming schedules first, so 50 old rows never crowd them out", async () => {
            const past = Array.from({ length: 60 }, (_, index) => ({
                id: 1000 + index, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null,
                startDate: day("2025-01-01"), endDate: day("2025-01-14"), replaced: false,
            }));
            const listSchedules = {
                execute: jest.fn().mockResolvedValue([
                    ...past,
                    { id: 2, clientId: 11, primaryEmployeeId: 3, secondaryEmployeeId: null, startDate: day("2026-10-01"), endDate: day("2026-10-14"), replaced: false },
                    { id: 1, clientId: 12, primaryEmployeeId: 4, secondaryEmployeeId: null, startDate: day("2026-09-20"), endDate: day("2026-09-24"), replaced: false },
                ]),
            };
            const repository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
            const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
                listSchedules as never, repository as never, repository as never,
            ).getCapabilities();

            const output = await schedulesList!.execute(context, {}) as { schedules: Array<{ id: number }> };

            expect(output.schedules).toHaveLength(50);
            expect(output.schedules.slice(0, 2).map(({ id }) => id)).toEqual([1, 2]);
        });

        it("still returns a finished client's past schedules, most recent first", async () => {
            const listSchedules = {
                execute: jest.fn().mockResolvedValue([
                    { id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, startDate: day("2026-06-01"), endDate: day("2026-06-14"), replaced: false },
                    { id: 2, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, startDate: day("2026-08-01"), endDate: day("2026-08-14"), replaced: false },
                ]),
            };
            const repository = { findNamesByIds: jest.fn().mockResolvedValue([]) };
            const [schedulesList] = new EmployeeScheduleAgentCapabilitiesProvider(
                listSchedules as never, repository as never, repository as never,
            ).getCapabilities();

            const output = await schedulesList!.execute(context, { clientId: 10 }) as { schedules: Array<{ id: number }> };

            expect(output.schedules.map(({ id }) => id)).toEqual([2, 1]);
        });
    });
});
