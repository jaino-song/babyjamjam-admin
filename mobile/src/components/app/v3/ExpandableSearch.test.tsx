import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ExpandableSearch } from "./ExpandableSearch";

function renderSearch(props: Partial<ComponentProps<typeof ExpandableSearch>> = {}) {
  const onChange = jest.fn();
  render(<ExpandableSearch value="" onChange={onChange} {...props} />);
  return { onChange };
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
});
