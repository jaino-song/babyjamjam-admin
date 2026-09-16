import { BadRequestException } from "@nestjs/common";
import { assertEmployeeAssignmentEligibility, type EmployeeAssignmentCandidate } from "./employee-assignment-eligibility.policy";

const employee = (overrides: Partial<EmployeeAssignmentCandidate> = {}): EmployeeAssignmentCandidate => ({
    id: 1, branchId: "branch-a", deletedAt: null, openToNextWork: false, ...overrides,
});
const denial = (employees: EmployeeAssignmentCandidate[], secondary: number | null = null) => {
    try {
        assertEmployeeAssignmentEligibility("branch-a", 1, secondary, employees);
        throw new Error("Expected rejection");
    } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        return (error as BadRequestException).getResponse();
    }
};

describe("assignment availability explanation", () => {
    it("explains disabled next-service assignment using a safe public code", () => {
        expect(denial([employee()])).toEqual({ code: "EMPLOYEE_ASSIGNMENT_UNAVAILABLE", outcome: "NOT_APPLIED" });
    });
    it.each([
        [],
        [employee({ branchId: "other" })],
        [employee({ deletedAt: new Date() })],
    ])("does not disclose availability for missing, foreign or deleted employees", (...employees) => {
        expect(denial(employees)).not.toHaveProperty("code", "EMPLOYEE_ASSIGNMENT_UNAVAILABLE");
    });
    it("checks every employee's branch before disclosing the primary employee's availability", () => {
        expect(denial([employee(), employee({ id: 2, branchId: "other" })], 2)).not.toHaveProperty("code");
    });
    it("keeps retained disabled employees and available new employees eligible", () => {
        expect(() => assertEmployeeAssignmentEligibility("branch-a", 1, null, [employee()], new Set([1]))).not.toThrow();
        expect(() => assertEmployeeAssignmentEligibility("branch-a", 1, null, [employee({ openToNextWork: true })])).not.toThrow();
    });
});
