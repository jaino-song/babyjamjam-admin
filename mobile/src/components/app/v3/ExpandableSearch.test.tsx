import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
