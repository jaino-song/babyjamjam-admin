import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewRow, ReviewSection } from "./ReviewSection";

const BASE = "mobile_test_review";

describe("ReviewSection", () => {
  it("is a region named by its title, with a named edit button", async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    render(
      <ReviewSection data-component={BASE} titleId="review-mom" title="산모" tone="mom" onEdit={onEdit}>
        <p>row</p>
      </ReviewSection>,
    );

    const region = screen.getByRole("region", { name: "산모" });
    const edit = within(region).getByRole("button", { name: "산모 수정" });
    expect(edit).toHaveTextContent("수정");
    expect(screen.getByText("산모")).toHaveAttribute("id", "review-mom");

    await user.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("supports a custom visible edit label while keeping the accessible name", () => {
    render(
      <ReviewSection
        data-component={BASE}
        titleId="review-etc"
        title="서비스 기록"
        tone="etc"
        onEdit={() => {}}
        editLabel="고치기"
      >
        <p>row</p>
      </ReviewSection>,
    );

    expect(screen.getByRole("button", { name: "서비스 기록 수정" })).toHaveTextContent("고치기");
  });

  it("omits the edit button without onEdit", () => {
    render(
      <ReviewSection data-component={BASE} titleId="t" title="신생아" tone="baby">
        <p>row</p>
      </ReviewSection>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("colours the tag by tone", () => {
    const { rerender } = render(
      <ReviewSection data-component={BASE} titleId="t" title="산모" tone="mom">
        <p>row</p>
      </ReviewSection>,
    );
    expect(screen.getByText("산모")).toHaveClass("bg-v3-burgundy-light", "text-v3-burgundy");

    rerender(
      <ReviewSection data-component={BASE} titleId="t" title="신생아" tone="baby">
        <p>row</p>
      </ReviewSection>,
    );
    expect(screen.getByText("신생아")).toHaveClass("bg-v3-primary-light", "text-v3-primary");

    rerender(
      <ReviewSection data-component={BASE} titleId="t" title="서비스 기록" tone="etc">
        <p>row</p>
      </ReviewSection>,
    );
    expect(screen.getByText("서비스 기록")).toHaveClass("bg-v3-dim-white", "text-v3-text-muted");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ReviewSection data-component={BASE} titleId="t" title="산모" tone="mom" onEdit={() => {}}>
        <p>row</p>
      </ReviewSection>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ReviewSection");
    for (const suffix of ["header", "header_title", "header_edit", "rows"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});

describe("ReviewRow", () => {
  it("is a group named by its label element", () => {
    render(
      <ReviewSection data-component={BASE} titleId="review-mom" title="산모" tone="mom">
        <ReviewRow
          data-component={`${BASE}_row`}
          labelId="row-perineum"
          label="회음절개부위"
          value="이상없음"
        />
      </ReviewSection>,
    );

    const mom = screen.getByRole("region", { name: "산모" });
    const row = within(mom).getByRole("group", { name: "회음절개부위" });
    expect(row).toHaveTextContent("이상없음");
    expect(screen.getByText("회음절개부위")).toHaveAttribute("id", "row-perineum");
  });

  it("inline lays label left / value right; note stacks them", () => {
    const { rerender } = render(
      <ReviewRow data-component={`${BASE}_row`} labelId="r" label="체온" value="36.5" />,
    );
    expect(screen.getByRole("group")).toHaveClass("flex", "justify-between");

    rerender(<ReviewRow data-component={`${BASE}_row`} labelId="r" label="특이사항" value="없음" layout="note" />);
    expect(screen.getByRole("group")).toHaveClass("block");
    expect(screen.getByRole("group")).not.toHaveClass("justify-between");
  });

  it("styles the value by tone", () => {
    const { rerender } = render(
      <ReviewRow data-component={`${BASE}_row`} labelId="r" label="체온" value="미입력" tone="empty" />,
    );
    expect(screen.getByText("미입력")).toHaveClass("text-v3-text-muted/70");

    rerender(<ReviewRow data-component={`${BASE}_row`} labelId="r" label="체온" value="정상" tone="ok" />);
    expect(screen.getByText("정상")).toHaveClass("text-v3-primary");

    rerender(<ReviewRow data-component={`${BASE}_row`} labelId="r" label="체온" value="36.5" />);
    expect(screen.getByText("36.5")).toHaveClass("text-v3-dark");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ReviewRow data-component={`${BASE}_row`} labelId="r" label="체온" value="36.5" />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ReviewRow");
    expect(container.querySelector(`[data-component="${BASE}_row_label"]`)).not.toBeNull();
    expect(container.querySelector(`[data-component="${BASE}_row_value"]`)).not.toBeNull();
  });
});
