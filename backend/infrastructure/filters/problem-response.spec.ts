import { BadRequestException, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";

import { mapHttpProblem, sendProblemResponse } from "./problem-response";

function context(method = "POST") {
    const response = {
        locals: {},
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
    };
    return { response, request: { method } as Request };
}

describe("HTTP problem boundary", () => {
    it("preserves every validation pointer without exposing raw diagnostics", () => {
        const { request, response } = context();
        const error = new BadRequestException({
            code: "VALIDATION_FAILED",
            errors: ["/phone", "/name"].map((pointer) => ({ pointer, code: "REQUIRED", detail: "secret input", location: "body" })),
            outcome: "NOT_APPLIED",
            message: "password=secret",
        });
        const result = mapHttpProblem(error, request, response as unknown as Response);
        expect(result).toMatchObject({ code: "VALIDATION_FAILED", status: 400, outcome: "NOT_APPLIED" });
        expect(result?.errors?.map((field) => field.pointer)).toEqual(["/phone", "/name"]);
        expect(JSON.stringify(result)).not.toContain("secret");
    });

    it("does not infer rollback from an unexpected mutation failure", () => {
        const { request, response } = context();
        const cause = new Error("SQL private data");
        const result = mapHttpProblem(cause, request, response as unknown as Response);
        expect(result).toMatchObject({ code: "INTERNAL_ERROR", outcome: "UNKNOWN" });
        expect(JSON.stringify(result)).not.toContain("SQL");
        expect(cause.message).toBe("SQL private data");
    });

    it("does not attach a mutation outcome to a read error", () => {
        const { request, response } = context("GET");
        expect(mapHttpProblem(new Error(), request, response as unknown as Response)?.outcome).toBeUndefined();
    });

    it("keeps unconverted business rejections on their existing compatibility path", () => {
        const { request, response } = context();
        expect(mapHttpProblem(new BadRequestException("Known business reason"), request, response as unknown as Response)).toBeNull();
    });

    it("retains a confirmed service-unavailable status", () => {
        const { request, response } = context();
        expect(mapHttpProblem(new HttpException("private upstream details", 503), request, response as unknown as Response))
            .toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE", outcome: "UNKNOWN" });
    });

    it("uses one real request reference and disables caching", () => {
        const { request, response } = context();
        const result = mapHttpProblem(new Error(), request, response as unknown as Response)!;
        sendProblemResponse(response as unknown as Response, result);
        expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.setHeader).toHaveBeenCalledWith("X-Request-Id", result.requestId);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ requestId: result.requestId, message: result.detail }));
        expect(mapHttpProblem(new Error(), request, response as unknown as Response)?.requestId).toBe(result.requestId);
    });
});
