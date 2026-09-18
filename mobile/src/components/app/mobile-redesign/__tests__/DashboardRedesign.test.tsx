import { fireEvent, render, screen, within } from "@testing-library/react";
import { User } from "lucide-react";

import { DashboardRedesign, type DashboardRedesignProps } from "../DashboardRedesign";

const props: DashboardRedesignProps = {
  analytics: [{ label: "서비스 진행 중", value: "0", icon: User, tone: "primary" }],
  sections: [],
  filters: [{ label: "전체", count: "0" }],
  loadMore: false,
};

describe("DashboardRedesign query states", () => {
  it("explains a successful empty recent-activity result", () => {
    render(<DashboardRedesign {...props} />);
    expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
  });

  it("distinguishes an empty filter from an empty dashboard", () => {
    render(<DashboardRedesign {...props} activeFilter="종료 예정" />);
    expect(screen.getByText("서비스 종료 예정 고객이 없습니다.")).toBeInTheDocument();
  });

  it("does not present client-query failure as an empty list or zero filter count", () => {
    const retry = jest.fn();
    render(<DashboardRedesign {...props} isError onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("최근 현황을 불러오지 못했습니다.");
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /전체/ })).not.toHaveTextContent("0");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not display guessed summary counts after an analytics failure", () => {
    const retry = jest.fn();
    render(<DashboardRedesign {...props} isAnalyticsError onRetryAnalytics={retry} />);
    expect(screen.queryByText("서비스 진행 중")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("요약 정보를 불러오지 못했습니다.");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
  });

  it("keeps the failure visible and prevents repeat retry while fetching", () => {
    render(<DashboardRedesign {...props} isError isRetrying onRetry={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("최근 현황을 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "다시 시도 중…" })).toBeDisabled();
  });

  it("keeps loading distinct from an empty result", () => {
    const { container } = render(<DashboardRedesign {...props} loading />);
    expect(container.querySelector('[data-component="mobile_dashboard_page_content_list-card_body_loading-skeleton"]')).toBeInTheDocument();
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
  });

  it("renders available activity without empty-state copy", () => {
    render(<DashboardRedesign {...props} sections={[{ title: "전체", rows: [{ name: "QA 고객", meta: "서비스 시작 예정", initial: "Q", badge: "대기", badgeTone: "muted", onClick: jest.fn() }] }]} />);
    expect(screen.getByText("QA 고객")).toBeInTheDocument();
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
  });
});
