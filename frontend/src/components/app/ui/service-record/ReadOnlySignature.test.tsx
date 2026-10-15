import { render, screen } from "@testing-library/react";

import { ReadOnlySignature } from "./ReadOnlySignature";

const BASE = "desktop_service-record-admin_wizard_signature";
const DATA_URI = "data:image/png;base64,iVBORw0KGgo=";

describe("ReadOnlySignature", () => {
  it("shows the saved signature as an image described by the message", () => {
    render(
      <ReadOnlySignature
        data-component={BASE}
        value={DATA_URI}
        message="9.21 서명"
        messageId="signature-message"
      />,
    );

    const image = screen.getByRole("img", { name: "산모 서명" });
    expect(image).toHaveAttribute("src", DATA_URI);
    expect(image).toHaveAttribute("aria-describedby", "signature-message");
    expect(image).toHaveAccessibleDescription("9.21 서명");
  });

  it("renders the message with id, slot and live region", () => {
    render(
      <ReadOnlySignature
        data-component={BASE}
        value={null}
        message="저장된 서명이 없어요"
        messageId="signature-message"
      />,
    );

    const message = screen.getByText("저장된 서명이 없어요");
    expect(message).toHaveAttribute("id", "signature-message");
    expect(message).toHaveAttribute("data-slot", "lab-msg");
    expect(message).toHaveAttribute("aria-live", "polite");
  });

  it("shows an aria-hidden empty box instead of an image when there is no value", () => {
    const { container } = render(
      <ReadOnlySignature
        data-component={BASE}
        value={null}
        message="저장된 서명이 없어요"
        messageId="signature-message"
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    const empty = container.querySelector(`[data-component="${BASE}_empty"]`);
    expect(empty).toHaveAttribute("aria-hidden", "true");
    expect(empty).toHaveClass("h-[calc(150px*var(--glint-ui-scale,1))]", "rounded-[12px]", "bg-v3-dim-white");
  });

  it("puts the image in a 150px solid-bordered 12px-radius box", () => {
    const { container } = render(
      <ReadOnlySignature data-component={BASE} value={DATA_URI} message="m" messageId="m-id" />,
    );
    const wrap = container.querySelector(`[data-component="${BASE}_image-wrap"]`);
    expect(wrap).toHaveClass(
      "h-[calc(150px*var(--glint-ui-scale,1))]",
      "rounded-[12px]",
      "border-[1.5px]",
      "border-v3-border!",
    );
    expect(wrap).not.toHaveClass("border-dashed");
  });

  it("defaults the label to 산모 서명 and accepts another", () => {
    const { rerender } = render(
      <ReadOnlySignature data-component={BASE} value={null} message="m" messageId="m-id" />,
    );
    expect(screen.getByText("산모 서명")).toBeInTheDocument();

    rerender(<ReadOnlySignature data-component={BASE} value={null} message="m" messageId="m-id" label="보호자 서명" />);
    expect(screen.getByText("보호자 서명")).toBeInTheDocument();
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ReadOnlySignature data-component={BASE} value={DATA_URI} message="m" messageId="m-id" />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ReadOnlySignature");
    for (const suffix of ["label-row", "label", "message", "image-wrap", "image"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
