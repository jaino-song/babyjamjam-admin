/**
 * @jest-environment node
 */
import { createProblemDetails, type ProblemCode } from "@babyjamjam/shared/errors/problem-details";
import { NextRequest } from "next/server";

import { POST as adminConfirm } from "@/app/api/admin/service-records/revisions/[revisionId]/documents/[documentStateId]/confirm-no-provider-document/route";
import { POST as adminRetry } from "@/app/api/admin/service-records/revisions/[revisionId]/documents/[documentStateId]/retry/route";
import { initialRegenerationConflictCopy } from "@/features/document-jobs/service-record-recovery-copy";
import { serverAPIClient } from "@/lib/api/server";
import { initialNoProviderDocumentReasonSchema } from "@/lib/eformsign/initial-document-recovery-contract";

import { POST as staffConfirm } from "./confirm-no-provider-document/route";
import { POST as regenerate } from "./regenerate-initial/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const post = jest.mocked(serverAPIClient.post);
const target = {
  revisionId: "11111111-1111-4111-8111-111111111111",
  documentStateId: "22222222-2222-4222-8222-222222222222",
  expectedGeneration: "generation-1",
};
const confirmationBody = { expectedGeneration: target.expectedGeneration };
const confirmationResult = {
  id: target.documentStateId,
  revisionId: target.revisionId,
  generation: target.expectedGeneration,
  operation: "record_snapshot",
  documentVersion: 3,
  status: "failed",
  reasonCode: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT",
};
const regenerateResult = {
  stateId: "33333333-3333-4333-8333-333333333333",
  revisionId: target.revisionId,
  generation: "generation-2",
  jobId: "44444444-4444-4444-8444-444444444444",
  status: "queued",
};

const handlers = [
  {
    name: "staff regenerate",
    endpoint: "/eformsign-docs/jobs/regenerate-initial",
    handler: regenerate,
    body: target,
    result: regenerateResult,
    timeout: {},
  },
  {
    name: "staff confirm",
    endpoint: "/eformsign-docs/jobs/confirm-no-provider-document",
    handler: staffConfirm,
    body: target,
    result: confirmationResult,
    timeout: { timeout: 170_000 },
  },
  {
    name: "admin confirm",
    endpoint: `/admin/service-records/revisions/${target.revisionId}/documents/${target.documentStateId}/confirm-no-provider-document`,
    handler: (request: NextRequest) => adminConfirm(request, { params: Promise.resolve({
      revisionId: target.revisionId, documentStateId: target.documentStateId,
    }) }),
    body: confirmationBody,
    result: confirmationResult,
    timeout: { timeout: 170_000 },
  },
];

