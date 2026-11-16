import { fireEvent, render, screen } from "@testing-library/react";

import { CodeBlock } from "../CodeBlock";
import { ChatInput } from "../ChatInput";

jest.mock("react-syntax-highlighter", () => ({ Prism: ({ children }: { children: string }) => <pre>{children}</pre> }));
jest.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }));

function expectIconSize(button: HTMLElement) {
  expect(button).toHaveClass(
    "h-[calc(32px*var(--glint-ui-scale,1))]", "w-[calc(32px*var(--glint-ui-scale,1))]",
    "after:h-[calc(44px*var(--glint-ui-scale,1))]", "after:w-[calc(44px*var(--glint-ui-scale,1))]",
  );
  expect(button).not.toHaveClass("h-6");
  expect(button).not.toHaveClass("w-6");
  expect(button).not.toHaveClass("h-10");
  expect(button).not.toHaveClass("w-10");
}

it("uses the shared icon size for code copying", () => {
  render(<CodeBlock>{"const example = true;"}</CodeBlock>);
  expectIconSize(screen.getByRole("button", { name: "Copy code" }));
});

it("uses the shared icon size for chat send while retaining submission", () => {
  const onSubmit = jest.fn();
  render(<ChatInput onSubmit={onSubmit} />);
  const send = screen.getByRole("button", { name: "전송" });
  expectIconSize(send);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "산모 검색" } });
  fireEvent.click(send);
  expect(onSubmit).toHaveBeenCalledWith("산모 검색");
});
