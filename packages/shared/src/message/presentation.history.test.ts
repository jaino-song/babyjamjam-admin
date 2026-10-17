import { getMessageHistoryDetailStatusLabel, MESSAGE_HISTORY_STATUS_LABELS } from "./presentation";

describe("provider-history detail labels", () => {
  it.each(["pending", "failed", "canceled"] as const)("%s shows checking/exhausted", status => {
    expect(getMessageHistoryDetailStatusLabel({ status, variables: { historyLookup: "checking" } })).toBe("확인 중");
    expect(getMessageHistoryDetailStatusLabel({ status, variables: { historyLookup: "exhausted" } })).toBe("확인 필요");
  });
  it.each(["checking", "exhausted"])("sent ignores leftover %s", historyLookup => {
    expect(getMessageHistoryDetailStatusLabel({ status: "sent", variables: { historyLookup } })).toBe(MESSAGE_HISTORY_STATUS_LABELS.sent);
  });
  it.each(["sent", "failed", "pending", "canceled"] as const)("unchanged %s label", status => {
    expect(getMessageHistoryDetailStatusLabel({ status })).toBe(MESSAGE_HISTORY_STATUS_LABELS[status]);
  });
  it("labels needs_setup as 설정 필요 instead of the raw status", () => {
    expect(getMessageHistoryDetailStatusLabel({ status: "needs_setup" })).toBe("설정 필요");
    expect(getMessageHistoryDetailStatusLabel({ status: "needs_setup" })).toBe(
      MESSAGE_HISTORY_STATUS_LABELS.needs_setup,
    );
  });
});
