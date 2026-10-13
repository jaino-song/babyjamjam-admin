import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useMessageTriggerRules,
  useMessageTriggerRule,
  useResendMessageTriggerJob,
} from "../use-message-triggers";
import { messageTriggerKeys } from "../keys";

jest.mock("../../api/message-triggers.api", () => ({
  messageTriggersApi: {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateBranchActivation: jest.fn(),
    delete: jest.fn(),
    listTemplates: jest.fn(),
    listUpcomingJobs: jest.fn(),
    listHistory: jest.fn(),
    cancelJob: jest.fn(),
    resendJob: jest.fn(),
  },
}));

const { messageTriggersApi } = jest.requireMock("../../api/message-triggers.api") as {
  messageTriggersApi: Record<string, jest.Mock>;
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("message-trigger payload shape handling (EM v1.0 client policy)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["string body", "unexpected"],
    ["number body", 42],
    ["null body", null],
    ["object with non-array data", { data: { broken: true } }],
    ["object with scalar data", { data: "nope" }],
  ])("fails the rules read loudly for a malformed payload: %s", async (_label, payload) => {
    messageTriggersApi.list.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useMessageTriggerRules(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Malformed reads must never coerce into an empty success.
    expect(result.current.data).toBeUndefined();
  });

  it.each([
    ["raw array body", [{ id: "r1" }]],
    ["enveloped array body", { data: [{ id: "r1" }] }],
  ])("still accepts the supported list shapes: %s", async (_label, payload) => {
    messageTriggersApi.list.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useMessageTriggerRules(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "r1" }]);
  });

  it.each([
    ["string body", "unexpected"],
    ["number body", 42],
  ])("fails the detail read loudly for a malformed payload: %s", async (_label, payload) => {
    messageTriggersApi.getById.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useMessageTriggerRule("r1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it.each([
    ["bare object body", { id: "r1" }],
    ["enveloped object body", { data: { id: "r1" } }],
  ])("still accepts the supported detail shapes: %s", async (_label, payload) => {
    messageTriggersApi.getById.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useMessageTriggerRule("r1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "r1" });
  });
});

describe("useResendMessageTriggerJob", () => {
  const JOB_UUID = "8f14e45f-ceea-467a-9575-7b1a6f2f6c11";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends the bare job id, returns the response data and refetches upcoming and history", async () => {
    const response = { id: JOB_UUID, status: "needs_setup", reason: "연락처가 연결되지 않았어요." };
    messageTriggersApi.resendJob.mockResolvedValue({ data: response });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useResendMessageTriggerJob(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync(JOB_UUID);
    });

    expect(messageTriggersApi.resendJob).toHaveBeenCalledTimes(1);
    expect(messageTriggersApi.resendJob).toHaveBeenCalledWith(JOB_UUID);
    expect(returned).toEqual(response);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.upcoming() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.history() });
  });

  it("does not refetch when the request is rejected", async () => {
    messageTriggersApi.resendJob.mockRejectedValue(new Error("conflict"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useResendMessageTriggerJob(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(JOB_UUID)).rejects.toThrow("conflict");
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
