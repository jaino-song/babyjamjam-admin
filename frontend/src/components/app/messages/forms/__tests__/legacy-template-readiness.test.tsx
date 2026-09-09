import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { useSystemTemplate } from "@/features/system-templates/hooks";

import { GreetingMessageForm } from "../GreetingMessageForm";

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: jest.fn(),
}));

jest.mock("@/components/app/messages/templates/AutoFillMsgCard", () => ({
  AutoFillMsgCard: ({ message }: { message: string }) => (
    <div data-testid="generated-message">{message}</div>
  ),
}));

jest.mock("@/components/app/messages/forms/form-components/TemplateMessageFormLayout", () => ({
  TemplateMessageFormFrame: ({
    messageCard,
    templateReady,
  }: {
    messageCard: ReactNode;
    templateReady: boolean;
  }) => (
    <div data-testid="template-frame" data-template-ready={String(templateReady)}>
      {messageCard}
    </div>
  ),
}));

const mockedUseSystemTemplate = jest.mocked(useSystemTemplate);

describe("legacy system-template send forms", () => {
  beforeEach(() => {
    mockedUseSystemTemplate.mockReturnValue({
      data: {
        id: 1,
        templateKey: "GREETING",
        name: "인사",
        description: "서버 템플릿",
        content: "지점 상세 템플릿",
        customVariables: [],
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      isError: true,
      isFetching: false,
      isLoading: false,
    } as never);
  });

  it("keeps the authoritative detail visible while fail-closing send readiness after an error", () => {
    render(<GreetingMessageForm />);

    expect(screen.getByTestId("generated-message")).toHaveTextContent("지점 상세 템플릿");
    expect(screen.getByTestId("template-frame")).toHaveAttribute("data-template-ready", "false");
  });
});
