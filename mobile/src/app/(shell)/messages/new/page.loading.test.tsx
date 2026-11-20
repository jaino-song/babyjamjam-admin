import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "./page";

let mockOptionsLoading = true;
const mockApiPost = jest.fn();
const mockDuplicateCheck = jest.fn();
let mockBranchId = "branch-a";
const mockUseSystemTemplate = jest.fn();
const mockUseMessageTemplates = jest.fn();
const mockUseSystemTemplates = jest.fn();
let mockSearchParams = new URLSearchParams();

const SYSTEM_TEMPLATE_KEYS = [
  "GREETING",
  "INFO",
  "PRICE_INFO",
  "REMINDER",
  "SERVICE_INFO",
  "SURVEY",
  "THANKS",
  "CONTRACT_REMINDER",
] as const;

type TemplateQuery = {
  branchId: string | null;
  data: {
    id: string;
    templateKey: string;
    name: string;
    content: string;
    requiredVariables: [];
    customVariables: [];
    updatedAt: string;
  } | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
};

const templateQueries: Record<string, TemplateQuery> = {};

function readyTemplate(key: string, content: string, branchId = "branch-a"): TemplateQuery {
  return {
    branchId,
    data: {
      id: `${key}-${branchId}`,
      templateKey: key,
      name: `${key} 지점 템플릿`,
      content,
      requiredVariables: [],
      customVariables: [],
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: true,
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/messages/new",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { id: "user-1", role: "user", branchRole: "manager", branchId: mockBranchId },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
  useSystemTemplates: () => mockUseSystemTemplates(),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => mockUseMessageTemplates(),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useBankAccountInfos: () => ({ data: [], isLoading: mockOptionsLoading }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: mockOptionsLoading }),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn((url: string, payload: unknown, config: unknown) => url === "/message-deliveries/sms/duplicate-check"
      ? mockDuplicateCheck(url, payload, config)
      : mockApiPost(url, payload, config)),
  },
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
  useMessagesPermissionGuard: () => ({
    isLoading: false,
    needsSenderApproval: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NewMessagePage />
    </QueryClientProvider>,
  );
}

async function addManualRecipient() {
  const receiverInput = screen.getByLabelText(/휴대 전화번호/);
  fireEvent.focus(receiverInput);
  fireEvent.change(receiverInput, { target: { value: "010-1234-5678" } });
  fireEvent.keyDown(receiverInput, { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /수신자 제거/ })).toBeInTheDocument();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOptionsLoading = true;
  mockBranchId = "branch-a";
  mockSearchParams = new URLSearchParams({ template: "PRICE_INFO" });
  mockUseMessageTemplates.mockReturnValue({ data: [] });
  mockUseSystemTemplates.mockReturnValue({ data: [], isSuccess: true, isLoading: false, isFetching: false, isError: false });
  SYSTEM_TEMPLATE_KEYS.forEach((key) => { templateQueries[key] = readyTemplate(key, `${key} 기본 문구`); });
  mockUseSystemTemplate.mockImplementation((key: string) => templateQueries[key]);
});

it("shows named inline Spinners with empty select placeholders until price and bank options load", () => {
  const view = renderPage();
  for (const label of ["서비스 기간을 불러오는 중", "지역을 불러오는 중"]) {
    const status = screen.getByRole("status", { name: label });
    expect(status).toHaveAttribute("data-slot", "loading-state");
    expect(status.tagName).toBe("SPAN");
    expect(status).toHaveClass("inline-flex");
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(label)).toHaveClass("sr-only");
    expect(status.closest('[role="combobox"]')).toBeDisabled();
  }
  expect(screen.queryByText("불러오는 중")).not.toBeInTheDocument();
  mockOptionsLoading = false;
  view.rerender(<QueryClientProvider client={new QueryClient()}><NewMessagePage /></QueryClientProvider>);
  expect(screen.queryByRole("status", { name: /불러오는 중/ })).not.toBeInTheDocument();
});

it("keeps the chip X at 18px and extends its hit area to 44px", async () => {
  renderPage();
  await addManualRecipient();
  const remove = screen.getByRole("button", { name: /수신자 제거/ });
  expect(remove).toHaveClass("recipientChipX");
  expect(remove).toHaveAttribute("data-slot", "recipient-chip-x");
  const css = readFileSync(path.join(__dirname, "page.module.css"), "utf8");
  const face = css.match(/\.recipientChipX \{[^}]*}/)?.[0];
  expect(face).toContain("width: 18px;");
  expect(face).toContain("height: 18px;");
  expect(face).toContain("position: relative;");
  const hitArea = css.match(/\.recipientChipX::after \{[^}]*}/)?.[0];
  expect(hitArea).toContain('content: "";');
  expect(hitArea).toContain("position: absolute;");
  expect(hitArea).toContain("inset: -13px;");
  fireEvent.click(remove);
  expect(screen.queryByRole("button", { name: /수신자 제거/ })).not.toBeInTheDocument();
});
