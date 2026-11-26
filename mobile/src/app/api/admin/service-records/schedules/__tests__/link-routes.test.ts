/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as readTargets } from "../../client/[clientId]/route";
import { POST as resetLink } from "../[scheduleId]/reset-link/route";
import { POST as prepareLink } from "../[scheduleId]/prepare-link/route";
import { POST as sendLink } from "../[scheduleId]/send-link/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
        get: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/admin/service-records/schedules/11/reset-link", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("mobile service-record reset link proxy", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("resets the link without sending a message", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: {
                serviceRecordUrl: "https://mobile.test/service-record/token-1",
                expiresAt: "2026-07-20T00:00:00.000Z",
            },
        });

        const response = await resetLink(createRequest(), {
            params: Promise.resolve({ scheduleId: "11" }),
        });

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/schedules/11/reset-link",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
        expect(mockPost).not.toHaveBeenCalledWith(
            expect.stringContaining("/send-link"),
            expect.anything(),
            expect.anything(),
        );
    });

    it("requires authentication", async () => {
        const response = await resetLink(createRequest(false), {
            params: Promise.resolve({ scheduleId: "11" }),
        });

        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects a non-positive schedule id with a VALIDATION_FAILED problem", async () => {
        const response = await resetLink(createRequest(), {
            params: Promise.resolve({ scheduleId: "abc" }),
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("content-language")).toBe("ko-KR");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid schedule id",
            errors: [{
                pointer: "/scheduleId",
                code: "INVALID_FORMAT",
                detail: "입력 형식이 올바르지 않아요.",
                location: "path",
            }],
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });
});

const firstCase = "10000000-0000-4000-8000-000000000001";
const secondCase = "10000000-0000-4000-8000-000000000002";
const tokenA = `efl_${"A".repeat(43)}`;
const tokenB = `efl_${"B".repeat(43)}`;
const auth = { headers: { Authorization: "Bearer token-1" } };

function linkRequest(action: string, body: object, authenticated = true) {
    return new NextRequest(`http://localhost/api/admin/service-records/schedules/11/${action}-link`, {
        method: "POST",
        headers: { ...(authenticated ? { cookie: "auth_token=token-1" } : {}), "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}
const context = { params: Promise.resolve({ scheduleId: "11" }) };

it("grouped prepare and send forward only the frozen member fields", async () => {
    mockPost.mockReset().mockResolvedValue({ status: 201, data: { ok: true } });
    const caseIds = [firstCase, secondCase];
    const members = [
        { caseId: firstCase, assignmentVersion: 3, preparedLinkToken: tokenA },
        { caseId: secondCase, assignmentVersion: 7, preparedLinkToken: tokenB },
    ];
    const prepare = await prepareLink(linkRequest("prepare", { employeeId: 31, caseIds, previewContent: "ignore" }), context);
    expect(prepare.status).toBe(201);
    const send = await sendLink(linkRequest("send", {
        employeeId: 31, members: members.map((member) => ({ ...member, phone: "ignore", employeeId: 32 })),
    }), context);
    expect(send.status).toBe(201);
    expect(mockPost.mock.calls).toEqual([
        ["/admin/service-records/schedules/11/prepare-link", { employeeId: 31, caseIds }, auth],
        ["/admin/service-records/schedules/11/send-link", { employeeId: 31, members }, auth],
    ]);
    expect((await sendLink(linkRequest("send", { employeeId: 31, members, caseId: firstCase }), context)).status).toBe(400);
    expect((await sendLink(linkRequest("send", { employeeId: 31, members }, false), context)).status).toBe(401);
    expect((await sendLink(linkRequest("send", { employeeId: 31, members: [members[0], members[0]] }), context)).status).toBe(400);
    expect(mockPost).toHaveBeenCalledTimes(2);
});

it("a targeted reset keeps the requested case and version", async () => {
    const member = { caseId: secondCase, assignmentVersion: 7 };
    const result = { kind: "group", employeeId: 32, members: [{ ...member, serviceRecordUrl: "https://mobile.test/second" }] };
    mockPost.mockReset().mockResolvedValue({ status: 201, data: result });
    const response = await resetLink(linkRequest("reset", {
        employeeId: 32, members: [{ ...member, serviceRecordUrl: "ignore", preparedLinkToken: tokenB }], extra: true,
    }), context);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(result);
    expect(mockPost).toHaveBeenCalledWith("/admin/service-records/schedules/11/reset-link", { employeeId: 32, members: [member] }, auth);
    expect((await resetLink(linkRequest("reset", { employeeId: 32, members: [{ ...member, assignmentVersion: 0 }] }), context)).status).toBe(400);
    expect((await resetLink(linkRequest("reset", { employeeId: 32, members: [member], recipientPhone: "01000000000" }), context)).status).toBe(400);
    expect(mockPost).toHaveBeenCalledTimes(1);
});

it("the authenticated overview keeps the selected case and its membership version", async () => {
    const projection = { cases: [{
        caseId: secondCase, linkAssignments: [{ scheduleId: 11, employeeId: 32, assignmentVersion: 7 }],
    }] };
    const get = jest.mocked(serverAPIClient.get);
    get.mockReset().mockResolvedValue({ status: 200, data: projection });
    const url = `http://localhost/api/admin/service-records/client/13?caseId=${secondCase}&employeeId=31`;
    const params = { params: Promise.resolve({ clientId: "13" }) };
    const response = await readTargets(new NextRequest(url, { headers: { cookie: "auth_token=token-1" } }), params);
    expect(get).toHaveBeenCalledWith(`/admin/service-records/client/13?caseId=${secondCase}`, auth);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(projection);
    expect((await readTargets(new NextRequest(url), params)).status).toBe(401);
    const ambiguous = new NextRequest(`${url}&caseId=${firstCase}`, { headers: { cookie: "auth_token=token-1" } });
    expect((await readTargets(ambiguous, params)).status).toBe(400);
    expect(get).toHaveBeenCalledTimes(1);
});
