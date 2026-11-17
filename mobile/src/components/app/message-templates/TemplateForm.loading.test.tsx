import { fireEvent, render, screen } from "@testing-library/react";

import { TemplateForm } from "./TemplateForm";
import { TemplateEditor } from "../my-templates/template-editor";
import { t } from "@/lib/i18n/translations";

let mockPending = true;
let mockLocale: "ko" | "en" = "ko";
const mockCreate = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("@/hooks/use-message-templates", () => ({
  useCreateMessageTemplate: () => ({ isPending: mockPending, mutate: mockCreate }),
  useUpdateMessageTemplate: () => ({ isPending: false, mutate: jest.fn() }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => mockLocale }));
jest.mock("../my-templates/variable-configurator", () => ({ VariableConfigurator: () => null }));
jest.mock("../my-templates/variable-inserter", () => ({ VariableInserter: () => null }));
jest.mock("../my-templates/template-preview", () => ({ TemplatePreview: () => null }));

function expectBusySave(name: string): void {
  const button = screen.getByRole("button", { name });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
}

it("hides the form save label while pending and restores saving on completion", () => {
  const onSubmit = jest.fn();
  const { rerender } = render(<TemplateForm mode="create" isPending onSubmit={onSubmit} />);
  expectBusySave("저장 중");
  fireEvent.change(screen.getByLabelText(/템플릿 이름/), { target: { value: "QA-템플릿" } });
  fireEvent.click(screen.getByRole("button", { name: "저장 중" }));
  expect(onSubmit).not.toHaveBeenCalled();
  rerender(<TemplateForm mode="create" isPending={false} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "QA-템플릿" }));
});

it.each(["ko", "en"] as const)("uses the %s editor busy label without displaying it", (locale) => {
  mockLocale = locale;
  mockPending = true;
  const { rerender } = render(<TemplateEditor />);
  expectBusySave(t(locale, "common.saving").replace(/[.…]+$/, ""));
  mockPending = false;
  rerender(<TemplateEditor />);
  expect(screen.getByRole("button", { name: t(locale, "common.save") })).not.toHaveAttribute("data-loading");
});
