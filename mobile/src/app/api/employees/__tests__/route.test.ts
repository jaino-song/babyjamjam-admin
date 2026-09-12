/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import {
  DELETE as deleteEmployee,
  GET as listEmployees,
  PATCH as updateEmployee,
  POST as createEmployee,
} from "../route";
import { GET as checkEmployeePhone } from "../check-phone/route";

async function expectCanonicalValidationResponse(
  response: Response,
  legacyError: string,
): Promise<void> {
  expect(response.status).toBe(400);
  const requestId = response.headers.get("X-Request-Id");
  expect(requestId).toEqual(expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(response.headers.get("Content-Language")).toBe("ko-KR");
  expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");

  const body = await response.json();
  expect(body).toMatchObject({
    code: "VALIDATION_FAILED",
    outcome: "NOT_APPLIED",
    error: legacyError,
    requestId,
  });
  expect(Array.isArray(body.errors)).toBe(true);
}

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("employee API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and sanitizes payload when listing employees", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "employee access denied" },
      },
    });

    const response = await listEmployees(createRequest("/api/employees"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: expect.stringMatching(/[가-힣].*요[.!]?$/) });
  });

  const validCreatePayload = {
    name: "Kim",
    workArea: ["서울"],
    phone: "01000000000",
    grade: "스탠다드",
    openToNextWork: true,
  };

  it("preserves backend status and payload when creating employees", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreatePayload),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/employees",
      validCreatePayload,
      expect.anything(),
    );
  });

  it("surfaces a safe backend validation message through the employee error mapper", async () => {
    const message = "전화번호 형식이 올바르지 않습니다.";
    mockPost.mockRejectedValue({
      response: {
        status: 400,
        data: { message, error: "Bad Request" },
      },
    });

    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreatePayload),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "전화번호 형식이 올바르지 않아요." });
    expect(getErrorMessage({ response: { status: 400, data: body } }, "ko")).toBe(body.error);
  });

  it("preserves message-less Prisma metadata for localized phone conflicts", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "P2002",
          error: "Conflict",
          field: "phone",
        },
      },
    });

    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreatePayload),
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: expect.stringMatching(/[가-힣].*요[.!]?$/),
      code: "P2002",
      field: "phone",
    });
    expect(getErrorMessage({ response: { status: 409, data: body } }, "ko")).toBe(
      "연락처 정보가 이미 등록돼 있어요.",
    );
  });

  it("rejects a create body missing required fields before proxying", async () => {
    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Kim" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards a valid partial update body to the backend", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: 10, name: "Lee" },
    });

    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lee" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 10, name: "Lee" });
    expect(mockPatch).toHaveBeenCalledWith(
      "/employees",
      { name: "Lee" },
      { params: { id: "10" }, headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects an update body with a mistyped field before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects invalid update IDs before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lee" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects invalid delete IDs before proxying", async () => {
    const response = await deleteEmployee(
      createRequest("/api/employees?id=0", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("preserves backend empty delete responses", async () => {
    mockDelete.mockResolvedValue({
      status: 204,
      data: null,
    });

    const response = await deleteEmployee(
      createRequest("/api/employees?id=10", { method: "DELETE" }),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("preserves the employee deletion conflict guidance", async () => {
    mockDelete.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: "진행 중인 배정이 있는 직원은 삭제할 수 없어요.",
          error: "Conflict",
        },
      },
    });

    const response = await deleteEmployee(
      createRequest("/api/employees?id=10", { method: "DELETE" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "진행 중인 배정이 있는 직원은 삭제할 수 없어요.",
    });
  });

  it("preserves a converted problem body for delete conflicts instead of flattening it", async () => {
    mockDelete.mockRejectedValue({
      response: {
        status: 409,
        data: {
          type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#employee-active-assignment-blocked",
          title: "진행 중인 배정이 있어요",
          status: 409,
          detail: "진행 중인 배정이 있는 관리사는 삭제할 수 없어요. 배정 종료 또는 교체 후 다시 시도해 주세요.",
          code: "EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED",
          requestId: "req-emp-409",
          params: {},
          outcome: "NOT_APPLIED",
          recovery: { action: "NONE", retry: { mode: "NEVER" } },
        },
      },
    });

    const response = await deleteEmployee(
      createRequest("/api/employees?id=10", { method: "DELETE" }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED");
    expect(body.requestId).toBe("req-emp-409");
  });

  describe("check-phone", () => {
    it("rejects check-phone without auth_token", async () => {
      const request = new NextRequest("http://localhost/api/employees/check-phone?phone=01000000000");
      const response = await checkEmployeePhone(request);
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("keeps a missing phone a valid negative answer", async () => {
      const response = await checkEmployeePhone(
        new NextRequest("http://localhost/api/employees/check-phone", {
          headers: { cookie: "auth_token=auth-token" },
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ exists: false });
      expect(mockGet).not.toHaveBeenCalled();
    });

    // 업스트림 실패는 `exists: false`로 위장되지 않고 공유 sanitizer로
    // 전달되어 폼의 재시도 UI(hasPhoneDuplicateCheckFailed)가 동작한다.
    it("must NOT mask an upstream failure as a negative answer", async () => {
      mockGet.mockRejectedValue({
        response: {
          status: 500,
          data: { error: "upstream boom" },
        },
      });

      const response = await checkEmployeePhone(
        new NextRequest("http://localhost/api/employees/check-phone?phone=01096411878", {
          headers: { cookie: "auth_token=auth-token" },
        }),
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).not.toEqual({ exists: false });
      expect(body.error).toBeTruthy();
    });
  });
});
