import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { useSystemTemplate } from "@/features/system-templates/hooks";

import { ContractReminderMessageForm } from "../ContractReminderMessageForm";

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
    dataComponent,
    messageCard,
    templateReady,
  }: {
    dataComponent: string;
    messageCard: ReactNode;
    templateReady: boolean;
  }) => (
    <div
      data-testid="template-frame"
      data-component={dataComponent}
      data-template-ready={String(templateReady)}
    >
      {messageCard}
    </div>
  ),
}));

const mockedUseSystemTemplate = jest.mocked(useSystemTemplate);

describe("ContractReminderMessageForm", () => {
  beforeEach(() => {
    mockedUseSystemTemplate.mockReturnValue({
      data: {
        id: 1,
        templateKey: "CONTRACT_REMINDER",
        name: "계약서 작성 요청",
        description: "서비스 계약서 미완료 산모에게 계약서 작성 및 서명 요청",
        content: "{{name}} 산모님 계약서 작성을 부탁드립니다.",
        customVariables: [],
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      isError: false,
      isFetching: false,
      isLoading: false,
    } as never);
  });

  it("loads the CONTRACT_REMINDER template and marks the send form ready", () => {
    render(<ContractReminderMessageForm />);

    expect(mockedUseSystemTemplate).toHaveBeenCalledWith("CONTRACT_REMINDER");
    expect(screen.getByTestId("generated-message")).toHaveTextContent("계약서 작성을 부탁드립니다.");
    expect(screen.getByTestId("template-frame")).toHaveAttribute(
      "data-component",
      "desktop_messages_sections_contract-reminder-form",
    );
    expect(screen.getByTestId("template-frame")).toHaveAttribute("data-template-ready", "true");
  });
});
