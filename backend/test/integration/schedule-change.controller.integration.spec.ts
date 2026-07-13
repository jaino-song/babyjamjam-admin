import { ConflictException, ExecutionContext, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";

type MockScheduleChangeService = {
    approve: jest.Mock;
    reject: jest.Mock;
};

const createSerializedRequest = (status: string) => ({
    id: "request-1",
    branchId: "org-1",
    scheduleId: 11,
    clientId: 21,
    sessionIndex: 3,
    fromDate: "2026-07-03",
    toDate: "2026-07-06",
    oldEndDate: "2026-07-14",
    newEndDate: "2026-07-15",
    status,
    reason: null,
    decidedBy: "user-1",
    requestedAt: "2026-07-02T00:00:00.000Z",
    decidedAt: "2026-07-02T00:00:00.000Z",
});

const expectRoute = (
    handler: object,
    method: RequestMethod,
    path: string,
): void => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
};

describe("ScheduleChangeController (Integration)", () => {
    const tenant = {
        userId: "user-1",
        branchId: "org-1",
        role: "admin",
        branchRole: "admin",
    };

    let moduleFixture: TestingModule;
    let controller: ScheduleChangeController;
    let scheduleChangeService: MockScheduleChangeService;

    beforeEach(async () => {
        scheduleChangeService = {
            approve: jest.fn(),
            reject: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = tenant;
                return true;
            },
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [ScheduleChangeController],
            providers: [
                {
                    provide: ScheduleChangeService,
                    useValue: scheduleChangeService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        controller = moduleFixture.get(ScheduleChangeController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    describe("POST /schedule-change-requests/:id/approve", () => {
        it("should expose the approve route and call the service with the current tenant", async () => {
            scheduleChangeService.approve.mockResolvedValue(createSerializedRequest("approved"));

            expect(Reflect.getMetadata(PATH_METADATA, ScheduleChangeController)).toBe(
                "schedule-change-requests",
            );
            expectRoute(
                ScheduleChangeController.prototype.approve,
                RequestMethod.POST,
                ":id/approve",
            );

            await controller.approve(tenant, "request-1");

            expect(scheduleChangeService.approve).toHaveBeenCalledWith(
                "request-1",
                expect.objectContaining({ branchId: "org-1" }),
            );
        });

        it("should preserve conflict response codes from the service", async () => {
            scheduleChangeService.approve.mockRejectedValue(
                new ConflictException({ code: "REQUEST_STALE" }),
            );

            try {
                await controller.approve(tenant, "request-1");
                throw new Error("Expected ConflictException");
            } catch (error) {
                expect(error).toBeInstanceOf(ConflictException);
                expect((error as ConflictException).getStatus()).toBe(409);
                expect((error as ConflictException).getResponse()).toEqual({ code: "REQUEST_STALE" });
            }
        });
    });

    describe("POST /schedule-change-requests/:id/reject", () => {
        it("should expose the reject route and pass dto reason", async () => {
            scheduleChangeService.reject.mockResolvedValue(createSerializedRequest("rejected"));

            expectRoute(
                ScheduleChangeController.prototype.reject,
                RequestMethod.POST,
                ":id/reject",
            );

            await controller.reject(tenant, "request-1", { reason: "provider unavailable" });

            expect(scheduleChangeService.reject).toHaveBeenCalledWith(
                "request-1",
                expect.objectContaining({ branchId: "org-1" }),
                "provider unavailable",
            );
        });
    });
});
