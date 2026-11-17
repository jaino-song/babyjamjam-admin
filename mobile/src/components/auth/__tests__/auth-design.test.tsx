import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";

import PrivacyPage from "@/app/(shell)/privacy/page";
import TermsPage from "@/app/(shell)/terms/page";
import { AuthCard } from "../auth-card";

const css = readFileSync(path.join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"), "utf8");

it.each([".auth-input", '[data-slot="auth-register-page"] .auth-input'])("sizes %s as a 44px input with 12px corners and 16px text", (selector) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rule = css.slice(start, css.indexOf("}", start));
  for (const declaration of ["height: 44px;", "border-radius: 12px;", "font-size: 16px;", "padding: 0 16px;"]) expect(rule).toContain(declaration);
});

it.each([PrivacyPage, TermsPage])("uses shared legal spacing for %p", (Page) => {
  const { container } = render(<Page />);
  const content = container.querySelector('[data-slot="auth-card-content"]');
  expect(content).toHaveClass("gap-[25px]!", "[&>.list-title]:h-auto!", "[&>.list-title]:min-h-0!", "[&>.list-title]:py-0!", "[&>p:last-child]:pt-[30px]");
  expect(content?.lastElementChild).toContainElement(screen.getByRole("link", { name: "로그인으로 돌아가기" }));
});

it("preserves default auth-card spacing outside legal pages", () => {
  const { container } = render(<AuthCard data-component="mobile_login_card">내용</AuthCard>);
  expect(container.querySelector('[data-slot="auth-card-content"]')).not.toHaveClass("gap-[25px]!");
});
