import { render, screen } from "@testing-library/react";
import AgentPage from "./page";

jest.mock("@/components/app/chat/AgentMobileShell", () => ({
  AgentMobileShell: () => <div data-testid="agent-mobile-shell" />,
}));

it("renders AgentMobileShell even when the former flag is off", () => {
  const original = process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED;
  process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED = "false";
  try {
    render(<AgentPage />);
    expect(screen.getByTestId("agent-mobile-shell")).toBeInTheDocument();
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED;
    else process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED = original;
  }
});
