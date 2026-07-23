import { render, screen } from "@testing-library/react";

import { MessagesTriggersPage } from "../MessagesTriggersPage";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => <div data-testid="client-registration-policy" />,
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerList", () => ({
  MessageTriggerList: () => <div data-testid="message-trigger-list" />,
}));

describe("MessagesTriggersPage", () => {
  it("renders the automation section navigation in the shared message shell", () => {
    const { container } = render(<MessagesTriggersPage />);

    const content = container.querySelector<HTMLElement>('[data-component="messages-content"]');
    const navigation = screen.getByRole("navigation", { name: "메시지 기능" });

    expect(content?.firstElementChild).toBe(navigation);
    expect(container.querySelector('[data-component="messages-shell"]')).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자동 전송" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('[data-component="mobile-redesign-list-title"] .list-title-text'))
      .toHaveTextContent("자동 전송");
    expect(container.querySelector('[data-component="mobile-redesign-list-card"]'))
      .toContainElement(container.querySelector('[data-component="mobile-redesign-list-scroll"]'));
  });
});
