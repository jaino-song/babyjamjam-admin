import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState, type ComponentProps } from "react";

import { ExpandableSearch } from "./ExpandableSearch";

function renderSearch(props: Partial<ComponentProps<typeof ExpandableSearch>> = {}) {
  const onChange = jest.fn();
  render(<ExpandableSearch value="" onChange={onChange} {...props} />);
  return { onChange };
}

function ControlledSearch({ onClear }: { onClear: () => void }) {
  const [value, setValue] = useState("");

  return (
    <ExpandableSearch
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        if (!nextValue) onClear();
      }}
    />
  );
}

describe("ExpandableSearch accessibility labels", () => {
  it("exposes default toggle and input names in each state", async () => {
    const { onChange } = renderSearch();

    const input = screen.getByRole("textbox", { name: "검색어" });
    expect(screen.getByRole("button", { name: "검색 열기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "검색 닫기" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));

    expect(screen.getByRole("button", { name: "검색 닫기" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "검색어" })).toBe(input);
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: "고객" } });
    fireEvent.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("shows a boxed 44px search field with 16px text and 12px padding only when open", () => {
    renderSearch({ "data-component": "mobile_admin_feedback_split-layout_list-panel_tabs_search" });
    const input = screen.getByRole("textbox", { name: "검색어" });
    expect(input).toHaveClass("w-0", "h-0", "border-0", "p-0");
    const toggle = screen.getByRole("button", { name: "검색 열기" });
    expect(toggle).toHaveClass("h-8", "w-8", "after:-inset-1.5");
    fireEvent.click(toggle);
    expect(input).toHaveClass("h-[44px]", "rounded-[12px]", "text-base", "px-3", "bg-v3-dim-white", "w-full", "min-w-0", "flex-1");
    expect(input).not.toHaveClass("h-auto", "text-sm", "p-0", "w-0");
    expect(input).not.toHaveAttribute("style");
    expect(input).toHaveAttribute("data-component", "mobile_admin_feedback_split-layout_list-panel_tabs_search_input");
    fireEvent.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(input).toHaveClass("w-0", "h-0", "p-0");
  });

  it("keeps autofocus without the shared Input focus ring", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    const input = screen.getByRole("textbox", { name: "검색어" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveClass("focus-visible:ring-0", "focus-visible:ring-offset-0");
    expect(input).not.toHaveClass("focus-visible:ring-2", "focus-visible:ring-offset-2");
  });

  it("uses caller-provided names for the toggle and input", () => {
    renderSearch({
      openLabel: "고객 검색 열기",
      closeLabel: "고객 검색 닫기",
      inputLabel: "고객 이름 검색",
    });

    expect(screen.getByRole("button", { name: "고객 검색 열기" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "고객 이름 검색" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "고객 검색 열기" }));
    expect(screen.getByRole("button", { name: "고객 검색 닫기" })).toBeInTheDocument();
  });

  it("closes an empty focused search when clicking its toggle", async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(screen.getByRole("button", { name: "검색 열기" })).toBeInTheDocument();
  });

  it("clears a controlled value exactly once when closing under StrictMode", async () => {
    const onClear = jest.fn();
    const consoleError = jest.spyOn(console, "error");

    try {
      render(
        <StrictMode>
          <ControlledSearch onClear={onClear} />
        </StrictMode>,
      );

      const input = screen.getByRole("textbox", { name: "검색어" });
      fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
      fireEvent.change(input, { target: { value: "고객" } });
      expect(input).toHaveValue("고객");

      fireEvent.click(screen.getByRole("button", { name: "검색 닫기" }));

      expect(input).toHaveValue("");
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(
        consoleError.mock.calls.some(([message]) =>
          typeof message === "string" && message.includes("Cannot update a component"),
        ),
      ).toBe(false);
      await waitFor(() => expect(input).not.toHaveFocus());
    } finally {
      consoleError.mockRestore();
    }
  });
});
