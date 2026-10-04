import { ServiceRecordEntryController } from "./service-record-entry.controller";

describe("ServiceRecordEntryController.getHolidays", () => {
    it("reads the token branch's effective year, bypassing the revision cache", async () => {
        const branchId = "11111111-1111-4111-8111-111111111111";
        const holidayCalendar = {
            getEffectiveYear: jest.fn(async () => ({
                year: 2027,
                revision: 2,
                supported: true,
                holidays: [],
            })),
        };
        const controller = new ServiceRecordEntryController(
            {} as never,
            {} as never,
            holidayCalendar as never,
        );
        const req = {
            serviceRecordContext: { tokenId: "test-token", branchId, scheduleId: 1, employeeId: 2 },
        } as Parameters<ServiceRecordEntryController["getHolidays"]>[0];

        await controller.getHolidays(req, { year: 2027 });

        expect(holidayCalendar.getEffectiveYear).toHaveBeenCalledWith(branchId, 2027, { fresh: true });
    });
});
