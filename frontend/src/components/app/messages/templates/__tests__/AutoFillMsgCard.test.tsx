import { fireEvent, render, screen } from "@testing-library/react";

import { AutoFillMsgCard } from "../AutoFillMsgCard";

describe("AutoFillMsgCard", () => {
  it("renders the editable message card with metadata, variables, and copy action", () => {
    const handleCopy = jest.fn();
    const handleMessageChange = jest.fn();

    render(
      <AutoFillMsgCard
        title="생성 메시지"
        copyButtonText="복사"
        message={"안녕하세요\n반갑습니다"}
        handleCopy={handleCopy}
        onMessageChange={handleMessageChange}
        metaItems={[{ label: "템플릿 유형", value: "안내" }]}
        variableItems={[{ token: "{{name}}", label: "이름", value: "홍길동" }]}
      />,
    );

    const textbox = screen.getByRole("textbox");

    expect(screen.getByText("메시지 본문")).toBeInTheDocument();
    expect(textbox).toHaveValue("안녕하세요\n반갑습니다");
    expect(screen.getByText("템플릿 유형")).toBeInTheDocument();
    expect(screen.getByText("{{name}}")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(handleCopy).toHaveBeenCalledTimes(1);

    fireEvent.change(textbox, {
      target: { value: "수정된 메시지" },
    });
    expect(handleMessageChange).toHaveBeenCalledWith("수정된 메시지");
  });

  it("can render detail sections without the internal detail grid wrapper", () => {
    const { container } = render(
      <div data-testid="parent-grid">
        <AutoFillMsgCard
          title="생성 메시지"
          copyButtonText="복사"
          message="안녕하세요"
          handleCopy={jest.fn()}
          layout="flat"
        />
      </div>,
    );

    expect(
      container.querySelector('[data-component="messages-generated-msg-detail-grid"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-component="messages-generated-msg-detail-content"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="messages-generated-msg-detail-side"]'),
    ).toBeInTheDocument();
  });

  it("can hide the metadata and variables side panel", () => {
    const { container } = render(
      <AutoFillMsgCard
        title="생성 메시지"
        copyButtonText="복사"
        message="안녕하세요"
        handleCopy={jest.fn()}
        showSide={false}
      />,
    );

    expect(
      container.querySelector('[data-component="messages-generated-msg-detail-content"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="messages-generated-msg-detail-side"]'),
    ).not.toBeInTheDocument();
  });
});
