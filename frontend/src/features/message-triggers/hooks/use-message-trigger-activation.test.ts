import { useMutation, useQueryClient } from "@tanstack/react-query";

import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import { useActivateMessageTriggerRuleWithParent } from "./use-message-triggers";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn((options) => options),
  useQueryClient: jest.fn(),
}));

jest.mock("../api/message-triggers.api", () => ({
  messageTriggersApi: {
    activateWithParent: jest.fn(),
  },
}));

describe("useActivateMessageTriggerRuleWithParent", () => {
  const invalidateQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useMutation as jest.Mock).mockImplementation((options) => options);
    (useQueryClient as jest.Mock).mockReturnValue({ invalidateQueries });
  });

  it("uses the atomic API and invalidates rules, jobs, history, and policies", async () => {
    jest.mocked(messageTriggersApi.activateWithParent).mockResolvedValue({
      data: { id: "rule-1", isActive: true },
    } as never);
    const mutation = useActivateMessageTriggerRuleWithParent() as unknown as {
      mutationFn: (id: string) => Promise<unknown>;
      onSuccess: () => Promise<void>;
    };

    await mutation.mutationFn("rule-1");
    await mutation.onSuccess();

    expect(messageTriggersApi.activateWithParent).toHaveBeenCalledWith("rule-1");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.upcoming() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.history() });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "message-automation-policies"],
    });
  });

  it("only invalidates on the coded parent-disabled conflict", async () => {
    const mutation = useActivateMessageTriggerRuleWithParent() as unknown as {
      onError: (error: unknown) => Promise<void>;
    };
    const parentDisabled = {
      response: {
        status: 409,
        data: { code: "MESSAGE_AUTOMATION_PARENT_DISABLED" },
      },
    };

    await mutation.onError(parentDisabled);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "message-automation-policies"],
    });

    invalidateQueries.mockClear();
    await mutation.onError({
      response: {
        status: 409,
        data: { code: "GLOBAL_RULE_DISABLED" },
      },
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