function request(endpoint: string, body: unknown, withAuth = true): NextRequest {
  return new NextRequest(`http://localhost/api${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(withAuth && { cookie: "auth_token=fixture-auth" }) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe.each(handlers)("$name BFF", ({ endpoint, handler, body, result, timeout }) => {
  beforeEach(() => post.mockReset());

  it("forwards the exact target with the endpoint timeout", async () => {
    post.mockResolvedValue({
      status: 200,
      data: { ...result, ...("timeout" in timeout && { outputProof: { actorUserId: "private-id" } }) },
    });
    const response = await handler(request(endpoint, body));
    expect(post).toHaveBeenCalledWith(endpoint, body, { headers: { Authorization: "Bearer fixture-auth" }, ...timeout });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(result);
  });

  it("rejects an unauthenticated or forged request before forwarding", async () => {
    expect((await handler(request(endpoint, body, false))).status).toBe(401);
    expect((await handler(request(endpoint, { ...body, branchId: "forged" }))).status).toBe(400);
    expect((await handler(request(endpoint, { ...body, expectedGeneration: "contains spaces" }))).status).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([403, 404, 409, 503, 504])("maps an upstream %s without exposing its body", async status => {
    post.mockRejectedValue({ response: { status, data: { reason: "vendor diagnostic", message: "vendor diagnostic" } } });
    const response = await handler(request(endpoint, body));
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("vendor diagnostic");
  });

  it("maps an Axios timeout to a 504 with an unknown mutation outcome", async () => {
    post.mockRejectedValue({ isAxiosError: true, code: "ECONNABORTED" });
    const response = await handler(request(endpoint, body));
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ code: "UPSTREAM_TIMEOUT", outcome: "UNKNOWN" });
  });

  it("preserves only an allowlisted 409 reason", async () => {
    const confirmation = "timeout" in timeout;
    const reasons = confirmation
      ? initialNoProviderDocumentReasonSchema.options
      : ["SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS", "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED", "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN"];
    for (const reason of reasons) {
      post.mockRejectedValueOnce({ response: {
        status: 409, data: { ...(confirmation ? { code: "REQUEST_CONFLICT", reason } : { code: reason }), extra: "private" },
      } });
      const response = await handler(request(endpoint, body));
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toEqual({ code: "REQUEST_CONFLICT", reason });
    }
  });
});

describe.each(handlers.filter(({ timeout }) => "timeout" in timeout))("$name replay", ({ endpoint, handler, body }) => {
  it.each([
    "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED",
    "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN",
  ])("returns the current outcome %s and strips the original attestation", async reasonCode => {
    const result = { ...confirmationResult, reasonCode };
    post.mockResolvedValueOnce({ status: 200, data: {
      ...result,
      outputProof: { kind: "INITIAL_NO_PROVIDER_DOCUMENT_ATTESTATION", outcome: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH" },
    } });
    const response = await handler(request(endpoint, body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(result);
  });
});

// The staff finalizer emits code-only conflicts. The admin CAS uses the registered problem response.
const regenerateConflictBodies = [
  { code: "SERVICE_RECORD_INITIAL_ACTIVE_KEY_CONFLICT" },
  { code: "SERVICE_RECORD_INITIAL_REVISION_CHANGED" },
  { code: "SERVICE_RECORD_INITIAL_GENERATION_CHANGED" },
  { code: "SERVICE_RECORD_INITIAL_STATE_NOT_FOUND" },
  { code: "SERVICE_RECORD_INITIAL_STATE_NOT_READY" },
  { code: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" },
  { code: "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED" },
  { code: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN" },
  { code: "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS" },
  { code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" },
  { code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" },
  { code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" },
];

it.each(regenerateConflictBodies)("forwards the backend regenerate 409 $code with Korean copy", async data => {
  post.mockRejectedValueOnce({ response: { status: 409, data } });
  const endpoint = "/eformsign-docs/jobs/regenerate-initial";
  const response = await regenerate(request(endpoint, target));
  expect(response.status).toBe(409);
  const conflict = await response.json();
  expect(conflict).toEqual({ code: "REQUEST_CONFLICT", reason: data.code });
  expect(initialRegenerationConflictCopy(conflict.reason)).toMatch(/[가-힣]/);
});

it.each([
  { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", reason: undefined, message: /대상 문서가 바뀌었어요/ },
  { code: "REQUEST_CONFLICT", reason: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE", message: /지금 제공기록지 문서를 생성할 수 없어요/ },
] satisfies Array<{ code: ProblemCode; reason?: string; message: RegExp }>)(
  "preserves the admin conflict $code with Korean copy", async ({ code, reason, message }) => {
  const problem = createProblemDetails({ code, requestId: target.revisionId, locale: "ko-KR", outcome: "NOT_APPLIED" });
  const data = { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail, ...(reason && { reason }) };
  post.mockRejectedValueOnce({ response: { status: problem.status, data } });
  const endpoint = `/admin/service-records/revisions/${target.revisionId}/documents/${target.documentStateId}/retry`;
  const response = await adminRetry(request(endpoint, confirmationBody), { params: Promise.resolve(target) });
  expect(response.status).toBe(409);
  const conflict = await response.json();
  expect(conflict).toEqual({ code: "REQUEST_CONFLICT", reason: reason ?? code });
  expect(initialRegenerationConflictCopy(conflict.reason)).toMatch(message);
});

it("rejects an admin path id with separators and a mismatched confirmation success body", async () => {
  post.mockReset();
  expect((await adminConfirm(request("/admin/service-records", confirmationBody), {
    params: Promise.resolve({ ...target, documentStateId: "../other" }),
  })).status).toBe(400);
  expect(post).not.toHaveBeenCalled();
  post.mockResolvedValue({ status: 200, data: { ...confirmationResult, revisionId: "other" } });
  expect((await staffConfirm(request("/eformsign-docs/jobs/confirm-no-provider-document", target))).status).toBe(502);
});
