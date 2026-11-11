import { fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";

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
    expect(onSlotClick).toHaveBeenNthCalledWith(1, items[1], 1, second);
    expect(onSlotClick).toHaveBeenNthCalledWith(2, items[1], 1, second);

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
    expect(screen.getByRole("button", { name: "사용자 행" })).not.toHaveAttribute("style");
    expect(screen.getByRole("button", { name: "사용자 행" })).not.toHaveAttribute("data-source-component");
    expect(screen.getByRole("button", { name: "사용자 행" })).not.toHaveClass(
      "border-2", "border-v3-primary", "bg-v3-primary-light",
    );
    rerender(list(true));
    expect(screen.getByText("사용자 로딩")).not.toHaveAttribute("style");
    expect(screen.getByText("사용자 로딩")).not.toHaveAttribute("data-source-component");
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


describe("AnimatedSlotList nested interactions", () => {
  it.each(["card", "unstyled"] as const)("keeps actual Switch pointer and keyboard actions separate in %s rows", (itemVariant) => {
    const onSlotClick = jest.fn();
    const onCheckedChange = jest.fn();
    render(
      <AnimatedSlotList
        items={[{ id: "synthetic-switch" }]}
        isLoading={false}
        itemVariant={itemVariant}
        onSlotClick={onSlotClick}
        render={() => <Switch aria-label="합성 스위치" onCheckedChange={onCheckedChange} />}
      />,
    );
    const control = screen.getByRole("switch", { name: "합성 스위치" });
    const thumb = control.querySelector('[data-slot="switch-thumb"]');
    expect(thumb).not.toBeNull();

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
    fireEvent.click(thumb!);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenNthCalledWith(2, false);
    expect(onSlotClick).not.toHaveBeenCalled();

    control.focus();
    expect(control).toHaveFocus();
    // Exercise bubbled Enter without imposing a toggle contract on Radix.
    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.keyUp(control, { key: "Enter" });
    expect(onSlotClick).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(control, { key: " " })).toBe(true);
    fireEvent.keyUp(control, { key: " " });
    // JSDOM has no native Space activation. Dispatch its resulting button click.
    fireEvent.click(control, { detail: 0 });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenNthCalledWith(3, true);
    expect(onSlotClick).not.toHaveBeenCalled();
  });

  it("preserves nested button, SVG and anchor actions without selecting the row", () => {
    const onSlotClick = jest.fn();
    const onAction = jest.fn();
    const onNavigate = jest.fn();
    render(
      <AnimatedSlotList
        items={[{ id: "synthetic-actions" }]}
        isLoading={false}
        onSlotClick={onSlotClick}
        render={() => <>
          <button type="button" onClick={onAction}>
            <span>합성 버튼</span>
            <svg aria-label="합성 아이콘"><path d="M0 0h1" /></svg>
          </button>
          <a href="#synthetic-destination" onClick={onNavigate}><span>합성 링크</span></a>
        </>}
      />,
    );
    fireEvent.click(screen.getByText("합성 버튼"));
    const icon = screen.getByLabelText("합성 아이콘");
    fireEvent.click(icon.firstChild!);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[0][0].defaultPrevented).toBe(false);
    const link = screen.getByRole("link", { name: "합성 링크" });
    expect(fireEvent.click(screen.getByText("합성 링크"))).toBe(true);
    expect(link).toHaveAttribute("href", "#synthetic-destination");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onSlotClick).not.toHaveBeenCalled();
  });

  it.each(["card", "unstyled"] as const)("selects the correct item/index from the %s row and its ordinary body", (itemVariant) => {
    const onSlotClick = jest.fn();
    const items = [{ id: "synthetic-first" }, { id: "synthetic-second" }];
    render(
      <AnimatedSlotList
        items={items}
        isLoading={false}
        itemVariant={itemVariant}
        onSlotClick={onSlotClick}
        render={({ item }) => <span>{item?.id}</span>}
      />,
    );
    const row = screen.getByRole("button", { name: "synthetic-second" });
    fireEvent.click(row);
    fireEvent.click(screen.getByText("synthetic-second"));
    row.focus();
    expect(row).toHaveFocus();
    expect(fireEvent.keyDown(row, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(row, { key: " " })).toBe(false);
    expect(onSlotClick).toHaveBeenCalledTimes(4);
    for (let call = 1; call <= 4; call += 1) {
      expect(onSlotClick).toHaveBeenNthCalledWith(call, items[1], 1, row);
    }
  });

  it.each(["card", "unstyled"] as const)("does not select explicitly noninteractive %s rows", (itemVariant) => {
    const onSlotClick = jest.fn();
    render(
      <AnimatedSlotList
        items={[{ id: "synthetic-disabled" }]}
        isLoading={false}
        itemVariant={itemVariant}
        getSlotState={() => ({ isInteractive: false })}
        onSlotClick={onSlotClick}
        render={() => "합성 비활성 행"}
      />,
    );
    const row = screen.getByText("합성 비활성 행");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(onSlotClick).not.toHaveBeenCalled();
  });

  it("honors prevented pointer and row keyboard events", () => {
    const onSlotClick = jest.fn();
    render(
      <div onKeyDownCapture={(event) => event.preventDefault()}>
        <AnimatedSlotList
          items={[{ id: "synthetic-prevented" }]}
          isLoading={false}
          onSlotClick={onSlotClick}
          render={() => <span onClick={(event) => event.preventDefault()}>합성 취소</span>}
        />
      </div>,
    );
    fireEvent.click(screen.getByText("합성 취소"));
    const row = screen.getByRole("button", { name: "합성 취소" });
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onSlotClick).not.toHaveBeenCalled();
  });
});

test('compact slots retain accessible item names and forward their DOM element on mouse and keyboard selection', () => {
  const selected = jest.fn(); const item = { id: 'job' };
  const { container, rerender } = render(<AnimatedSlotList items={[item]} isLoading={false} size="compact" itemVariant="job"
    getSlotState={() => ({ isEmphasized: true })} getSlotProps={() => ({ 'aria-label': '전자문서 상세 보기', 'data-slot': 'job-card' })}
    onSlotClick={selected} render={() => '고객'} />);
  const card = screen.getByRole('button', { name: '전자문서 상세 보기' });
  expect(card).toHaveAttribute('data-slot', 'job-card');
  expect(card).toHaveClass('h-auto', 'rounded-[calc(16px*var(--glint-ui-scale,1))]', 'px-[calc(14px*var(--glint-ui-scale,1))]', 'py-[calc(10px*var(--glint-ui-scale,1))]', 'bg-v3-primary-light/20', 'hover:bg-v3-primary-light/55');
  fireEvent.click(card); fireEvent.keyDown(card, { key: 'Enter' }); fireEvent.keyDown(card, { key: ' ' });
  expect(selected.mock.calls).toEqual([[item, 0, card], [item, 0, card], [item, 0, card]]);
  expect(card.className).not.toContain('!');
  rerender(<AnimatedSlotList items={[item]} isLoading={false} render={() => '고객'} />);
  expect(container.querySelector('[data-slot="animated-slot-list-item"]')).toHaveClass('h-[calc(94px*var(--glint-ui-scale,1))]');
});
