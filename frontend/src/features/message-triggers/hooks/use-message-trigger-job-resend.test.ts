import { useMutation, useQueryClient } from "@tanstack/react-query";

import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import { useResendMessageTriggerJob } from "./use-message-triggers";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn((options) => options),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("../api/message-triggers.api", () => ({
  messageTriggersApi: {
    resendJob: jest.fn(),
  },
}));

describe("useResendMessageTriggerJob", () => {
  const invalidateQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useMutation as jest.Mock).mockImplementation((options) => options);
    (useQueryClient as jest.Mock).mockReturnValue({ invalidateQueries });
  });

  it("resends the job by its bare uuid and returns the response body", async () => {
    jest.mocked(messageTriggersApi.resendJob).mockResolvedValue({
      data: { id: "job-uuid", status: "sent", reason: null },
    } as never);
    const mutation = useResendMessageTriggerJob() as unknown as {
      mutationFn: (jobId: string) => Promise<unknown>;
    };

    await expect(mutation.mutationFn("job-uuid")).resolves.toEqual({
      id: "job-uuid",
      status: "sent",
      reason: null,
    });
    expect(messageTriggersApi.resendJob).toHaveBeenCalledWith("job-uuid");
  });

  it("awaits the upcoming and history invalidation before resolving", async () => {
    const order: string[] = [];
    invalidateQueries.mockImplementation(async ({ queryKey }: { queryKey: unknown }) => {
      await Promise.resolve();
      order.push(JSON.stringify(queryKey));
    });
    const mutation = useResendMessageTriggerJob() as unknown as {
      onSuccess: () => Promise<void>;
    };

    await mutation.onSuccess();

    expect(order).toEqual([
      JSON.stringify(messageTriggerKeys.upcoming()),
      JSON.stringify(messageTriggerKeys.history()),
    ]);
  });
});
