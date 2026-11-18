import { toJobErrorCode } from "domain/value-objects/eformsign-job-error-code";

describe("toJobErrorCode", () => {
    it.each([
        ["VALID_CODE", "VALID_CODE"],
        ["A".repeat(80), "A".repeat(80)],
        ["VALID_CODE:SUFFIX-1", "VALID_CODE:SUFFIX-1"],
        ["template_workflow_missing", "TEMPLATE_WORKFLOW_MISSING"],
        ["REASON:field_name", "REASON:FIELD_NAME"],
        ["A".repeat(81), "A".repeat(80)],
        [" ___:bad reason!", "BAD_REASON_"],
        ["9_code", "9_CODE"],
        ["", "JOB_ERROR_CODE_INVALID"],
        ["___", "JOB_ERROR_CODE_INVALID"],
    ])("normalizes %j to %j", (input, expected) => {
        expect(toJobErrorCode(input)).toBe(expected);
    });
});
