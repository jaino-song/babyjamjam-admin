import { DeleteEmployeeUsecase } from "application/usecases/employee/delete-employee.usecase";
import type { Request, Response } from "express";
import { normalizeApiError, PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";
import { mapHttpProblem, sendProblemResponse } from "../../../infrastructure/filters/problem-response";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("DeleteEmployeeUsecase", () => {
    let usecase: DeleteEmployeeUsecase;
    let mockRepository: MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "hasActiveAssignments">;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository() as MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "hasActiveAssignments">;
        mockRepository.hasActiveAssignments = jest.fn().mockResolvedValue(false);
        usecase = new DeleteEmployeeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should reject deletion when the employee has an active assignment", async () => {
            const employee = EmployeeFactory.create({ id: 1 });
            mockRepository.setData([employee]);
            jest.mocked(mockRepository.hasActiveAssignments!).mockResolvedValue(true);

            await expect(usecase.execute(branchId, 1)).rejects.toMatchObject({
                status: 409,
                response: {
                    code: "EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                },
            });
            expect(await mockRepository.findById(branchId, 1)).toBe(employee);
        });
        // ============================================
        // Successful Deletion
        // ============================================
        describe("successful deletion", () => {
            it("should delete an existing employee", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                const result = await mockRepository.findById(branchId, 1);
                expect(result).toBeNull();
            });

            it("should return void on successful deletion", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1);

                // Assert
                expect(result).toBeUndefined();
            });

            it("should only delete specified employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(5);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 3);

                // Assert
                const allEmployees = mockRepository.getAllData();
                expect(allEmployees).toHaveLength(4);
                expect(allEmployees.map(e => e.id)).not.toContain(3);
                expect(allEmployees.map(e => e.id)).toContain(1);
                expect(allEmployees.map(e => e.id)).toContain(2);
                expect(allEmployees.map(e => e.id)).toContain(4);
                expect(allEmployees.map(e => e.id)).toContain(5);
            });

            it("should allow deleting first employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(2);
                expect(await mockRepository.findById(branchId, 1)).toBeNull();
            });

            it("should allow deleting last employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 3);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(2);
                expect(await mockRepository.findById(branchId, 3)).toBeNull();
            });
        });

        // ============================================
        // Error Handling
        // ============================================
        describe("error handling", () => {
            it("should throw error when employee not found", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 999)).rejects.toThrow();
            });

            it("should throw the not-found problem body without id details", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 42)).rejects.toMatchObject({
                    status: 404,
                    response: {
                        code: "RESOURCE_NOT_FOUND",
                        params: {},
                        outcome: "NOT_APPLIED",
                        recovery: { action: "NONE", retry: { mode: "NEVER" } },
                    },
                });
                await expect(usecase.execute(branchId, 42)).rejects.not.toMatchObject({
                    message: expect.stringContaining("42"),
                });
            });

            it("should not affect other employees when deletion fails", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);
                const beforeCount = mockRepository.getAllData().length;

                // Act
                try {
                    await usecase.execute(branchId, 999);
                } catch {
                    // Expected
                }

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(beforeCount);
            });
        });

        // ============================================
        // Edge Cases
        // ============================================
        describe("edge cases", () => {
            it("should handle deleting the only employee", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(0);
            });

            it("should not allow double deletion", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act - first deletion should succeed
                await usecase.execute(branchId, 1);

                // Assert - second deletion should fail
                await expect(usecase.execute(branchId, 1)).rejects.toThrow();
            });
        });

        it("routes the 404 and 409 problems through the public problem response", async () => {
            // 대표 원인 두 개(미존재 404, 진행 중인 배정 409)가 공개 계약 경로
            // (mapHttpProblem → sendProblemResponse → normalizeApiError)를 온전히 통과한다.
            const notFound: unknown = await usecase.execute(branchId, 991).catch((error: unknown) => error);
            mockRepository.setData([EmployeeFactory.create({ id: 1 })]);
            jest.mocked(mockRepository.hasActiveAssignments).mockResolvedValue(true);
            const conflict: unknown = await usecase.execute(branchId, 1).catch((error: unknown) => error);

            const cases = [
                { exception: notFound, code: "RESOURCE_NOT_FOUND", status: 404, privateValues: [] as string[] },
                { exception: conflict, code: "EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED", status: 409, privateValues: [] as string[] },
            ] as const;

            for (const locale of ["ko-KR", "en-US"] as const) {
                const requestId = `test-employee-delete-problem-${locale}`;
                const bodies: unknown[] = [];
                const mapped = cases.map((c) => {
                    const responseStub = {
                        locals: { errorRequestId: requestId },
                        setHeader: jest.fn(),
                        status: jest.fn().mockReturnThis(),
                        json: jest.fn(),
                    };
                    const problem = mapHttpProblem(c.exception,
                        { method: "DELETE", acceptsLanguages: () => locale } as unknown as Request,
                        responseStub as unknown as Response);
                    if (!problem) throw new Error(`Expected a registered problem for ${c.code}`);
                    sendProblemResponse(responseStub as unknown as Response, problem);
                    expect(responseStub.status).toHaveBeenCalledWith(c.status);
                    expect(responseStub.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
                    expect(responseStub.setHeader).toHaveBeenCalledWith("Content-Language", locale);
                    expect(responseStub.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
                    expect(responseStub.setHeader).toHaveBeenCalledWith("X-Request-Id", requestId);
                    bodies.push(responseStub.json.mock.calls[0]?.[0]);
                    return problem;
                });

                for (const [index, c] of cases.entries()) {
                    expect(mapped[index]).toMatchObject({
                        code: c.code, status: c.status, requestId, params: {},
                        outcome: "NOT_APPLIED",
                        detail: PROBLEM_CATALOG[c.code].detail[locale],
                        title: PROBLEM_CATALOG[c.code].title[locale],
                        recovery: { action: "NONE", retry: { mode: "NEVER" } },
                    });
                }

                const normalized = normalizeApiError(
                    { response: { status: 409, data: bodies[1] } },
                    { operation: "mutation", locale },
                );
                expect(normalized).toMatchObject({ verified: true, outcome: "NOT_APPLIED", problem: { requestId } });
                expect(normalized.message).toBe(PROBLEM_CATALOG.EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED.detail[locale]);

                // 직원 식별자와 내부 문구는 공개 본문에 노출되지 않는다.
                const serialized = JSON.stringify(bodies);
                for (const privateValue of ["991", "employee repository", ...cases.flatMap((c) => c.privateValues)]) {
                    expect(serialized).not.toContain(privateValue);
                }
            }
        });
    });
});
