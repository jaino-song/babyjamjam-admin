import { render } from "@testing-library/react";

import { StatMini } from "../StatMini";

function TestIcon({ className }: { className?: string }) {
  return <svg aria-hidden="true" className={className} />;
}

describe("StatMini marker", () => {
  it("renders the optional marker pinned to the card", () => {
    const { container } = render(
      <StatMini data-component="desktop_test_marker" icon={TestIcon} value={5} label="처리중" marker="실패 2" />,
    );

    const marker = container.querySelector('[data-slot="stat-mini-marker"]');
    expect(marker).toHaveTextContent("실패 2");
    expect(container.querySelector('[data-component="desktop_test_marker"]')).toHaveClass("relative");
  });

  it("changes nothing for callers that pass no marker", () => {
    const { container } = render(
      <StatMini data-component="desktop_test_plain" icon={TestIcon} value={5} label="처리중" />,
    );

    expect(container.querySelector('[data-slot="stat-mini-marker"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_test_plain"]')).not.toHaveClass("relative");
  });
});
