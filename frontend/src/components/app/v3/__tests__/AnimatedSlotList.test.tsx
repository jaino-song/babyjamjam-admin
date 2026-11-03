import { fireEvent, render, screen } from "@testing-library/react";
import { AnimatedSlotList } from "../AnimatedSlotList";

describe("AnimatedSlotList", () => {
  it("honors loadingCount for card skeleton slots", () => {
    const { container } = render(
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[]}
        isLoading
        itemDataComponent="desktop_test_animated-slot-list_item"
        itemVariant="card"
        loadingCount={3}
        render={() => null}
      />,
    );

    const skeletonSlots = container.querySelectorAll(
      '[data-component="desktop_test_animated-slot-list_item"]',
    );
    expect(skeletonSlots).toHaveLength(3);
    // Loading slots carry the same card chrome as rendered rows so a mid-load
    // mix of skeletons and real cards reads as one list.
    skeletonSlots.forEach((slot) => {
      expect(slot).toHaveClass(
        "bg-white", "rounded-[18px]", "border-2", "border-v3-selectable-border",
      );
      expect(slot).not.toHaveAttribute("role");
      expect(slot).not.toHaveAttribute("aria-pressed");
    });
  });

  it("returns the previous selection to a gray frame and keeps hover colors stable", () => {
    const onSlotClick = jest.fn();
    const items = [{ id: "first", name: "첫 번째" }, { id: "second", name: "두 번째" }];
    const list = (selectedId: string) => (
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={items}
        isLoading={false}
        getItemKey={(item) => item.id}
        getSlotState={({ item }) => ({ isActive: item?.id === selectedId })}
        onSlotClick={onSlotClick}
        render={({ item }) => item?.name}
      />
    );
    const { rerender } = render(list("first"));
    const first = screen.getByRole("button", { name: "첫 번째" });
    const second = screen.getByRole("button", { name: "두 번째" });

    expect(first).toHaveAttribute("data-selected", "true");
    expect(first).toHaveClass("border-2", "border-v3-primary", "bg-v3-primary-light", "hover:border-v3-primary", "hover:bg-v3-primary-light");
    expect(second).toHaveClass("border-v3-selectable-border", "hover:border-v3-selectable-border", "hover:bg-white");

    fireEvent.keyDown(second, { key: "Enter" });
    fireEvent.keyDown(second, { key: " " });
    expect(onSlotClick).toHaveBeenNthCalledWith(1, items[1], 1);
    expect(onSlotClick).toHaveBeenNthCalledWith(2, items[1], 1);

    rerender(list("second"));
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(first).toHaveAttribute("data-selected", "false");
    expect(first).toHaveClass("border-v3-selectable-border", "hover:border-v3-selectable-border", "bg-white");
    expect(first).not.toHaveClass("border-v3-primary", "bg-v3-primary-light");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveClass("border-v3-primary", "focus-visible:ring-offset-2");
  });

  it("leaves unstyled slots and their loading renderer free of card chrome", () => {
    const list = (isLoading: boolean) => (
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        itemVariant="unstyled"
        items={[{ name: "사용자 행" }]}
        isLoading={isLoading}
        loadingCount={1}
        getSlotState={() => ({ isActive: true })}
        onSlotClick={jest.fn()}
        render={({ item, isLoading: loading }) => loading ? "사용자 로딩" : item?.name}
      />
    );
    const { rerender } = render(list(false));
    expect(screen.getByRole("button", { name: "사용자 행" })).not.toHaveClass(
      "border-2", "border-v3-primary", "bg-v3-primary-light",
    );
    rerender(list(true));
    expect(screen.getByText("사용자 로딩")).not.toHaveClass(
      "border-2", "border-v3-selectable-border", "bg-white",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("announces the selected interactive item and renders a keyboard focus style", () => {
    render(
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[{ id: "client-1", name: "송규운" }]}
        isLoading={false}
        itemDataComponent="desktop_test_animated-slot-list_item"
        onSlotClick={jest.fn()}
        getSlotState={() => ({ isActive: true, isInteractive: true })}
        render={({ item }) => item?.name}
      />,
    );

    expect(screen.getByRole("button", { name: "송규운" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "송규운" })).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-v3-primary",
    );
  });

  it("keeps the pagination footer stable while fetching more items", () => {
    const renderList = (isFetchingMore: boolean) => (
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[
          { id: "item-1", name: "첫 번째" },
          { id: "item-2", name: "두 번째" },
        ]}
        isLoading={false}
        itemDataComponent="desktop_test_animated-slot-list_item"
        getItemKey={(item) => item.id}
        hasMore
        isFetchingMore={isFetchingMore}
        render={({ item }) => item?.name}
      />
    );

    const { container, rerender } = render(renderList(false));
    const footerBeforeFetch = container.querySelector('[data-slot="fetch-more"]');

    expect(footerBeforeFetch).toHaveClass("h-8");
    expect(
      container.querySelectorAll('[data-component="desktop_test_animated-slot-list_item"]'),
    ).toHaveLength(2);
    const indicatorBeforeFetch = container.querySelector(
      '[data-slot="fetching-more-indicator"]',
    );
    expect(indicatorBeforeFetch).toHaveAttribute("data-state", "idle");
    expect(indicatorBeforeFetch).toHaveClass("opacity-0", "delay-0");

    rerender(renderList(true));

    expect(container.querySelector('[data-slot="fetch-more"]')).toBe(footerBeforeFetch);
    expect(
      container.querySelectorAll('[data-component="desktop_test_animated-slot-list_item"]'),
    ).toHaveLength(2);
    const indicatorDuringFetch = container.querySelector(
      '[data-slot="fetching-more-indicator"]',
    );
    expect(indicatorDuringFetch).toBe(indicatorBeforeFetch);
    expect(indicatorDuringFetch).toHaveAttribute("data-state", "loading");
    expect(indicatorDuringFetch).toHaveClass("opacity-100", "delay-200");
  });
});
