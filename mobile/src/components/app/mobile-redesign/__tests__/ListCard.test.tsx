import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ListCard } from "../primitives";

const CARD_DATA_COMPONENT = "mobile_tests_list-card";

function renderCard(props: Partial<ComponentProps<typeof ListCard>> = {}) {
  return render(
    <ListCard
      data-component={CARD_DATA_COMPONENT}
      title="테스트 목록"
      filters={[]}
      {...props}
    >
      <p>행</p>
    </ListCard>,
  );
}

describe("ListCard", () => {
  it("renders the default load-more footer when the prop is omitted", async () => {
    const onLoadMore = jest.fn();
    renderCard({ onLoadMore });

    const button = screen.getByRole("button", { name: "더 많은 항목 불러오기" });
    expect(button).toHaveTextContent("탭하여 더보기");
    expect(button).toHaveAttribute(
      "data-component",
      `${CARD_DATA_COMPONENT}_load-more_button`,
    );
    expect(
      document.querySelector(`[data-component="${CARD_DATA_COMPONENT}_load-more"]`),
    ).not.toBeNull();

    await userEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit true the same as an omitted prop", () => {
    renderCard({ loadMore: true });

    expect(screen.getByRole("button", { name: "더 많은 항목 불러오기" })).toBeInTheDocument();
  });

  it("keeps the default button visible but inert without a handler", async () => {
    renderCard();

    const button = screen.getByRole("button", { name: "더 많은 항목 불러오기" });
    expect(button).not.toBeDisabled();

    await userEvent.click(button);
    expect(button).toBeInTheDocument();
  });

  it("hides the footer when loadMore is false or null", () => {
    const { rerender } = renderCard({ loadMore: false });
    expect(screen.queryByRole("button", { name: "더 많은 항목 불러오기" })).toBeNull();
    expect(
      document.querySelector(`[data-component="${CARD_DATA_COMPONENT}_load-more"]`),
    ).toBeNull();

    rerender(
      <ListCard
        data-component={CARD_DATA_COMPONENT}
        title="테스트 목록"
        filters={[]}
        loadMore={null}
      >
        <p>행</p>
      </ListCard>,
    );
    expect(
      document.querySelector(`[data-component="${CARD_DATA_COMPONENT}_load-more"]`),
    ).toBeNull();
  });

  it("renders custom footer content instead of the default button", () => {
    renderCard({
      loadMore: (
        <button type="button" data-component={`${CARD_DATA_COMPONENT}_load-more_custom`}>
          직접 만든 더보기
        </button>
      ),
    });

    expect(screen.getByRole("button", { name: "직접 만든 더보기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 많은 항목 불러오기" })).toBeNull();
  });

  it("locks the default button while the next page loads", () => {
    renderCard({ onLoadMore: jest.fn(), isLoadingMore: true });

    const button = screen.getByRole("button", { name: "더 많은 항목 불러오기" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
  });
});
