import { render, screen } from "@testing-library/react";

import AgentLayout, { metadata } from "./layout";

it("gives the agent route the assistant title and preserves its content", () => {
  expect(metadata.title).toBe("어시스턴트 - 아가잼잼 관리자");
  render(<AgentLayout><p>에이전트 화면</p></AgentLayout>);
  expect(screen.getByText("에이전트 화면")).toBeInTheDocument();
});
