import { createProblemDetails, normalizeApiError } from "@babyjamjam/shared";
import type { EformsignApiListResponse } from "@babyjamjam/shared/types/eformsign";

import { api } from "@/lib/api/client";
import { normalizeDocumentListResponse } from "../api";
import { messageDeliveryApi } from "../api";

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedApiPost = jest.mocked(api.post);

const smsPayload = {
  receiver: "010-1234-5678",
  message: "안내 메시지입니다.",
  msgType: "AUTO" as const,
  triggerType: "immediate" as const,
};

describe("normalizeDocumentListResponse", () => {
  it("preserves the backend filtered total_rows value", () => {
    const response = {
      documents: [{ id: "service-record-doc" }],
      total_rows: 1,
    } as EformsignApiListResponse;

    expect(normalizeDocumentListResponse(response, { limit: 20, skip: 0 })).toMatchObject({
      total_rows: 1,
      limit: 20,
      skip: 0,
    });
  });
});

describe("messageDeliveryApi.sendSms error boundary", () => {
  beforeEach(() => {
    mockedApiPost.mockReset();
  });

  it.each([
    ["NOT_APPLIED", createProblemDetails({ code: "VALIDATION_FAILED", requestId: "req-not-applied", status: 422, outcome: "NOT_APPLIED" })],
    ["UNKNOWN", createProblemDetails({ code: "MESSAGE_SEND_UNCONFIRMED", requestId: "req-unknown", status: 502, outcome: "UNKNOWN" })],
    ["PARTIALLY_APPLIED", createProblemDetails({ code: "MESSAGE_SEND_PARTIAL", requestId: "req-partial", status: 502, outcome: "PARTIALLY_APPLIED" })],
  ] as const)("preserves the original Axios error and %s ProblemDetails payload", async (outcome, problem) => {
    const error = {
      isAxiosError: true,
      response: { status: problem.status, data: problem },
    };
    mockedApiPost.mockRejectedValue(error);

    await expect(messageDeliveryApi.sendSms(smsPayload)).rejects.toBe(error);
    expect(mockedApiPost).toHaveBeenCalledWith("/message-deliveries/sms", smsPayload);
    expect(normalizeApiError(error, { operation: "mutation" })).toMatchObject({
      verified: true,
      outcome,
      problem,
    });
  });

  it("preserves a plain Error so the mutation boundary can classify it as UNKNOWN", async () => {
    const error = new Error("transport detail must stay out of the UI");
    mockedApiPost.mockRejectedValue(error);

    await expect(messageDeliveryApi.sendSms(smsPayload)).rejects.toBe(error);
    expect(normalizeApiError(error, { operation: "mutation" })).toMatchObject({
      verified: false,
      outcome: "UNKNOWN",
      recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
    });
  });
});
