import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";

import { MobileDetailSlideUp } from "../mobile-detail-slideup";

const css = fs.readFileSync(path.join(__dirname, "../mobile-detail-slideup.module.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

it("renders secondary then primary using the existing action classes", () => {
  render(
    <MobileDetailSlideUp
      name="mobile_tests_slideup"
      open
      onClose={jest.fn()}
      title="상세"
      secondaryAction={{ label: "취소", onClick: jest.fn() }}
      primaryAction={{ label: "진행", onClick: jest.fn() }}
    >
      내용
    </MobileDetailSlideUp>,
  );
  const cancel = screen.getByRole("button", { name: "취소" });
  const proceed = screen.getByRole("button", { name: "진행" });
  expect(cancel).toHaveClass("actionButton", "secondaryAction");
  expect(proceed).toHaveClass("actionButton", "primaryAction");
  expect(cancel.parentElement).toHaveClass("footer");
  expect(cancel.nextElementSibling).toBe(proceed);
});

it.each(["primary", "secondary"] as const)("allows a sole %s action to fill the row", (kind) => {
  render(
    <MobileDetailSlideUp
      name="mobile_tests_slideup"
      open
      onClose={jest.fn()}
      title="상세"
      {...(kind === "primary"
        ? { primaryAction: { label: "확인", onClick: jest.fn() } }
        : { secondaryAction: { label: "확인", onClick: jest.fn() } })}
    >
      내용
    </MobileDetailSlideUp>,
  );
  const action = screen.getByRole("button", { name: "확인" });
  expect(within(action.parentElement as HTMLElement).getAllByRole("button")).toEqual([action]);
  expect(rule(".footer")).toContain("display: flex;");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  try {
    expect(getComputedStyle(action).gridColumn).toBe("1 / -1");
  } finally {
    style.remove();
  }
});

it("uses 40px pills and a 1:2 action ratio without changing secondary colors", () => {
  for (const declaration of ["border-radius: 9999px;", "height: 40px;", "min-height: 0;", "box-sizing: border-box;", "min-width: 0;"]) {
    expect(rule(".actionButton")).toContain(declaration);
  }
  expect(rule(".secondaryAction")).toContain("flex: 1 1 0;");
  expect(rule(".primaryAction")).toContain("flex: 2 1 0;");
  expect(rule(".secondaryAction")).toContain("background: hsl(220 20% 97%);");
  expect(rule(".secondaryAction")).toContain("color: hsl(var(--v3-text));");
});

it("uses exact grid tracks only for the two-action footer", () => {
  const paired = rule(".footer:has(> :first-child:nth-last-child(2))");
  expect(paired).toContain("display: grid;");
  expect(paired).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);");
});
