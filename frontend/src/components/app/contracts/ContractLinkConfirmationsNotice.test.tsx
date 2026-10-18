import { useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { ContractLinkConfirmDialog } from "@/components/app/clients/ContractLinkConfirmDialog";
import { useActiveBranchId } from "@/features/system-templates/branch-context";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";

import { ContractLinkConfirmationsNotice } from "./ContractLinkConfirmationsNotice";

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/features/system-templates/branch-context", () => ({
    useActiveBranchId: jest.fn(() => "branch-1"),
}));
jest.mock("@/services/api", () => ({ eformsignApi: { getLinkConfirmations: jest.fn() } }));
jest.mock("@/components/app/clients/ContractLinkConfirmDialog", () => ({
    ContractLinkConfirmDialog: jest.fn(() => <div role="dialog" />),
}));

const refetch = jest.fn();
function entry(index = 1, overrides: Partial<EformsignLinkConfirmation> = {}): EformsignLinkConfirmation {
    return {
        documentId: `doc-${index}`, documentName: `산모 계약서 ${index}`,
        statusType: "002", statusDetail: "고객 서명", createdDate: "2026-09-01",
        document: { name: "박계약", phone: "01011112222", birthday: "1990-01-02" },
        client: { id: index + 10, name: `김고객 ${index}`, phone: "01011112222", birthday: "1991-03-04" },
        differences: ["name", "birthday"], canConfirm: true, ...overrides,
    };
}

function state(data: EformsignLinkConfirmation[] | undefined, overrides = {}) {
    (useQuery as jest.Mock).mockReturnValue({
        data, isError: false, isFetching: false, isPending: data === undefined,
        fetchStatus: "idle", refetch, ...overrides,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useActiveBranchId).mockReturnValue("branch-1");
    state([]);
});

describe("ContractLinkConfirmationsNotice", () => {
    it.each(["fetching", "paused", "idle"])("renders no DOM while pending and %s", (fetchStatus) => {
        state(undefined, { fetchStatus, isFetching: fetchStatus === "fetching" });
        expect(render(<ContractLinkConfirmationsNotice />).container).toBeEmptyDOMElement();
    });

    it("renders no DOM for a successfully loaded empty list", () => {
        expect(render(<ContractLinkConfirmationsNotice />).container).toBeEmptyDOMElement();
    });

    it("uses an ungated branch-scoped key and the shared retry policy", async () => {
        render(<ContractLinkConfirmationsNotice />);
        const options = (useQuery as jest.Mock).mock.calls[0][0];
        expect(options.queryKey).toEqual(["eformsign-docs", "link-confirmations", "all", "branch-1"]);
        expect(options).not.toHaveProperty("enabled");
        expect(options).not.toHaveProperty("retry");
        await options.queryFn();
        expect(eformsignApi.getLinkConfirmations).toHaveBeenCalledWith();
    });

    it("shows a retry alert rather than an empty state on a failed first load", () => {
        state(undefined, { isError: true, isPending: false });
        render(<ContractLinkConfirmationsNotice />);
        expect(screen.getByRole("alert")).toHaveTextContent("연결 확인이 필요한 계약서를 불러오지 못했습니다");
        expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("partitions the query by branch on a branch switch", () => {
        const view = render(<ContractLinkConfirmationsNotice />);
        jest.mocked(useActiveBranchId).mockReturnValue("branch-2");
        view.rerender(<ContractLinkConfirmationsNotice />);
        expect((useQuery as jest.Mock).mock.calls.at(-1)[0].queryKey).toEqual([
            "eformsign-docs", "link-confirmations", "all", "branch-2",
        ]);
    });

    it("retains cached entries with a stale retry alert after a failed refetch", () => {
        state([entry()], { isError: true });
        render(<ContractLinkConfirmationsNotice />);
        expect(screen.getByText("산모 계약서 1")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("reports a failed refetch even when the cached list is empty", () => {
        state([], { isError: true });
        render(<ContractLinkConfirmationsNotice />);
        expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    });

    it("shows the count, badge, document, matched client and differences", () => {
        state([entry()]);
        const { container } = render(<ContractLinkConfirmationsNotice />);
        expect(screen.getByRole("heading")).toHaveTextContent("연결 확인이 필요한 계약서 1건");
        expect(screen.getByText("연결 확인 필요")).toBeInTheDocument();
        expect(screen.getByText("산모 계약서 1")).toBeInTheDocument();
        expect(screen.getByText("김고객 1")).toBeInTheDocument();
        expect(screen.getByText("이름과 생년월일이 다릅니다")).toBeInTheDocument();
        expect(container.firstChild).toHaveClass("shrink-0");
        expect(container.querySelector('[data-slot="entries"]')).toHaveClass("overflow-y-auto");
        for (const node of container.querySelectorAll("[data-component]")) {
            expect(node.getAttribute("data-component")).toMatch(/^desktop_contracts_link-confirmations(?:_|$)/);
        }
    });

    it("uses the document fallback and hides confirmation for a non-manager", () => {
        state([entry(1, { documentName: null, canConfirm: false, differences: ["birthday"] })]);
        render(<ContractLinkConfirmationsNotice />);
        expect(screen.getByText("계약서")).toBeInTheDocument();
        expect(screen.getByText("생년월일이 다릅니다")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
        expect(screen.getByText("지점 관리자만 연결을 확정할 수 있습니다")).toBeInTheDocument();
    });

    it("shows five entries then expands and collapses the rest", () => {
        state(Array.from({ length: 6 }, (_, index) => entry(index + 1)));
        render(<ContractLinkConfirmationsNotice />);
        expect(screen.getAllByRole("listitem")).toHaveLength(5);
        expect(screen.queryByText("산모 계약서 6")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "1건 더 보기" }));
        expect(screen.getAllByRole("listitem")).toHaveLength(6);
        expect(screen.getByText("산모 계약서 6")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "접기" }));
        expect(screen.getAllByRole("listitem")).toHaveLength(5);
    });

    it("opens the existing dialog with the selected entry and its matched client ID", () => {
        const selected = entry(2);
        state([selected]);
        render(<ContractLinkConfirmationsNotice />);
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        const props = jest.mocked(ContractLinkConfirmDialog).mock.calls.at(-1)?.[0];
        expect(props).toMatchObject({ entry: selected, clientId: 12, dataComponentPrefix: "desktop_contracts" });
        expect(props?.onClose).toEqual(expect.any(Function));
    });
});
