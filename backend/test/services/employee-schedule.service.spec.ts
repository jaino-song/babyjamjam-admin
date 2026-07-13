import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("EmployeeScheduleService", () => {
    const createService = () => {
        const createUsecase = { execute: jest.fn() };
        const findByIdUsecase = { execute: jest.fn() };
        const listUsecase = { execute: jest.fn() };
        const listByPrimaryUsecase = { execute: jest.fn() };
        const listBySecondaryUsecase = { execute: jest.fn() };
        const updateUsecase = { execute: jest.fn() };
        const deleteUsecase = { execute: jest.fn() };
        const triggerService = { syncEmployeeAssignmentRulesForSchedule: jest.fn() };
        const feedbackLinkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(undefined),
            extendExpiryForEndDate: jest.fn().mockResolvedValue(undefined),
        };

        return {
            service: new EmployeeScheduleService(
                createUsecase as never,
                findByIdUsecase as never,
                listUsecase as never,
                listByPrimaryUsecase as never,
                listBySecondaryUsecase as never,
                updateUsecase as never,
                deleteUsecase as never,
                triggerService as never,
                feedbackLinkService as never,
            ),
            createUsecase,
            updateUsecase,
            feedbackLinkService,
        };
    };

    it("schedules the feedback link SMS when a service schedule is created", async () => {
        const { service, createUsecase, feedbackLinkService } = createService();
        createUsecase.execute.mockResolvedValue({ id: 10 } as EmployeeScheduleEntity);

        await service.create("branch-1", {
            clientId: 1,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-07-03",
            endDate: "2026-07-12",
        });

        expect(feedbackLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
    });

    it("extends feedback token expiry when a service schedule end date changes", async () => {
        const { service, updateUsecase, feedbackLinkService } = createService();
        const endDate = new Date("2026-07-20T00:00:00.000Z");
        updateUsecase.execute.mockResolvedValue({
            id: 10,
            endDate,
        } as EmployeeScheduleEntity);

        await service.update("branch-1", 10, {
            endDate: "2026-07-20",
        });

        expect(feedbackLinkService.extendExpiryForEndDate).toHaveBeenCalledWith(10, endDate);
    });

    it("does not touch feedback token expiry when end date is unchanged", async () => {
        const { service, updateUsecase, feedbackLinkService } = createService();
        updateUsecase.execute.mockResolvedValue({ id: 10 } as EmployeeScheduleEntity);

        await service.update("branch-1", 10, {
            workAddress: "서울",
        });

        expect(feedbackLinkService.extendExpiryForEndDate).not.toHaveBeenCalled();
    });
});
