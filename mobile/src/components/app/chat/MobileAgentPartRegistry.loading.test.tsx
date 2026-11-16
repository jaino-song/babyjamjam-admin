import { render, screen } from "@testing-library/react";

import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

it("shows tool progress with a spinner and a screen-reader-only label", () => {
  const { container } = render(<MobileAgentPartRegistry
    data-component="mobile_chat_agent-shell_thread_message-assistant_part-0"
    part={{ type: "tool-clients.search", state: "input-available" }}
    onEntitySelect={jest.fn()}
    onApproveAction={jest.fn()}
    onRejectAction={jest.fn()}
    onSubmitForm={jest.fn()}
  />);
  expect(screen.getByRole("status")).toHaveTextContent("처리 중…");
  expect(screen.getByText("처리 중…")).toHaveClass("sr-only");
  expect(container.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
});
