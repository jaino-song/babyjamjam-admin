import { render, screen } from "@testing-library/react";

import { AgentActionApprovalCard } from "./AgentActionApprovalCard";

it("puts rejection before approval with one-third and two-thirds widths", () => {
  render(<AgentActionApprovalCard data-component="mobile_agent_test_approval" actionId="action-1" capability="messages.send" title="메시지 발송" summary="발송 전 확인" expiresAt="2099-01-01T00:00:00Z" expectedRevision="revision-1" changes={{}} />);
  const reject = screen.getByRole("button", { name: "거절" });
  const approve = screen.getByRole("button", { name: "승인하고 실행" });
  expect(screen.getAllByRole("button")).toEqual([reject, approve]);
  expect(reject).toHaveClass("flex-1", "min-h-11", "border");
  expect(approve.parentElement).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
  expect(approve).toHaveClass("flex-[2]", "min-h-11");
});
