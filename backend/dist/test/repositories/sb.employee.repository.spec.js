"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sb_employee_repository_1 = require("../../infrastructure/database/repositories/sb.employee.repository");
const employee_entity_1 = require("../../domain/entities/employee.entity");
describe("SbEmployeeRepository", () => {
    const employeeModel = {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
    const prisma = { employee: employeeModel };
    const repository = new sb_employee_repository_1.SbEmployeeRepository(prisma);
    const baseRow = {
        id: 1,
        name: "Alice",
        work_area: "Incheon",
        phone: "010-1234-5678",
        grade: "A",
        open_to_next_work: true,
        company_registered_date: new Date("2024-01-01T00:00:00.000Z"),
    };
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("finds by id", async () => {
        employeeModel.findUnique.mockResolvedValue(baseRow);
        const result = await repository.findById(1);
        expect(employeeModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(result).toBeInstanceOf(employee_entity_1.EmployeeEntity);
        expect(result).toMatchObject({ id: 1, workArea: "Incheon" });
    });
    it("returns null when id missing", async () => {
        employeeModel.findUnique.mockResolvedValue(null);
        const result = await repository.findById(999);
        expect(employeeModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
        expect(result).toBeNull();
    });
    it("creates an employee", async () => {
        const entity = new employee_entity_1.EmployeeEntity(0, "Bob", "Seoul", "010-0000-0000", "B", false, new Date("2024-02-01T00:00:00.000Z"));
        const createdRow = { ...baseRow, id: 5, name: "Bob", work_area: "Seoul", open_to_next_work: false, company_registered_date: entity.registeredDate };
        employeeModel.create.mockResolvedValue(createdRow);
        const result = await repository.create(entity);
        expect(employeeModel.create).toHaveBeenCalledWith({
            data: {
                id: 0,
                name: "Bob",
                work_area: "Seoul",
                phone: "010-0000-0000",
                grade: "B",
                open_to_next_work: false,
                company_registered_date: new Date("2024-02-01T00:00:00.000Z"),
            },
        });
        expect(result).toMatchObject({ id: 5, name: "Bob" });
    });
    it("updates an employee", async () => {
        const entity = new employee_entity_1.EmployeeEntity(7, "Charlie", "Busan", "010-2222-0000", "C", true, new Date("2023-12-31T00:00:00.000Z"));
        const updatedRow = { ...baseRow, id: 7, name: "Charlie", work_area: "Busan", phone: "010-2222-0000", grade: "C" };
        employeeModel.update.mockResolvedValue(updatedRow);
        const result = await repository.update(entity);
        expect(employeeModel.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: {
                name: "Charlie",
                work_area: "Busan",
                phone: "010-2222-0000",
                grade: "C",
                open_to_next_work: true,
            },
        });
        expect(result).toMatchObject({ id: 7, workArea: "Busan" });
    });
    it("deletes an employee", async () => {
        employeeModel.delete.mockResolvedValue(undefined);
        await repository.delete(3);
        expect(employeeModel.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });
    it("lists employees", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow, { ...baseRow, id: 2, name: "Dana" }]);
        const result = await repository.findAll();
        expect(employeeModel.findMany).toHaveBeenCalledWith();
        expect(result).toHaveLength(2);
        expect(result[1]).toMatchObject({ id: 2, name: "Dana" });
    });
    it("filters by work area", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        await repository.findByWorkArea("Incheon");
        expect(employeeModel.findMany).toHaveBeenCalledWith({ where: { work_area: "Incheon" } });
    });
    it("filters by grade", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        await repository.findByGrade("A");
        expect(employeeModel.findMany).toHaveBeenCalledWith({ where: { grade: "A" } });
    });
    it("filters by open status", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        await repository.findByOpenToNextWork(true);
        expect(employeeModel.findMany).toHaveBeenCalledWith({ where: { open_to_next_work: true } });
    });
    it("filters by registered date", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        const date = new Date("2024-05-05T12:00:00.000Z");
        await repository.findByRegisteredDate(date);
        const call = employeeModel.findMany.mock.calls[0][0];
        expect(call.where.company_registered_date.gte).toBeInstanceOf(Date);
        expect(call.where.company_registered_date.lte).toBeInstanceOf(Date);
        expect(call.where.company_registered_date.gte.getTime()).toBeLessThanOrEqual(call.where.company_registered_date.lte.getTime());
    });
    it("filters by registered date range", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        const start = new Date("2024-01-01T00:00:00.000Z");
        const end = new Date("2024-01-31T23:59:59.000Z");
        await repository.findByRegisteredDateRange(start, end);
        expect(employeeModel.findMany).toHaveBeenCalledWith({
            where: {
                company_registered_date: {
                    gte: start,
                    lte: end,
                },
            },
        });
    });
    it("changes open status", async () => {
        employeeModel.update.mockResolvedValue(baseRow);
        await repository.changeOpenToNextWork(10, false);
        expect(employeeModel.update).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { open_to_next_work: false },
        });
    });
    it("finds all open to next work", async () => {
        employeeModel.findMany.mockResolvedValue([baseRow]);
        await repository.findAllOpenToNextWork();
        expect(employeeModel.findMany).toHaveBeenCalledWith({ where: { open_to_next_work: true } });
    });
});
//# sourceMappingURL=sb.employee.repository.spec.js.map