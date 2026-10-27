/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { GET as getDraft, POST as startDraft } from "../client/[clientId]/draft/route";
import { GET as getEditor } from "../client/[clientId]/editor/route";
import { PATCH as updateDraft } from "../drafts/[draftId]/route";
import { POST as confirmDraft } from "../drafts/[draftId]/confirm/route";
import { POST as discardDraft } from "../drafts/[draftId]/discard/route";
import { POST as previewDraft } from "../drafts/[draftId]/preview/route";
import { PATCH as updateClient } from "../../../clients/[id]/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, method: string, body?: unknown, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
}

const clientParams = { params: Promise.resolve({ clientId: "12" }) };
const draftParams = { params: Promise.resolve({ draftId: "draft-1" }) };
const authHeaders = { headers: { Authorization: "Bearer token-1" } };

function conflictProblem() {
    const problem = createProblemDetails({ code: "REQUEST_CONFLICT", requestId: "req-1", outcome: "NOT_APPLIED" });
    return { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail };
}

function validationProblem() {
    const problem = createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId: "req-2",
        outcome: "NOT_APPLIED",
        errors: [{ pointer: "/changes", code: "INVALID_VALUE", detail: "제공기록 일정 변경을 적용할 수 없어요.", location: "body" }],
    });
    return { ...problem, statusCode: problem.status, message: "backend internal wording", error: problem.detail };
}

