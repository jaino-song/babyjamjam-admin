import { fireEvent, render, screen } from "@testing-library/react";

import type { SystemAdminBranchRequest } from "@/lib/api/system-admin";

import { SystemAdminBranchForm } from "./SystemAdminBranchForm";

describe("branch edit submission", () => {
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
        owner: null,
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
        ownerId: null,
        isActive: false,
      }));
    },
  );
});
