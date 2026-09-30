import { render, screen } from "@testing-library/react";

import { FieldLabelRow, fieldMessageId } from "./FieldLabelRow";

describe("FieldLabelRow", () => {
  it("always renders an empty polite slot that the input can be described by", () => {
    render(
      <>
        <FieldLabelRow data-component="t_field" htmlFor="x" label="이름" message={null} />
        <input id="x" aria-describedby={fieldMessageId("x")} />
      </>,
    );

    const slot = document.getElementById("x-message") as HTMLElement;
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText("이름")).toHaveAttribute("aria-describedby", "x-message");
  });

  it("shows the message text and labels the slot by its data-component", () => {
    render(<FieldLabelRow data-component="t_field" htmlFor="x" label="이름" message={{ text: "이름을 입력해 주세요", tone: "err" }} />);

    const slot = screen.getByText("이름을 입력해 주세요");
    expect(slot).toHaveAttribute("data-component", "t_field_helper");
    expect(slot.parentElement).toHaveAttribute("data-component", "t_field_label-row");
  });

  it("marks a required field with a star inside the label", () => {
    render(<FieldLabelRow data-component="t_field" htmlFor="x" label="이름" required message={null} />);

    expect(screen.getByText("*")).toBeInTheDocument();
  });
});
