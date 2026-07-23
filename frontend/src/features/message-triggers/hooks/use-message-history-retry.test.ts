import { useMutation, useQueryClient } from "@tanstack/react-query";

import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import { useRetryMessageHistory } from "./use-message-triggers";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn((options) => options),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("../api/message-triggers.api", () => ({
  messageTriggersApi: {
    retryHistory: jest.fn(),
  },
}));

describe("useRetryMessageHistory", () => {
  const invalidateQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useMutation as jest.Mock).mockImplementation((options) => options);
    (useQueryClient as jest.Mock).mockReturnValue({ invalidateQueries });
  });

  it("retries the selected history log by id and refreshes history", async () => {
    jest.mocked(messageTriggersApi.retryHistory).mockResolvedValue({
      data: { id: 77, status: "sent" },
    } as never);
    const mutation = useRetryMessageHistory() as unknown as {
      mutationFn: (id: number) => Promise<unknown>;
      onSuccess: () => void;
    };

    await mutation.mutationFn(77);
    mutation.onSuccess();

    expect(messageTriggersApi.retryHistory).toHaveBeenCalledWith(77);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.history(),
    });
  });
});
