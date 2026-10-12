import { render, screen } from "@testing-library/react";

import { ServiceRecordItemLabel } from "./ServiceRecordItemLabel";

const BASE = "desktop_service-record-admin_wizard_item-label";

describe("ServiceRecordItemLabel", () => {
  it("renders the title as a span carrying labelId (no label element)", () => {
    const { container } = render(
      <ServiceRecordItemLabel
        data-component={BASE}
        labelId="item-perineum"
        label="회음절개부위"
        messageId="item-perineum-message"
        message={null}
      />,
    );

    const title = screen.getByText("회음절개부위");
    expect(title.tagName).toBe("SPAN");
    expect(title).toHaveAttribute("id", "item-perineum");
    expect(container.querySelector("label")).toBeNull();
  });

  it("renders a label[for] when htmlFor is given, with the required mark outside its name", () => {
    render(
      <>
        <ServiceRecordItemLabel
          data-component={BASE}
          labelId="item-note"
          label="특이사항"
          required
          htmlFor="note-input"
          messageId="item-note-message"
          message={null}
        />
        <textarea id="note-input" />
      </>,
    );

    expect(screen.getByRole("textbox", { name: "특이사항" })).toBeInTheDocument();
    expect(screen.getByText("특이사항").closest("label")).toHaveAttribute("id", "item-note");
  });

  it("renders the message slot with id, tone and live region", () => {
    const { rerender } = render(
      <ServiceRecordItemLabel
        data-component={BASE}
        labelId="l"
        label="체온"
        messageId="temp-message"
        message={{ tone: "error", text: "35~42 사이로 입력해 주세요" }}
      />,
    );

    const slot = screen.getByText("35~42 사이로 입력해 주세요");
    expect(slot).toHaveAttribute("id", "temp-message");
    expect(slot).toHaveAttribute("aria-live", "polite");
    expect(slot).toHaveAttribute("data-tone", "error");
    expect(slot).toHaveAttribute("data-slot", "lab-msg");
    expect(slot).toHaveClass("text-v3-burgundy", "truncate");

    rerender(
      <ServiceRecordItemLabel
        data-component={BASE}
        labelId="l"
        label="체온"
        messageId="temp-message"
        message={{ tone: "hint", text: "예: 36.5" }}
      />,
    );
    expect(screen.getByText("예: 36.5")).toHaveAttribute("data-tone", "hint");
    expect(screen.getByText("예: 36.5")).toHaveClass("text-v3-text-muted");
  });

  it("keeps the (empty) message slot rendered so inputs can describe themselves by it", () => {
    const { container } = render(
      <ServiceRecordItemLabel data-component={BASE} labelId="l" label="체온" messageId="m" message={null} />,
    );
    const slot = container.querySelector("#m");
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
  });

  it("lets a long title wrap instead of overflowing the row", () => {
    const { container } = render(
      <ServiceRecordItemLabel
        data-component={BASE}
        labelId="l"
        label="① 회음절개부위 (또는 수술부위)"
        messageId="m"
        message={{ tone: "hint", text: "예" }}
      />,
    );
    const title = screen.getByText("① 회음절개부위 (또는 수술부위)");
    expect(title).not.toHaveClass("shrink-0");
    expect(title).toHaveClass("min-w-0");
    expect(container.firstElementChild).toHaveClass("grid");
    expect(container.querySelector("#m")).not.toHaveClass("ml-auto");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ServiceRecordItemLabel data-component={BASE} labelId="l" label="체온" messageId="m" message={null} />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceRecordItemLabel");
    expect(container.querySelector(`[data-component="${BASE}_title"]`)).not.toBeNull();
    expect(container.querySelector(`[data-component="${BASE}_message"]`)).not.toBeNull();
  });
});
