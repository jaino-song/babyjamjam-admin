import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ListPanel } from "./ListPanel";

describe("ListPanel expandable search", () => {
  it.each(["inline", "dropdown"] as const)("gives search the tabs row width for %s tabs and restores tabs on close", async (tabsVariant) => {
    const onTabChange = jest.fn();
    const { container } = render(
      <ListPanel
        data-component="mobile_admin_feedback_split-layout_list-panel"
        title="피드백"
        tabs={[{ label: "전체", value: "all" }, { label: "확인 필요", value: "open" }]}
        activeTab="all"
        onTabChange={onTabChange}
        tabsVariant={tabsVariant}
        searchValue=""
        onSearchChange={jest.fn()}
        searchPlaceholder="사용자, 코멘트 검색..."
      >
        목록
      </ListPanel>,
    );
    const tab = screen.getByRole("button", { name: "전체" });
    expect(tab).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));

    const input = screen.getByPlaceholderText("사용자, 코멘트 검색...");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole("button", { name: "전체" })).not.toBeInTheDocument();
    expect(tab).not.toBeVisible();
    expect(container.querySelector('[data-slot="expandable-search"]')).toHaveClass("flex-1", "min-w-0");
    expect(input).toHaveClass("w-full", "flex-1", "min-w-0");
    expect(input).not.toHaveClass("w-20");

    fireEvent.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(screen.getByRole("button", { name: "전체" })).toBeVisible();
    expect(input).toHaveClass("w-0", "h-0");
    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    if (tabsVariant === "dropdown") fireEvent.click(screen.getAllByRole("button", { name: "전체" })[1]);
    expect(onTabChange).toHaveBeenCalledWith("all");
  });

  it("restores tabs when an empty search loses focus", async () => {
    render(
      <ListPanel
        data-component="mobile_admin_feedback_split-layout_list-panel"
        title="피드백"
        tabs={[{ label: "전체", value: "all" }]}
        searchValue=""
        onSearchChange={jest.fn()}
      >목록</ListPanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    const input = screen.getByRole("textbox", { name: "검색어" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "전체" })).toBeVisible();
    expect(screen.getByRole("button", { name: "검색 열기" })).toBeInTheDocument();
  });
});
