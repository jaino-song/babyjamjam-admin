import { render, screen } from "@testing-library/react";

import SystemAdminPage from "./page";

jest.mock("@/components/app/system-admin/OwnerAdminConsole", () => ({
  OwnerAdminConsole: ({
    initialSectionId,
    initialTemplateKey,
  }: {
    initialSectionId?: string;
    initialTemplateKey?: string | null;
  }) => (
    <div
      data-testid="owner-admin-console"
      data-section={initialSectionId}
      data-template={initialTemplateKey ?? ""}
    />
  ),
}));

describe("SystemAdminPage deep links", () => {
  it("passes the templates section and template key through before async catalog loading", async () => {
    const page = await SystemAdminPage({
      searchParams: Promise.resolve({ section: "templates", template: "FUTURE_TEMPLATE" }),
    });

    render(page);

    expect(screen.getByTestId("owner-admin-console")).toHaveAttribute("data-section", "templates");
    expect(screen.getByTestId("owner-admin-console")).toHaveAttribute("data-template", "FUTURE_TEMPLATE");
  });

  it("defaults an unrelated section to branch management", async () => {
    const page = await SystemAdminPage({
      searchParams: Promise.resolve({ section: "accounts" }),
    });

    render(page);

    expect(screen.getByTestId("owner-admin-console")).toHaveAttribute("data-section", "branches");
    expect(screen.getByTestId("owner-admin-console")).toHaveAttribute("data-template", "");
  });
});
