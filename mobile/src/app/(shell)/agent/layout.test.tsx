import { render, screen } from "@testing-library/react";

import AgentLayout, { metadata } from "./layout";

it("gives the agent route the agent title and preserves its content", () => {
  expect(metadata.title).toBe("에이전트 - 아가잼잼 관리자");
  render(<AgentLayout><p>에이전트 화면</p></AgentLayout>);
  expect(screen.getByText("에이전트 화면")).toBeInTheDocument();
});
