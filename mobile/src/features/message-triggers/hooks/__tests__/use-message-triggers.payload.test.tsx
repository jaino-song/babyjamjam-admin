import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useMessageTriggerRules,
  useMessageTriggerRule,
} from "../use-message-triggers";

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
