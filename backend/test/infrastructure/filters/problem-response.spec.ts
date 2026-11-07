import { ConflictException } from "@nestjs/common";
import type { Request, Response } from "express";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { mapHttpProblem, sendProblemResponse } from "infrastructure/filters/problem-response";

describe("problem response startDateLock passthrough", () => {
    it.each([0, 3])("preserves the lock extension with %s recorded sessions through the HTTP body", (recordedSessionCount) => {
        const startDateLock = { serviceStarted: true, recordedSessionCount };
        const exception = new ConflictException({ ...codeOnlyProblemBody("SERVICE_RECORD_START_DATE_LOCKED"), startDateLock });
        const response = { locals: {}, setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const problem = mapHttpProblem(exception, { method: "PATCH", acceptsLanguages: () => "ko-KR" } as unknown as Request, response as unknown as Response);
        expect(problem).toMatchObject({ status: 409, code: "SERVICE_RECORD_START_DATE_LOCKED", startDateLock });
        sendProblemResponse(response as unknown as Response, problem!);
        expect(response.status).toHaveBeenCalledWith(409);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ status: 409, startDateLock }));
    });
});
