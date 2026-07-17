import { NotFoundException } from "@nestjs/common";
import {
    ActiveClientByEmployee,
    IEmployeeRepository,
} from "domain/repositories/employee.repository.interface";
import { EmployeeFactory, MockEmployeeRepository } from "../../utils";
import { ListActiveClientsByEmployeeUsecase } from "application/usecases/employee/list-active-clients-by-employee.usecase";

describe("ListActiveClientsByEmployeeUsecase", () => {
    const branchId = "org-1";
    let repository: MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "findActiveClientsByEmployee">;
    let usecase: ListActiveClientsByEmployeeUsecase;

    beforeEach(() => {
        repository = new MockEmployeeRepository() as MockEmployeeRepository & Pick<
            Required<IEmployeeRepository>,
            "findActiveClientsByEmployee"
        >;
        repository.findActiveClientsByEmployee = jest.fn().mockResolvedValue([]);
        usecase = new ListActiveClientsByEmployeeUsecase(repository);
    });

    it("should return primary and secondary active client assignments", async () => {
        const employee = EmployeeFactory.create({ id: 7 });
        const assignments: ActiveClientByEmployee[] = [
            {
                clientId: 11,
                clientName: "박서연",
                role: "primary",
                startDate: new Date("2026-07-01T00:00:00.000Z"),
                endDate: new Date("2026-12-31T00:00:00.000Z"),
                serviceStatus: "active",
            },
            {
                clientId: 12,
                clientName: "김민지",
                role: "secondary",
                startDate: new Date("2026-08-01T00:00:00.000Z"),
                endDate: null,
                serviceStatus: "waiting",
            },
        ];
        repository.setData([employee]);
        jest.mocked(repository.findActiveClientsByEmployee).mockResolvedValue(assignments);

        await expect(usecase.execute(branchId, 7)).resolves.toEqual(assignments);
        expect(repository.findActiveClientsByEmployee).toHaveBeenCalledWith(branchId, 7);
    });

    it("should throw 404 with a Korean message when employee does not exist in the branch", async () => {
        await expect(usecase.execute(branchId, 999)).rejects.toEqual(
            new NotFoundException("직원을 찾을 수 없습니다."),
        );
        expect(repository.findActiveClientsByEmployee).not.toHaveBeenCalled();
    });

    it("should return an empty array for a soft-deleted employee", async () => {
        const deletedEmployee = EmployeeFactory.create({ id: 7 });
        Object.defineProperty(deletedEmployee, "deletedAt", { value: new Date("2026-07-01") });
        repository.setData([deletedEmployee]);

        await expect(usecase.execute(branchId, 7)).resolves.toEqual([]);
        expect(repository.findActiveClientsByEmployee).not.toHaveBeenCalled();
    });
});