describe("mobile service-record draft proxies", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    describe("status and body passthrough", () => {
        it("reads the editor overview", async () => {
            mockGet.mockResolvedValue({ status: 200, data: { serviceDays: { saturday: true }, assignments: [] } });

            const response = await getEditor(createRequest("/x", "GET"), clientParams);

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            await expect(response.json()).resolves.toEqual({ serviceDays: { saturday: true }, assignments: [] });
            expect(mockGet).toHaveBeenCalledWith("/admin/service-records/client/12/editor", authHeaders);
        });

        it("reads the draft state", async () => {
            mockGet.mockResolvedValue({ status: 200, data: { draft: null, sourceFingerprint: "fp" } });

            const response = await getDraft(createRequest("/x", "GET"), clientParams);

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ draft: null, sourceFingerprint: "fp" });
            expect(mockGet).toHaveBeenCalledWith("/admin/service-records/client/12/draft", authHeaders);
        });

        it("starts a draft with the posted body and keeps the upstream status", async () => {
            mockPost.mockResolvedValue({ status: 201, data: { draft: { id: "draft-1" } } });

            const response = await startDraft(createRequest("/x", "POST", {}), clientParams);

            expect(response.status).toBe(201);
            await expect(response.json()).resolves.toEqual({ draft: { id: "draft-1" } });
            expect(mockPost).toHaveBeenCalledWith("/admin/service-records/client/12/draft", {}, authHeaders);
        });

        it("forwards the whole-set schedule of a draft save", async () => {
            mockPatch.mockResolvedValue({ status: 200, data: { draft: { id: "draft-1", draftVersion: 2 } } });
            const body = {
                expectedDraftVersion: 1,
                changes: {},
                schedule: { serviceDays: { saturday: true, sunday: false, holiday: false }, dates: ["2026-12-14"] },
            };

            const response = await updateDraft(createRequest("/x", "PATCH", body), draftParams);

            expect(response.status).toBe(200);
            expect(mockPatch).toHaveBeenCalledWith("/admin/service-records/drafts/draft-1", body, authHeaders);
        });

        it.each([
            ["preview", previewDraft],
            ["discard", discardDraft],
            ["confirm", confirmDraft],
        ] as const)("posts a draft %s", async (operation, handler) => {
            mockPost.mockResolvedValue({ status: 200, data: { ok: operation } });

            const response = await handler(createRequest("/x", "POST", { expectedDraftVersion: 2 }), draftParams);

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ ok: operation });
            expect(mockPost).toHaveBeenCalledWith(
                `/admin/service-records/drafts/draft-1/${operation}`,
                { expectedDraftVersion: 2 },
                authHeaders,
            );
        });
    });

    describe("guards", () => {
        it("requires authentication on every route", async () => {
            const unauthenticated = (method: string) => createRequest("/x", method, method === "GET" ? undefined : {}, false);
            const responses = await Promise.all([
                getEditor(unauthenticated("GET"), clientParams),
                getDraft(unauthenticated("GET"), clientParams),
                startDraft(unauthenticated("POST"), clientParams),
                updateDraft(unauthenticated("PATCH"), draftParams),
                previewDraft(unauthenticated("POST"), draftParams),
                discardDraft(unauthenticated("POST"), draftParams),
                confirmDraft(unauthenticated("POST"), draftParams),
            ]);

            for (const response of responses) {
                expect(response.status).toBe(401);
                await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
            }
            expect(mockGet).not.toHaveBeenCalled();
            expect(mockPost).not.toHaveBeenCalled();
            expect(mockPatch).not.toHaveBeenCalled();
        });

        it("rejects a non-numeric client id before contacting the backend", async () => {
            const response = await getEditor(createRequest("/x", "GET"), { params: Promise.resolve({ clientId: "abc" }) });

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
            expect(mockGet).not.toHaveBeenCalled();
        });

        it("rejects a body that is not a JSON object", async () => {
            const response = await updateDraft(createRequest("/x", "PATCH", "[1,2,3]"), draftParams);

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
            expect(mockPatch).not.toHaveBeenCalled();
        });
    });

    describe("schedule extensions on errors", () => {
        it("keeps the scheduleCode of a refused draft save and still drops unknown members", async () => {
            mockPatch.mockRejectedValue({
                response: {
                    status: 400,
                    data: {
                        ...validationProblem(),
                        scheduleCode: "SCHEDULE_COUNT_MISMATCH",
                        sessionIndex: 3,
                        stack: "at secret.ts:1",
                        internalNote: "do not leak",
                    },
                },
            });

            const response = await updateDraft(createRequest("/x", "PATCH", { expectedDraftVersion: 1, changes: {} }), draftParams);

            expect(response.status).toBe(400);
            const body = await response.json();
            expect(body).toMatchObject({ code: "VALIDATION_FAILED", scheduleCode: "SCHEDULE_COUNT_MISMATCH" });
            const serialized = JSON.stringify(body);
            expect(serialized).not.toContain("at secret.ts");
            expect(serialized).not.toContain("do not leak");
            expect(serialized).not.toContain("backend internal wording");
            expect(body).not.toHaveProperty("stack");
            expect(body).not.toHaveProperty("internalNote");
        });

        it("drops a scheduleCode that is not on the allow-list", async () => {
            mockPatch.mockRejectedValue({
                response: { status: 400, data: { ...validationProblem(), scheduleCode: "rm -rf / <script>" } },
            });

            const response = await updateDraft(createRequest("/x", "PATCH", { expectedDraftVersion: 1, changes: {} }), draftParams);

            expect(response.status).toBe(400);
            expect(await response.json()).not.toHaveProperty("scheduleCode");
        });

        it("drops the scheduleCode of a status other than 400/409", async () => {
            mockPatch.mockRejectedValue({
                response: { status: 500, data: { scheduleCode: "SCHEDULE_COUNT_MISMATCH" } },
            });

            const response = await updateDraft(createRequest("/x", "PATCH", { expectedDraftVersion: 1, changes: {} }), draftParams);

            expect(response.status).toBe(500);
            expect(await response.json()).not.toHaveProperty("scheduleCode");
        });

        it("keeps validated blockingReasons on a confirm 409, reduced to code and sessionIndex", async () => {
            mockPost.mockRejectedValue({
                response: {
                    status: 409,
                    data: {
                        ...conflictProblem(),
                        blockingReasons: [
                            { code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3, message: "private wording", assignmentId: "a-1" },
                            { code: "lower case", sessionIndex: 1 },
                            { code: "NON_SERVICE_DAY", sessionIndex: -4 },
                            "not an object",
                        ],
                    },
                },
            });

            const response = await confirmDraft(
                createRequest("/x", "POST", { expectedDraftVersion: 1, previewId: "p", idempotencyKey: "k" }),
                draftParams,
            );

            expect(response.status).toBe(409);
            const body = await response.json();
            expect(body).toMatchObject({ code: "REQUEST_CONFLICT" });
            expect(body.blockingReasons).toEqual([
                { code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 },
                { code: "NON_SERVICE_DAY" },
            ]);
            expect(JSON.stringify(body)).not.toContain("private wording");
        });

        it("does not invent blockingReasons for a plain version conflict", async () => {
            mockPost.mockRejectedValue({ response: { status: 409, data: conflictProblem() } });

            const response = await previewDraft(createRequest("/x", "POST", { expectedDraftVersion: 1 }), draftParams);

            expect(response.status).toBe(409);
            expect(await response.json()).not.toHaveProperty("blockingReasons");
        });
    });

    describe("client update proxy", () => {
        const clientIdParams = { params: Promise.resolve({ id: "12" }) };

        it("keeps REALIGNMENT_REQUIRES_MANUAL_SCHEDULE on a 409 and nothing else of the extension", async () => {
            mockPatch.mockRejectedValue({
                response: {
                    status: 409,
                    data: {
                        ...conflictProblem(),
                        scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
                        blockingReasons: [{ code: "NON_SERVICE_DAY" }],
                        internalNote: "do not leak",
                    },
                },
            });

            const response = await updateClient(
                createRequest("/api/clients/12", "PATCH", { allowSaturdayService: true }),
                clientIdParams,
            );

            expect(response.status).toBe(409);
            const body = await response.json();
            expect(body).toMatchObject({ code: "REQUEST_CONFLICT", scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" });
            expect(body).not.toHaveProperty("blockingReasons");
            expect(JSON.stringify(body)).not.toContain("do not leak");
        });

        it("drops any other scheduleCode, and the code on a non-409", async () => {
            mockPatch.mockRejectedValue({
                response: { status: 409, data: { ...conflictProblem(), scheduleCode: "SCHEDULE_COUNT_MISMATCH" } },
            });
            const other = await updateClient(createRequest("/api/clients/12", "PATCH", { name: "x" }), clientIdParams);
            expect(other.status).toBe(409);
            expect(await other.json()).not.toHaveProperty("scheduleCode");

            mockPatch.mockRejectedValue({
                response: { status: 400, data: { ...validationProblem(), scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" } },
            });
            const badRequest = await updateClient(createRequest("/api/clients/12", "PATCH", { name: "x" }), clientIdParams);
            expect(badRequest.status).toBe(400);
            expect(await badRequest.json()).not.toHaveProperty("scheduleCode");
        });
    });
});
