import { ExecutionContext, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceFeedbackService } from "application/services/service-feedback.service";
import { EmployeeFeedbackGuard } from "infrastructure/auth/employee-feedback.guard";
import { ServiceFeedbackController } from "interface/controllers/service-feedback.controller";

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

describe("ServiceFeedbackController schedule-change endpoints (Integration)", () => {
    const feedbackContext = {
        tokenId: "t1",
        branchId: "org-1",
        scheduleId: 11,
        employeeId: 5,
    };

    let moduleFixture: TestingModule;
    let controller: ServiceFeedbackController;
    let scheduleChangeService: MockScheduleChangeService;

    beforeEach(async () => {
        const serviceFeedbackService = {
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
        const mockFeedbackGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.feedbackContext = feedbackContext;
                return true;
            },
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [ServiceFeedbackController],
            providers: [
                {
                    provide: ServiceFeedbackService,
                    useValue: serviceFeedbackService,
                },
                {
                    provide: ScheduleChangeService,
                    useValue: scheduleChangeService,
                },
            ],
        })
            .overrideGuard(EmployeeFeedbackGuard)
            .useValue(mockFeedbackGuard)
            .compile();

        controller = moduleFixture.get(ServiceFeedbackController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    describe("GET /service-feedback/schedule-change/preview", () => {
        it("should expose the preview route and call the schedule-change service with feedback context", async () => {
            scheduleChangeService.preview.mockResolvedValue({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expect(Reflect.getMetadata(PATH_METADATA, ServiceFeedbackController)).toBe(
                "service-feedback",
            );
            expectRoute(
                ServiceFeedbackController.prototype.previewScheduleChange,
                RequestMethod.GET,
                "schedule-change/preview",
            );

            await controller.previewScheduleChange({ feedbackContext } as Parameters<
                ServiceFeedbackController["previewScheduleChange"]
            >[0]);

            expect(scheduleChangeService.preview).toHaveBeenCalledWith(feedbackContext);
        });
    });

    describe("POST /service-feedback/schedule-change", () => {
        it("should expose the create route and call the schedule-change service with feedback context", async () => {
            scheduleChangeService.createRequest.mockResolvedValue({
                id: "request-1",
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expectRoute(
                ServiceFeedbackController.prototype.createScheduleChange,
                RequestMethod.POST,
                "schedule-change",
            );

            await controller.createScheduleChange({ feedbackContext } as Parameters<
                ServiceFeedbackController["createScheduleChange"]
            >[0]);

            expect(scheduleChangeService.createRequest).toHaveBeenCalledWith(feedbackContext);
        });
    });
});
