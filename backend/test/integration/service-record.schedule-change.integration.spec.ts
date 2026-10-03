import { ExecutionContext, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import {
    ServiceRecordEntryController,
    ServiceRecordHolidaysQueryDto,
} from "interface/controllers/service-record-entry.controller";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

type MockScheduleChangeService = {
    preview: jest.Mock;
    createRequest: jest.Mock;
};

const expectRoute = (
    handler: object,
    method: RequestMethod,
    path: string,
): void => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
};

describe("ServiceRecordEntryController schedule-change endpoints (Integration)", () => {
    const serviceRecordContext = {
        tokenId: "t1",
        branchId: "org-1",
        scheduleId: 11,
        employeeId: 5,
    };

    let moduleFixture: TestingModule;
    let controller: ServiceRecordEntryController;
    let scheduleChangeService: MockScheduleChangeService;
    let holidayCalendar: HolidayCalendarService;

    beforeEach(async () => {
        const serviceRecordService = {
            linkStatus: jest.fn(),
            verify: jest.fn(),
            getContext: jest.fn(),
            saveHeader: jest.fn(),
            upsertSession: jest.fn(),
            finalize: jest.fn(),
        };
        scheduleChangeService = {
            preview: jest.fn(),
            createRequest: jest.fn(),
        };
        holidayCalendar = createHolidayCalendarStub();
        const mockServiceRecordGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.serviceRecordContext = serviceRecordContext;
                return true;
            },
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [ServiceRecordEntryController],
            providers: [
                {
                    provide: ServiceRecordEntryService,
                    useValue: serviceRecordService,
                },
                {
                    provide: ScheduleChangeService,
                    useValue: scheduleChangeService,
                },
                { provide: HolidayCalendarService, useValue: holidayCalendar },
            ],
        })
            .overrideGuard(ServiceRecordGuard)
            .useValue(mockServiceRecordGuard)
            .overrideGuard(RateLimitGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = moduleFixture.get(ServiceRecordEntryController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    describe("GET /service-record/schedule-change/preview", () => {
        it("should expose the preview route and call the schedule-change service with service-record context", async () => {
            scheduleChangeService.preview.mockResolvedValue({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expect(Reflect.getMetadata(PATH_METADATA, ServiceRecordEntryController)).toBe(
                "service-record",
            );
            expectRoute(
                ServiceRecordEntryController.prototype.previewScheduleChange,
                RequestMethod.GET,
                "schedule-change/preview",
            );

            await controller.previewScheduleChange({ serviceRecordContext } as Parameters<
                ServiceRecordEntryController["previewScheduleChange"]
            >[0]);

            expect(scheduleChangeService.preview).toHaveBeenCalledWith(serviceRecordContext);
        });
    });

    describe("POST /service-record/schedule-change", () => {
        it("should expose the create route and call the schedule-change service with service-record context", async () => {
            scheduleChangeService.createRequest.mockResolvedValue({
                id: "request-1",
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expectRoute(
                ServiceRecordEntryController.prototype.createScheduleChange,
                RequestMethod.POST,
                "schedule-change",
            );

            await controller.createScheduleChange({ serviceRecordContext } as Parameters<
                ServiceRecordEntryController["createScheduleChange"]
            >[0]);

            expect(scheduleChangeService.createRequest).toHaveBeenCalledWith(serviceRecordContext);
        });
    });

    describe("GET /service-record/holidays", () => {
        const pipe = new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
        const validateQuery = (query: Record<string, unknown>) =>
            pipe.transform(query, { type: "query", metatype: ServiceRecordHolidaysQueryDto });

        it("is a token-page route behind ServiceRecordGuard only (no rate limit, like its siblings)", () => {
            const handler = ServiceRecordEntryController.prototype.getHolidays;
            expectRoute(handler, RequestMethod.GET, "holidays");
            expect(Reflect.getMetadata("__guards__", handler)).toEqual([ServiceRecordGuard]);
        });

        it("serves the token's branch holidays: excluded dates omitted, branch additions included", async () => {
            (holidayCalendar.getEffectiveYear as jest.Mock).mockResolvedValue({
                year: 2026,
                revision: 7,
                supported: true,
                synced: true,
                lastSyncedAt: "2026-09-01T00:00:00.000Z",
                holidays: [
                    { date: "2026-05-05", name: "어린이날", source: "public", excluded: false, overrideId: null },
                    { date: "2026-05-25", name: "부처님오신날", source: "public", excluded: true, overrideId: "o-1" },
                    { date: "2026-06-03", name: "지점 휴무", source: "branch_add", excluded: false, overrideId: "o-2" },
                ],
                inactiveOverrides: [{ id: "o-3", date: "2026-07-01", kind: "add", name: "x" }],
            });

            const result = await controller.getHolidays(
                { serviceRecordContext, query: { branchId: "someone-else" } } as unknown as Parameters<
                    ServiceRecordEntryController["getHolidays"]
                >[0],
                { year: 2026 },
            );

            expect(holidayCalendar.getEffectiveYear).toHaveBeenCalledWith("org-1", 2026);
            expect(result).toEqual({
                year: 2026,
                revision: 7,
                supported: true,
                holidays: [
                    { date: "2026-05-05", name: "어린이날" },
                    { date: "2026-06-03", name: "지점 휴무" },
                ],
            });
        });

        it("reports an unsupported year as such, with no holidays", async () => {
            (holidayCalendar.getEffectiveYear as jest.Mock).mockResolvedValue({
                year: 2099,
                revision: 3,
                supported: false,
                synced: false,
                lastSyncedAt: null,
                holidays: [],
                inactiveOverrides: [],
            });

            const result = await controller.getHolidays(
                { serviceRecordContext } as Parameters<ServiceRecordEntryController["getHolidays"]>[0],
                { year: 2099 },
            );

            expect(result).toEqual({ year: 2099, revision: 3, supported: false, holidays: [] });
        });

        it.each([["2000"], ["2026"], ["2100"]])("accepts year %s", async (year) => {
            await expect(validateQuery({ year })).resolves.toMatchObject({ year: Number(year) });
        });

        it.each([["1999"], ["2101"], ["abc"], ["2026.5"], [""]])("rejects year %j with VALIDATION_FAILED", async (year) => {
            await expect(validateQuery({ year })).rejects.toMatchObject({
                response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
            });
        });

        it("rejects a missing year and unknown query fields", async () => {
            await expect(validateQuery({})).rejects.toMatchObject({
                response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
            });
            await expect(validateQuery({ year: "2026", branchId: "x" })).rejects.toMatchObject({
                response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
            });
        });
    });
});
