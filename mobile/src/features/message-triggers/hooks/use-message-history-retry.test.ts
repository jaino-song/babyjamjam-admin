import { useMutation, useQueryClient } from "@tanstack/react-query";
import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import { useRetryMessageHistory } from "./use-message-triggers";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn((options) => options), useQuery: jest.fn(), useQueryClient: jest.fn(),
}));
jest.mock("../api/message-triggers.api", () => ({ messageTriggersApi: { retryHistory: jest.fn() } }));

it("retries the log id and invalidates both global and customer histories", async () => {
  const invalidateQueries = jest.fn();
  (useQueryClient as jest.Mock).mockReturnValue({ invalidateQueries });
  (useMutation as jest.Mock).mockImplementation(options => options);
  jest.mocked(messageTriggersApi.retryHistory).mockResolvedValue({ data: { id: 42, status: "sent" } } as never);
  const mutation = useRetryMessageHistory(7) as unknown as { mutationFn: (id: number) => Promise<unknown>; onSuccess: () => Promise<void> };
  await mutation.mutationFn(42);
  await mutation.onSuccess();
  expect(messageTriggersApi.retryHistory).toHaveBeenCalledWith(42);
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.all });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["messages", "logs"] });
});
