import { render, screen } from "@testing-library/react";

import { AgentMobileShell } from "./AgentMobileShell";

jest.mock("next/navigation", () => ({ usePathname: () => "/agent" }));
jest.mock("@/components/app/notifications/NotificationBell", () => ({ NotificationBell: () => null }));

jest.mock("@/hooks/useAgentChat", () => ({
  useAgentCapabilities: () => "enabled",
  useAgentChat: () => ({ messages: [], status: "ready", sessions: [] }),
}));

it("keeps the composer's send button at 32px without shrinking and retains its 44px hit area", () => {
  render(<AgentMobileShell />);
  expect(screen.getByRole("button", { name: "전송" })).toHaveClass("shrink-0", "h-8", "w-8", "relative", "after:absolute", "after:-inset-1.5", "after:content-['']");
});
