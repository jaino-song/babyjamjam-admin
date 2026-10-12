import { fireEvent, render, screen } from "@testing-library/react";
import { AxiosError } from "axios";
import type { ReactNode } from "react";

import EditSystemTemplatePage from "./page";
import { useSystemTemplate } from "@/features/system-templates/hooks";

jest.mock("react", () => ({ ...jest.requireActual("react"), use: () => ({ templateKey: "SERVICE_INFO" }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock("@/features/system-templates/hooks", () => ({ useSystemTemplate: jest.fn() }));
jest.mock("@/components/app/mobile-redesign/mobile-detail-slideup", () => ({
  MobileDetailSlideUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockUseSystemTemplate = useSystemTemplate as jest.Mock;
const params = Promise.resolve({ templateKey: "SERVICE_INFO" });
const template = { templateKey: "SERVICE_INFO", name: "서비스 안내", description: "안내 템플릿", content: "저장된 메시지 내용", requiredVariables: [] };

function httpError(status: number) {
  return new AxiosError("Request failed", undefined, undefined, undefined, {
    status, statusText: "Error", data: {}, headers: {}, config: { headers: {} },
  } as NonNullable<AxiosError["response"]>);
}

describe("system template failed loads", () => {
  beforeEach(() => {
    mockUseSystemTemplate.mockReturnValue({ data: template, branchId: "branch-1", isLoading: false, isError: false, isFetching: false, refetch: jest.fn() });
  });

  it.each([httpError(500), new AxiosError("Network Error", "ERR_NETWORK")])("shows retry rather than not-found for %s", (error) => {
    const refetch = jest.fn();
    mockUseSystemTemplate.mockReturnValue({ data: undefined, branchId: "branch-1", isLoading: false, isError: true, isFetching: false, error, refetch });
    render(<EditSystemTemplatePage params={params} />);
    expect(screen.getByRole("alert")).toHaveTextContent("템플릿을 불러오지 못했습니다");
    expect(screen.queryByText("템플릿을 찾을 수 없습니다.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { branchId: "branch-1", isError: true, error: httpError(404) },
    { branchId: null, isError: false, error: null },
  ])("keeps the real not-found state for %s", (state) => {
    mockUseSystemTemplate.mockReturnValue({ ...state, data: undefined, isLoading: false, isFetching: false, refetch: jest.fn() });
    render(<EditSystemTemplatePage params={params} />);
    expect(screen.getByText("템플릿을 찾을 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps cached template content below one inline notice (fetching=%s)", (isFetching) => {
    const refetch = jest.fn();
    mockUseSystemTemplate.mockReturnValue({ data: template, branchId: "branch-1", isLoading: false, isError: true, isFetching, error: httpError(500), refetch });
    render(<EditSystemTemplatePage params={params} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    const content = screen.getByText("저장된 메시지 내용");
    expect(alert.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("템플릿을 찾을 수 없습니다.")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "다시 시도" });
    if (isFetching) expect(retry).toBeDisabled();
    else {
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);
    }
  });

  it("shows successful template content without an alert", () => {
    render(<EditSystemTemplatePage params={params} />);
    expect(screen.getByText("저장된 메시지 내용")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the existing loading state during a cold retry", () => {
    mockUseSystemTemplate.mockReturnValue({ data: undefined, branchId: "branch-1", isLoading: true, isError: false, isFetching: true });
    const { container } = render(<EditSystemTemplatePage params={params} />);
    expect(container.querySelector('[data-component$="_loading"]')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("템플릿을 찾을 수 없습니다.")).not.toBeInTheDocument();
  });
});
