import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarAccountMenu } from "../SidebarAccountMenu";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const defaultProps = {
  name: "송진호",
  roleLabel: "오너",
  profileImage: "",
  initials: "송진",
};

function renderMenu(props: Partial<typeof defaultProps> = {}) {
  return render(<SidebarAccountMenu {...defaultProps} {...props} />);
}

const getTrigger = () => screen.getByRole("button", { name: /송진호/ });

beforeEach(() => {
  mockPush.mockClear();
});

describe("SidebarAccountMenu", () => {
  it("renders the profile trigger collapsed by default", () => {
    renderMenu();
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    // Collapsed: menu items are hidden from the accessibility tree.
    expect(screen.queryByRole("menuitem", { name: /로그아웃/ })).toBeNull();
  });

  it("opens the menu when the trigger is clicked", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: /지점 변경/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /로그아웃/ })).toBeInTheDocument();
  });

  it("toggles back to closed on a second trigger click", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.click(getTrigger());
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates to /select-branch and closes when 지점 변경 is chosen", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /지점 변경/ }));
    expect(mockPush).toHaveBeenCalledWith("/select-branch");
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates to /logout when 로그아웃 is chosen", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /로그아웃/ }));
    expect(mockPush).toHaveBeenCalledWith("/logout");
  });

  it("closes when Escape is pressed", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when clicking outside the component", () => {
    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.mouseDown(document.body);
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });
});
