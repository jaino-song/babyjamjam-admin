import { render, screen } from "@testing-library/react";

import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { TitleTextareaMolecule } from "@/components/ui/title-textarea-molecule";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { expectNoFieldMessageBelowControl, getFieldMessages } from "@/test-utils/field-message-slot";

const GUIDANCE = "공백 없이 입력해 주세요";
const ERROR = "이미 사용 중이에요";

describe("Title field molecules: one message slot per field", () => {
  describe("TitleTextInputMolecule", () => {
    it("shows guidance in the slot, replaces it with an error and restores it when the error clears", () => {
      const { container, rerender } = render(
        <TitleTextInputMolecule label="코드" helperText={GUIDANCE} helperTone="hint" />,
      );
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
      expect(getFieldMessages(container)[0]).toHaveAttribute("data-slot", "field-message");

      rerender(<TitleTextInputMolecule label="코드" helperText={ERROR} helperTone="error" error />);
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([ERROR]);
      expect(getFieldMessages(container)[0]).toHaveAttribute("data-slot", "field-error-message");

      rerender(<TitleTextInputMolecule label="코드" helperText={GUIDANCE} helperTone="hint" />);
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
    });

    it("replaces labelTrailing while a message shows and restores it afterwards", () => {
      const { rerender } = render(<TitleTextInputMolecule label="슬러그" labelTrailing="영문 소문자" />);
      expect(screen.getByText("영문 소문자")).toBeInTheDocument();

      rerender(<TitleTextInputMolecule label="슬러그" labelTrailing="영문 소문자" helperText={ERROR} />);
      expect(screen.queryByText("영문 소문자")).not.toBeInTheDocument();
      expect(screen.getByText(ERROR)).toBeInTheDocument();

      rerender(<TitleTextInputMolecule label="슬러그" labelTrailing="영문 소문자" />);
      expect(screen.getByText("영문 소문자")).toBeInTheDocument();
    });

    it("keeps the label on one line and renders nothing below the input", () => {
      const { container } = render(<TitleTextInputMolecule label="코드" helperText={ERROR} />);

      expect(screen.getByText("코드").closest("label")).toHaveClass("shrink-0", "whitespace-nowrap");
      expectNoFieldMessageBelowControl(container);
    });

    it("renders an empty slot when there is no message", () => {
      const { container } = render(<TitleTextInputMolecule label="코드" />);

      expect(getFieldMessages(container)).toHaveLength(0);
    });
  });

  describe("TitleSelectMolecule", () => {
    const options = [{ value: "a", label: "가" }];

    it("shows guidance, then an error, then guidance again, never below the control", () => {
      const { container, rerender } = render(
        <TitleSelectMolecule label="유형" options={options} onValueChange={jest.fn()} helperText={GUIDANCE} helperTone="hint" />,
      );
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
      expectNoFieldMessageBelowControl(container);

      rerender(<TitleSelectMolecule label="유형" options={options} onValueChange={jest.fn()} helperText={ERROR} />);
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([ERROR]);
      expectNoFieldMessageBelowControl(container);

      rerender(
        <TitleSelectMolecule label="유형" options={options} onValueChange={jest.fn()} helperText={GUIDANCE} helperTone="hint" />,
      );
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
    });
  });

  describe("TitleTextareaMolecule", () => {
    it("shows guidance, then an error, then guidance again, never below the control", () => {
      const { container, rerender } = render(
        <TitleTextareaMolecule label="메모" helperText={GUIDANCE} helperTone="hint" />,
      );
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
      expectNoFieldMessageBelowControl(container);

      rerender(<TitleTextareaMolecule label="메모" helperText={ERROR} />);
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([ERROR]);
      expectNoFieldMessageBelowControl(container);

      rerender(<TitleTextareaMolecule label="메모" helperText={GUIDANCE} helperTone="hint" />);
      expect(getFieldMessages(container).map((message) => message.textContent)).toEqual([GUIDANCE]);
    });
  });
});
