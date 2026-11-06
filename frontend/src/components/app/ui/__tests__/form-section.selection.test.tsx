import { createRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormChip, FormTextInput } from "../form-section";
import { SelectableItemFrame } from "@/components/ui/selectable-item";

function SelectionFixture() {
  const [selected, setSelected] = useState("고객");
  return (
    <>
      {["고객", "주 제공인력"].map((label) => (
        <FormChip
          key={label}
          data-component={`desktop_test_recipient-chip_${label === "고객" ? "client" : "primary"}`}
          selected={selected === label}
          onClick={() => setSelected(label)}
        >
          {label}
        </FormChip>
      ))}
    </>
  );
}

describe("FormChip selection frame", () => {
  it("switches selection without submitting and restores the old chip's gray hover frame", () => {
    const onSubmit = jest.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><SelectionFixture /></form>);
    const client = screen.getByRole("button", { name: "고객" });
    const primary = screen.getByRole("button", { name: "주 제공인력" });

    expect(client).toHaveAttribute("aria-pressed", "true");
    expect(client).toHaveAttribute("data-selected", "true");
    expect(client).toHaveAttribute("data-source-component", "FormChip");
    expect(client).toHaveAttribute("data-slot", "form-chip");
    expect(client).toHaveClass("border-2", "border-v3-primary", "bg-v3-primary-light", "hover:border-v3-primary", "hover:bg-v3-primary-light");
    expect(primary).toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border", "hover:bg-white");

    fireEvent.click(primary);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(primary).toHaveAttribute("aria-pressed", "true");
    expect(primary).toHaveAttribute("data-selected", "true");
    expect(client).toHaveAttribute("aria-pressed", "false");
    expect(client).toHaveAttribute("data-selected", "false");
    expect(client).toHaveClass("border-v3-selectable-border", "hover:border-v3-selectable-border", "bg-white");
    expect(client).not.toHaveClass("border-v3-primary", "bg-v3-primary-light");
    for (const chip of [client, primary]) {
      expect(chip).toHaveClass("focus-visible:ring-2", "focus-visible:ring-v3-primary", "focus-visible:ring-offset-2");
    }
  });

  it("preserves native disabled behavior", () => {
    const onClick = jest.fn();
    render(<FormChip selected disabled onClick={onClick}>제공인력</FormChip>);
    const chip = screen.getByRole("button", { name: "제공인력" });
    fireEvent.click(chip);
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the text input's independent border and focus treatment", () => {
    render(<FormTextInput aria-label="이름" />);
    const input = screen.getByRole("textbox", { name: "이름" });
    expect(input).toHaveClass("border-[1.35px]", "border-input", "focus-visible:ring-inset");
    expect(input).not.toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border");
    expect(input).not.toHaveAttribute("data-selected");
  });
});

describe("SelectableItemFrame composition", () => {
  it.each([false, true])("renders its state border inline for isSelected=%s", (isSelected) => {
    // jsdom's CSS parser drops hsl(var(...)); inspect rendered markup instead.
    // Browser computed colors and cascade precedence require separate live QA.
    const markup = renderToStaticMarkup(
      <SelectableItemFrame asChild isSelected={isSelected}>
        <button style={{ borderColor: "red", animationDelay: "0.12s" }}>choose</button>
      </SelectableItemFrame>,
    );
    const template = document.createElement("template");
    template.innerHTML = markup;
    const button = template.content.querySelector("button");
    const style = button?.getAttribute("style");
    expect(style).toContain(`border-color:hsl(var(--${isSelected ? "v3-primary" : "v3-selectable-border"}))`);
    expect(style).toContain("animation-delay:0.12s");
    expect(style).not.toContain("red");
  });

  it("forwards a default div ref and caller attributes without adding interaction semantics", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <SelectableItemFrame
        ref={ref}
        isSelected={false}
        data-component="desktop_test_selection-frame"
        data-slot="caller-frame"
        style={{ animationDelay: "0.12s", opacity: 0.5 }}
      >
        frame
      </SelectableItemFrame>,
    );
    expect(container.children).toHaveLength(1);
    expect(ref.current).toBe(container.firstElementChild);
    expect(ref.current?.tagName).toBe("DIV");
    expect(ref.current).toHaveAttribute("data-component", "desktop_test_selection-frame");
    expect(ref.current).toHaveAttribute("data-slot", "caller-frame");
    expect(ref.current).toHaveAttribute("data-source-component", "SelectableItemFrame");
    expect(ref.current).not.toHaveAttribute("role");
    expect(ref.current).not.toHaveAttribute("tabindex");
    expect(ref.current).not.toHaveAttribute("aria-pressed");
    expect(ref.current).toHaveStyle({ animationDelay: "0.12s", opacity: "0.5" });
  });

  it("preserves a single native button, composed refs, handlers and non-border styles with asChild", () => {
    const frameRef = createRef<HTMLButtonElement>();
    const childRef = createRef<HTMLButtonElement>();
    const onFrameClick = jest.fn();
    const onChildClick = jest.fn();
    const onKeyDown = jest.fn();
    const { container, rerender } = render(
      <SelectableItemFrame
        asChild
        ref={frameRef}
        isSelected
        isInteractive
        onClick={onFrameClick}
        style={{ animationDelay: "0.08s", opacity: 0.5 }}
      >
        <button
          ref={childRef}
          type="button"
          data-component="desktop_test_selection-frame_button"
          data-slot="caller-button"
          data-source-component="CallerButton"
          aria-pressed="true"
          onClick={onChildClick}
          onKeyDown={onKeyDown}
          className="bg-v3-dim-white px-3"
          style={{ padding: "12px", borderColor: "red" }}
        >
          choose
        </button>
      </SelectableItemFrame>,
    );
    const button = screen.getByRole("button", { name: "choose" });
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(button);
    expect(frameRef.current).toBe(button);
    expect(childRef.current).toBe(button);
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-component", "desktop_test_selection-frame_button");
    expect(button).toHaveAttribute("data-slot", "caller-button");
    expect(button).toHaveAttribute("data-source-component", "CallerButton");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("border-2", "bg-v3-dim-white", "px-3", "focus-visible:ring-2");
    expect(button).not.toHaveClass("bg-v3-primary-light");
    expect(button).toHaveStyle({ animationDelay: "0.08s", opacity: "0.5", padding: "12px" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onFrameClick).toHaveBeenCalledTimes(1);
    expect(onChildClick).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    rerender(
      <SelectableItemFrame asChild isSelected={false}>
        <button type="button" aria-pressed="false">choose</button>
      </SelectableItemFrame>,
    );
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
