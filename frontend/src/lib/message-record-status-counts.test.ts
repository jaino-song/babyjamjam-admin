import { getMessageRecordStatusCounts } from "./message-record-status-counts";

describe("getMessageRecordStatusCounts", () => {
  const input = {
    history: [{ status: "sent" }, { status: "failed" }, { status: "canceled" }, { status: "sent" }],
    upcomingCount: 2,
    historyUnknown: false,
    upcomingUnknown: false,
    historyLimited: false,
    upcomingLimited: false,
  };

  it("counts every tab from search/date-filtered data, independently of the active tab", () => {
    expect(getMessageRecordStatusCounts(input)).toEqual({ all: 6, upcoming: 2, sent: 2, failed: 1, canceled: 1 });
  });

  it.each([
    [{ historyUnknown: true }, { all: "—", upcoming: 2, sent: "—", failed: "—", canceled: "—" }],
    [{ upcomingUnknown: true }, { all: "—", upcoming: "—", sent: 2, failed: 1, canceled: 1 }],
  ])("marks only tabs requiring an unavailable source unknown: %j", (overrides, expected) => {
    expect(getMessageRecordStatusCounts({ ...input, ...overrides })).toEqual(expected);
  });

  it.each([
    [{ historyLimited: true }, { all: "6+", upcoming: 2, sent: "2+", failed: "1+", canceled: "1+" }],
    [{ upcomingLimited: true }, { all: "6+", upcoming: "2+", sent: 2, failed: 1, canceled: 1 }],
  ])("marks lower bounds only for tabs requiring a capped source: %j", (overrides, expected) => {
    expect(getMessageRecordStatusCounts({ ...input, ...overrides })).toEqual(expected);
  });
});
