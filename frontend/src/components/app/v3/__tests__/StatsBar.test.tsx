import { render, screen, waitFor } from "@testing-library/react";
import { Clock3 } from "lucide-react";

import {
  createTestQueryClient,
  JobsTestWrapper,
  makeJobList,
  makeSummary,
  setBranchCookie,
} from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignApi } from "@/services/api";

import { StatsBar } from "../StatsBar";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/dashboard",
}));

const ITEMS = [
  { icon: Clock3, value: 1, label: "첫째", counter: "건" },
  { icon: Clock3, value: 2, label: "둘째", counter: "건" },
];

const CARD = { name: "전자문서 처리중 작업 보기" };

describe("StatsBar document jobs card", () => {
  beforeEach(() => {
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("hides the whenActive card while there is nothing active or unresolved", async () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole("button", CARD)).not.toBeInTheDocument();
    expect(screen.getByText("첫째")).toBeInTheDocument();
  });

  it("shows the whenActive card as the first child once there are jobs", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 2 }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", CARD);
    const bar = document.querySelector('[data-component="dashboard_stats"]') as HTMLElement;
    expect(bar.firstElementChild).toBe(card);
    expect(card).toHaveTextContent("2");
    expect(card).not.toHaveClass("ms-auto");
  });

  it("shows the whenActive card for unresolved failures alone", async () => {
    jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue(makeSummary({ unresolvedJobIds: ["a"] }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "문서 처리 실패 작업 보기" });
    expect(card).toHaveTextContent("1건문서 처리 실패");
    expect(card.querySelector('[data-slot="stat-mini-marker"]')).toBeNull();
  });

  it("keeps the always card at zero", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="contracts" items={ITEMS} showDocumentJobs="always" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", CARD);
    await waitFor(() => expect(card).toHaveTextContent("0"));
    expect(card).not.toHaveTextContent("실패");
  });

  it("renders nothing when it has no items and the jobs card is hidden", async () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={[]} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(document.querySelector('[data-component="dashboard_stats"]')).not.toBeInTheDocument();
  });

  it("shows an item-less bar once the jobs card has something to show", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={[]} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    expect(await screen.findByRole("button", CARD)).toBeInTheDocument();
    expect(document.querySelector('[data-component="dashboard_stats"]')).toBeInTheDocument();
  });

  it("renders no jobs card and needs no provider when the prop is omitted", () => {
    render(<StatsBar name="plain" items={ITEMS} />);

    expect(screen.queryByRole("button", CARD)).not.toBeInTheDocument();
    expect(screen.getByText("둘째")).toBeInTheDocument();
  });
  it("supports independent item loading while retaining the shared default", () => {
    const { container } = render(<StatsBar name="desktop_chat_stats" isLoading items={[
      { icon: Clock3, value: 7, label: "공유 로딩" },
      { icon: Clock3, value: 0, label: "독립 완료", isLoading: false },
      { icon: Clock3, value: 9, label: "독립 로딩", isLoading: true },
    ]} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_chat_stats_stats_item-1"]')).toHaveTextContent("독립 완료");
  });
});
