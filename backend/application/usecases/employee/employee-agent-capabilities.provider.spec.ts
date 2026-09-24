import { EmployeeEntity } from "domain/entities/employee.entity";
import { EmployeeAgentCapabilitiesProvider } from "./employee-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko",
};

function employee(overrides: Partial<{
    id: number;
    name: string;
    deletedAt: Date;
}> = {}) {
    return EmployeeEntity.reconstitute(
        overrides.id ?? 7,
        overrides.name ?? "홍길동",
        ["서울"],
        "01012345678",
        "A",
        true,
        new Date("2024-01-01T00:00:00.000Z"),
        undefined,
        overrides.deletedAt,
    );
}

describe("EmployeeAgentCapabilitiesProvider", () => {
    function setup(
        findResult: EmployeeEntity | null | ((branchId: string, id: number) => EmployeeEntity | null),
        listResult: EmployeeEntity[] = [],
        listForDateResult: EmployeeEntity[] = [],
    ) {
        const findEmployee = {
            execute: jest.fn().mockImplementation(async (branchId: string, id: number) =>
                typeof findResult === "function" ? findResult(branchId, id) : findResult),
            resolveStatus: jest.fn().mockResolvedValue(undefined),
        };
        const listEmployees = { execute: jest.fn().mockResolvedValue(listResult) };
        const listEmployeesForDate = { execute: jest.fn().mockResolvedValue(listForDateResult) };
        const provider = new EmployeeAgentCapabilitiesProvider(listEmployees as never, findEmployee as never, listEmployeesForDate as never);
        return { findEmployee, listEmployees, listEmployeesForDate, capabilities: provider.getCapabilities() };
    }

    it("accepts the legacy employee id 0 in search output and get input", async () => {
        const match = employee({ id: 0 });
        match.status = "available";
        const { capabilities } = setup(match, [match]);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        const output = await search.execute(context, { query: "홍길동" });
        expect(search.outputSchema.parse(output)).toMatchObject({ kind: "entity", entity: { id: 0 } });
        expect(get.inputSchema.safeParse({ id: 0 }).success).toBe(true);
        expect(get.inputSchema.safeParse({ id: -1 }).success).toBe(false);
    });

    it("returns a discriminated none result for an empty search", async () => {
        const { listEmployees, capabilities } = setup(null);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "없는 직원" })).resolves.toEqual({ kind: "none", query: "없는 직원" });
        expect(listEmployees.execute).toHaveBeenCalledWith("branch-a");
    });

    it("returns one matching employee as an entity result", async () => {
        const match = employee();
        match.status = "available";
        const { capabilities } = setup(null, [match]);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "홍길동" })).resolves.toEqual({
            kind: "entity",
            entity: {
                id: 7,
                name: "홍길동",
                grade: "A",
                workArea: ["서울"],
                openToNextWork: true,
                status: "available",
            },
        });
    });

    it("returns choices for multiple matching employees without exposing phone numbers", async () => {
        const first = employee({ id: 7, name: "홍길동" });
        const second = employee({ id: 8, name: "김길동" });
        const { capabilities } = setup(null, [first, second]);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "길동" })).resolves.toEqual({
            kind: "choices",
            prompt: "어느 직원을 말씀하시는지 선택해 주세요.",
            choices: [{ id: 7, name: "홍길동" }, { id: 8, name: "김길동" }],
        });
    });

    it("returns active employees by id within the requested branch", async () => {
        const { findEmployee, capabilities } = setup((branchId) => branchId === "branch-a" ? employee() : null);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).resolves.toEqual(expect.objectContaining({
            kind: "entity",
            entity: expect.objectContaining({ id: 7, name: "홍길동" }),
        }));
        expect(findEmployee.execute).toHaveBeenCalledWith("branch-a", 7);
    });

    it.each([
        ["missing", null],
        ["soft-deleted", employee({ deletedAt: new Date("2024-02-01T00:00:00.000Z") })],
    ])("fails closed for %s employees", async (_label, result) => {
        const { capabilities } = setup(result);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).rejects.toThrow("Employee not found");
    });

    it("fails closed when the employee belongs to another branch", async () => {
        const { findEmployee, capabilities } = setup((branchId) => branchId === "branch-b" ? employee() : null);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).rejects.toThrow("Employee not found");
        expect(findEmployee.execute).toHaveBeenCalledWith("branch-a", 7);
    });

    it("includes a computed status on employees.get when it can be resolved", async () => {
        const { findEmployee, capabilities } = setup(employee());
        findEmployee.resolveStatus.mockResolvedValue("working");
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).resolves.toMatchObject({
            kind: "entity",
            entity: { id: 7, status: "working" },
        });
        expect(findEmployee.resolveStatus).toHaveBeenCalledWith("branch-a", 7, expect.any(Date));
    });

    it("omits status on employees.get when it cannot be resolved", async () => {
        const { capabilities } = setup(employee());
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        const output = await get.execute(context, { id: 7 }) as { entity: Record<string, unknown> };
        expect(output.entity).not.toHaveProperty("status");
    });

    describe("employees.list", () => {
        function listCapability(listForDateResult: EmployeeEntity[]) {
            const { capabilities, listEmployeesForDate } = setup(null, [], listForDateResult);
            const list = capabilities.find((entry) => entry.meta.name === "employees.list")!;
            return { list, listEmployeesForDate };
        }

        it("defaults to today's Korean calendar date and returns sorted results", async () => {
            const kim = employee({ id: 1, name: "김길동" });
            kim.status = "available";
            const hong = employee({ id: 2, name: "홍길동" });
            hong.status = "working";
            const { list, listEmployeesForDate } = listCapability([hong, kim]);

            const output = await list.execute(context, {}) as {
                date: string; total: number; employees: Array<{ name: string }>;
            };
            expect(output.total).toBe(2);
            expect(output.employees.map((entry) => entry.name)).toEqual(["김길동", "홍길동"]);
            expect(output.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(listEmployeesForDate.execute).toHaveBeenCalledWith("branch-a", expect.any(Date));
        });

        it("uses the Korean calendar date, not the UTC date, as the default at 01:00 KST", async () => {
            jest.useFakeTimers().setSystemTime(new Date("2026-09-24T16:30:00.000Z")); // 2026-09-25 01:30 KST
            try {
                const { list } = listCapability([]);
                const output = await list.execute(context, {}) as { date: string };
                expect(output.date).toBe("2026-09-25");
            } finally {
                jest.useRealTimers();
            }
        });

        it("reports total after filters but before the limit, and excludes non-matching rows", async () => {
            const available = employee({ id: 1, name: "가용" });
            available.status = "available";
            available.grade = "A";
            const working = employee({ id: 2, name: "근무중" });
            working.status = "working";
            working.grade = "A";
            const { list } = listCapability([available, working]);

            const output = await list.execute(context, { status: "available", limit: 1 }) as {
                total: number; employees: unknown[];
            };
            expect(output.total).toBe(1);
            expect(output.employees).toHaveLength(1);
        });

        it("filters by partial work area and exact grade", async () => {
            const seoul = employee({ id: 1, name: "서울직원" });
            seoul.workArea = ["서울 강남구"];
            seoul.grade = "베스트";
            const busan = employee({ id: 2, name: "부산직원" });
            busan.workArea = ["부산"];
            busan.grade = "프리미엄";
            const { list } = listCapability([seoul, busan]);

            const byArea = await list.execute(context, { workArea: "강남" }) as { employees: Array<{ id: number }> };
            expect(byArea.employees.map((entry) => entry.id)).toEqual([1]);

            const byGrade = await list.execute(context, { grade: "프리미엄" }) as { employees: Array<{ id: number }> };
            expect(byGrade.employees.map((entry) => entry.id)).toEqual([2]);
        });
    });
});
