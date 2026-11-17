import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

import { HolidayPageShell } from "../HolidayPageShell";
import { HolidayList } from "../HolidayList";
import styles from "../holiday-page-shell.module.css";

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = readFileSync(join(__dirname, "../holiday-page-shell.module.css"), "utf8");
  document.head.append(style);
});

afterEach(() => style.remove());

it("keeps the card above the nav and scrolls its body when the list reaches its minimum height", () => {
  const { container } = render(<HolidayPageShell title="지점 공휴일"><div>Controls</div><div className={styles.listScroll} data-slot="holiday-list-scroll">List</div></HolidayPageShell>);
  expect(container.querySelector('[data-slot="holiday-settings-content"]')).toHaveStyle({ display: "flex", overflow: "hidden", padding: "12px 14px 76px" });
  expect(container.querySelector('[data-slot="holiday-settings-card"]')).toHaveStyle({ flex: "1", minHeight: "0", overflow: "hidden", marginBottom: "0" });
  expect(container.querySelector('[data-slot="holiday-settings-body"]')).toHaveStyle({ display: "flex", minHeight: "0", overflowY: "auto" });
  expect(screen.getByText("Controls")).toHaveStyle({ flexShrink: "0" });
  expect(screen.getByText("List")).toHaveStyle({ overflowY: "auto", minHeight: "128px", flex: "1" });
});

it("keeps the full holiday list from shrinking inside the minimum-height scroller", () => {
  const { container } = render(
    <HolidayPageShell title="지점 공휴일">
      <div>Controls</div>
      <div className={styles.listScroll} data-slot="holiday-list-scroll">
        <HolidayList
          holidays={Array.from({ length: 22 }, (_, index) => ({
            date: `2026-12-${String(index + 1).padStart(2, "0")}`,
            name: `공휴일 ${index + 1}`,
            source: "public" as const,
            excluded: false,
            overrideId: null,
          }))}
          today="2026-11-17"
          onExclude={jest.fn()}
          onRestore={jest.fn()}
          onDelete={jest.fn()}
        />
      </div>
    </HolidayPageShell>,
  );
  const scroller = container.querySelector('[data-slot="holiday-list-scroll"]');
  expect(scroller).toHaveStyle({ minHeight: "128px", overflowY: "auto" });
  expect(scroller?.parentElement).toHaveStyle({ minHeight: "0", overflowY: "auto" });
  expect(screen.getByRole("list")).toHaveStyle({ flexShrink: "0" });
  expect(screen.getAllByRole("listitem")).toHaveLength(22);
  expect(scroller).toContainElement(screen.getByText("공휴일 22"));
});
