import { metadata } from "./layout";

describe("Agent layout metadata", () => {
  it("uses the agent name in the page title", () => {
    expect(metadata.title).toBe("에이전트 - 아가잼잼 관리자");
  });
});
