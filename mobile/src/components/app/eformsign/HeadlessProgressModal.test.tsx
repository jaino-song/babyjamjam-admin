import { render, screen } from "@testing-library/react";

import { INITIAL_HEADLESS_PROGRESS } from "@/lib/eformsign/headless-progress";

import { HeadlessProgressModal } from "./HeadlessProgressModal";

describe("HeadlessProgressModal title alignment", () => {
  it("centers the progress title while retaining its identity and accessible name", () => {
    render(
      <HeadlessProgressModal
        data-component="mobile_contracts_headless-progress"
        open
        steps={[]}
        progress={INITIAL_HEADLESS_PROGRESS}
      />,
    );

    const title = screen.getByRole("heading", { name: "전자문서 처리 중" });
    expect(title).toHaveClass("text-center");
    expect(title).not.toHaveClass("text-left");
    expect(title).toHaveAttribute("data-component", "mobile_contracts_headless-progress_title");
  });
});
