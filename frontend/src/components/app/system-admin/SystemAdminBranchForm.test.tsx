import { fireEvent, render, screen } from "@testing-library/react";

import type { SystemAdminBranchRequest } from "@/lib/api/system-admin";

import { SystemAdminBranchForm } from "./SystemAdminBranchForm";

describe("branch edit submission", () => {
  it.each([
    ["create", "지점 추가"],
    ["edit", "변경사항 저장"],
  ] as const)("shows only a spinner while saving in %s mode", (mode, idleLabel) => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(
      <SystemAdminBranchForm
        mode={mode}
        managerOptions={[]}
        isSubmitting={false}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("button", { name: idleLabel })).toBeEnabled();

    rerender(
      <SystemAdminBranchForm
        mode={mode}
        managerOptions={[]}
        isSubmitting
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "저장 중" });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");
    expect(saveButton).toHaveAttribute("data-loading", "");
    const idleContent = saveButton.querySelector('[data-slot="button-idle"]');
    expect(idleContent).toHaveAttribute("aria-hidden", "true");
    expect(idleContent).toHaveClass("contents", "invisible");
    expect(idleContent).toHaveTextContent(idleLabel);
    expect(saveButton.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]'))
      .toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("저장 중")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    fireEvent.click(saveButton);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <SystemAdminBranchForm
        mode={mode}
        managerOptions={[]}
        isSubmitting={false}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    const idleButton = screen.getByRole("button", { name: idleLabel });
    expect(idleButton).toBeEnabled();
    expect(idleButton).not.toHaveAttribute("aria-busy");
    expect(idleButton).not.toHaveAttribute("data-loading");
    expect(idleButton.querySelector('[data-slot="button-spinner"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "저장 중" })).not.toBeInTheDocument();
  });

  it.each([null, undefined, "기존 구역"])(
    "submits a region edit when the saved district is %s",
    (district) => {
      const onSubmit = jest.fn();
      const branch = {
        id: "qa-branch",
        name: "QA 검수 지점",
        slug: "qa-branch",
        district,
        region: null,
        address: null,
        phone: null,
        email: null,
        admin: null,
        isActive: false,
      } as SystemAdminBranchRequest;

      render(
        <SystemAdminBranchForm
          mode="edit"
          branch={branch}
          managerOptions={[]}
          isSubmitting={false}
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );
      fireEvent.change(screen.getByRole("textbox", { name: "지역" }), {
        target: { value: "QA 검수 전용" },
      });
      fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        region: "QA 검수 전용",
        district: district ?? undefined,
        adminId: null,
        isActive: false,
      }));
    },
  );
});
