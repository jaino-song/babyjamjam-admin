import { BadRequestException } from "@nestjs/common";
import {
    assertEmployeeAssignmentEligibility,
    assertEmployeeAssignmentShape,
    isEmployeeAssignmentEligible,
    type EmployeeAssignmentCandidate,
} from "application/policies/employee-assignment-eligibility.policy";

const branchId = "branch-1";

const eligibleEmployee = (id: number): EmployeeAssignmentCandidate => ({
    id,
    branchId,
    deletedAt: null,
    openToNextWork: true,
});

const catchException = (run: () => void): unknown => {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("Expected the policy call to throw");
};

describe("assertEmployeeAssignmentShape", () => {
    it("accepts a primary without a secondary", () => {
        expect(() => assertEmployeeAssignmentShape(7, null)).not.toThrow();
    });

    it("accepts a primary with a distinct secondary", () => {
        expect(() => assertEmployeeAssignmentShape(7, 9)).not.toThrow();
    });

    it("rejects a secondary without a primary as a VALIDATION_FAILED field problem", () => {
        const error = catchException(() => assertEmployeeAssignmentShape(null, 9)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            errors: [{
                pointer: "/secondaryEmployeeId",
                code: "INVALID_FORMAT",
                detail: "보조 담당 인력을 선택하려면 주 담당 인력이 먼저 필요해요.",
                location: "body",
            }],
        });
    });

    it("rejects the same employee in both roles as a VALIDATION_FAILED field problem", () => {
        const error = catchException(() => assertEmployeeAssignmentShape(7, 7)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            errors: [{
                pointer: "/secondaryEmployeeId",
                code: "INVALID_FORMAT",
                detail: "주담당과 부담당은 같은 직원일 수 없어요.",
                location: "body",
            }],
        });
    });

    it("carries caller-provided pointers so replacement problems name their own body fields", () => {
        const pointers = {
            primary: "/newPrimaryEmployeeId",
            secondary: "/newSecondaryEmployeeId",
        };

        const missingPrimary = catchException(
            () => assertEmployeeAssignmentShape(null, 9, pointers),
        ) as BadRequestException;
        const sameEmployee = catchException(
            () => assertEmployeeAssignmentShape(7, 7, pointers),
        ) as BadRequestException;

        expect(missingPrimary.getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            errors: [{ pointer: "/newSecondaryEmployeeId", code: "INVALID_FORMAT" }],
        });
        expect(sameEmployee.getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            errors: [{ pointer: "/newSecondaryEmployeeId", code: "INVALID_FORMAT" }],
        });
    });
});

describe("isEmployeeAssignmentEligible", () => {
    it("accepts an employee of the branch that is open to next work", () => {
        expect(isEmployeeAssignmentEligible(eligibleEmployee(7), branchId)).toBe(true);
    });

    it("rejects an employee from another branch or a deleted employee", () => {
        expect(isEmployeeAssignmentEligible({ ...eligibleEmployee(7), branchId: "branch-2" }, branchId)).toBe(false);
        expect(isEmployeeAssignmentEligible({ ...eligibleEmployee(7), deletedAt: new Date() }, branchId)).toBe(false);
    });

    it("keeps a retained employee eligible even when not open to next work", () => {
        const employee = { ...eligibleEmployee(7), openToNextWork: false };
        expect(isEmployeeAssignmentEligible(employee, branchId, new Set([7]))).toBe(true);
        expect(isEmployeeAssignmentEligible(employee, branchId)).toBe(false);
    });
});

describe("assertEmployeeAssignmentEligibility", () => {
    it("accepts a null-only assignment", () => {
        expect(() => assertEmployeeAssignmentEligibility(branchId, null, null, [])).not.toThrow();
    });

    it("accepts eligible primary and secondary employees", () => {
        expect(() => assertEmployeeAssignmentEligibility(
            branchId,
            7,
            9,
            [eligibleEmployee(7), eligibleEmployee(9)],
        )).not.toThrow();
    });

    it("accepts retained employees that are not open to next work", () => {
        const retained = { ...eligibleEmployee(9), openToNextWork: false };
        expect(() => assertEmployeeAssignmentEligibility(
            branchId,
            7,
            9,
            [eligibleEmployee(7), retained],
            new Set([9]),
        )).not.toThrow();
    });

    it("rejects an ineligible employee as the registered EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE code-only problem", () => {
        const error = catchException(() => assertEmployeeAssignmentEligibility(
            branchId,
            7,
            null,
            [{ ...eligibleEmployee(7), branchId: "branch-2" }],
        )) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toMatchObject({
            code: "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect((error.getResponse() as Record<string, unknown>)["errors"]).toBeUndefined();
    });

    it("rejects a missing employee as the registered EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE code-only problem", () => {
        const error = catchException(() => assertEmployeeAssignmentEligibility(
            branchId,
            7,
            null,
            [],
        )) as BadRequestException;

        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toMatchObject({ code: "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE" });
    });
});
