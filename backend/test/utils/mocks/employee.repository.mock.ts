import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";

/**
 * 테스트용 Mock Employee Repository
 * In-memory 저장소로 동작하며, 테스트 간 독립성 보장
 */
export class MockEmployeeRepository implements IEmployeeRepository {
    private employees: Map<number, EmployeeEntity> = new Map();
    private nextId: number = 1;

    /**
     * 테스트 데이터 초기화
     */
    reset(): void {
        this.employees.clear();
        this.nextId = 1;
    }

    /**
     * 테스트 데이터 직접 설정
     */
    setData(employees: EmployeeEntity[]): void {
        this.employees.clear();
        employees.forEach(employee => {
            this.employees.set(employee.id, employee);
            if (employee.id >= this.nextId) {
                this.nextId = employee.id + 1;
            }
        });
    }

    /**
     * 저장된 모든 데이터 조회 (테스트 검증용)
     */
    getAllData(): EmployeeEntity[] {
        return Array.from(this.employees.values());
    }

    async findById(_organizationid: string, id: number): Promise<EmployeeEntity | null> {
        return this.employees.get(id) ?? null;
    }

    async findAll(_organizationid: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values());
    }

    async create(_organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const id = employee.id > 0 ? employee.id : this.nextId++;
        const newEmployee = EmployeeEntity.reconstitute(
            id,
            employee.name,
            employee.workArea,
            employee.phone,
            employee.grade,
            employee.openToNextWork,
            employee.registeredDate,
        );
        this.employees.set(id, newEmployee);
        return newEmployee;
    }

    async update(_organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        if (!this.employees.has(employee.id)) {
            throw new Error(`Employee with id ${employee.id} not found`);
        }
        this.employees.set(employee.id, employee);
        return employee;
    }

    async delete(_organizationid: string, id: number): Promise<void> {
        if (!this.employees.has(id)) {
            throw new Error(`Employee with id ${id} not found`);
        }
        this.employees.delete(id);
    }

    async findByWorkArea(_organizationid: string, workArea: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(employee =>
            employee.workArea.includes(workArea),
        );
    }

    async findByGrade(_organizationid: string, grade: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.grade === grade,
        );
    }

    async findByOpenToNextWork(
        _organizationid: string,
        openToNextWork: boolean
    ): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.openToNextWork === openToNextWork,
        );
    }

    async findByRegisteredDate(_organizationid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee =>
                employee.registeredDate.toDateString() === registeredDate.toDateString(),
        );
    }

    async findByRegisteredDateRange(
        _organizationid: string,
        startDate: Date,
        endDate: Date,
    ): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee =>
                employee.registeredDate >= startDate &&
                employee.registeredDate <= endDate,
        );
    }

    async changeOpenToNextWork(
        _organizationid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<void> {
        const employee = this.employees.get(id);
        if (!employee) {
            throw new Error(`Employee with id ${id} not found`);
        }
        const updated = EmployeeEntity.reconstitute(
            employee.id,
            employee.name,
            employee.workArea,
            employee.phone,
            employee.grade,
            openToNextWork,
            employee.registeredDate,
        );
        this.employees.set(id, updated);
    }

    async findAllOpenToNextWork(_organizationid: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.openToNextWork === true,
        );
    }
}
