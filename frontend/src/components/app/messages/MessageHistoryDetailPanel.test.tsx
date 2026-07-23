import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./MessageHistoryDetailPanel"), "utf8");

describe("MessageHistoryDetailPanel delivery status labels", () => {
  it("should use the shared sent label instead of a standalone completion label", () => {
    const badges = source.slice(
      source.indexOf("badges={"),
      source.indexOf("trailing={"),
    );

    expect(badges).toContain("MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label");
    expect(badges).not.toContain("\n            완료\n");
  });
});
