import { act, render, screen } from "@testing-library/react";

import { TemplateEditor } from "../template-editor";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("@/hooks/use-message-templates", () => ({
  useCreateMessageTemplate: () => ({ mutate: jest.fn(), isPending: true }),
  useUpdateMessageTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));

it("announces a dotless saving label while preserving the idle save content", async () => {
  await act(async () => { render(<TemplateEditor />); });
  const save = screen.getByRole("button", { name: "저장 중" });
  expect(save).toBeDisabled();
  expect(save.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
  expect(save.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(save.querySelectorAll('[data-slot="button-spinner"]')).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "저장 중..." })).not.toBeInTheDocument();
});
