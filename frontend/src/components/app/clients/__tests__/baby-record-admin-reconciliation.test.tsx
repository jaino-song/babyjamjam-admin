import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import ClientsPage from "@/app/(protected)/clients/page";
import type { Client } from "@/features/clients/types";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { api } from "@/lib/api/client";
import { AUTH_USER_QUERY_KEY } from "@/lib/auth/query-keys";
import type {
    AdminServiceRecordCaseSummary,
    ServiceRecordCase,
    ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

import { ClientDetailPanel } from "../ClientDetailPanel";

const CLIENT_ID = 42;
const OTHER_CLIENT_ID = 91;
const BRANCH_A = "branch-a";
const BRANCH_B = "branch-b";
const HISTORIC = "10ef5757-5834-45f6-845b-756a962ae508";
const SIBLING = "5cf8deca-561b-4d60-9303-c615b4d0cf00";
const FIRST = "f358334b-b9d4-4d85-a856-069bb34a6ff2";
const SECOND = "17b63bb8-e373-48ae-8fad-a67a4c56bf8a";
const THIRD = "85ac3b57-b217-4bcb-bd28-abd4bebdb0f1";
const RECORDS_PATH = `/admin/service-records/client/${CLIENT_ID}`;
const REVISIONS_PATH = `/admin/service-records/clients/${CLIENT_ID}/revisions`;
const CAPABILITY_PATH = "/clients/baby-record-capability";
const HISTORIC_BUTTON = /^옛 기록지 ·/;
const SIBLING_BUTTON = /^셋째 ·/;

let mockSearchParams: URLSearchParams;
const mockRouter = {
    replace: jest.fn((href: string) => { mockSearchParams = new URL(href, "http://localhost").searchParams; }),
    push: jest.fn(),
};
let mockAuth: { data?: { role: string; branchRole: string | null; branchId?: string }; isError?: boolean };
const mockDirectory = jest.fn();
const mockMissingClients = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => mockRouter,
    useSearchParams: () => mockSearchParams,
    usePathname: () => "/clients",
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => mockAuth }));
jest.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
    useBusinessDayCalendar: () => ({
        calendar: jest.requireActual("@/lib/date/business-days").KR_BUILTIN_CALENDAR,
    }),
}));
jest.mock("@/hooks/useVoucherData", () => ({
    useVoucherYears: () => ({}),
    useVoucherPriceInfos: () => ({}),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
    useDocumentJobs: () => ({ summary: undefined }),
}));
jest.mock("@/features/clients/hooks/use-clients", () => ({
    ...jest.requireActual("@/features/clients/hooks/use-clients"),
    useClientDirectory: () => mockDirectory(),
    useClientListSummary: () => ({ isBranchContextReady: true }),
    useServiceRecordMissingClients: () => mockMissingClients(),
}));
jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn().mockResolvedValue([]),
        getLinkConfirmations: jest.fn().mockResolvedValue([]),
    },
}));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({
    CLIENT_FORM_STEPPER_STEPS: [],
    ClientFormDialog: () => null,
    ClientFormPanel: () => null,
}));
jest.mock("@/components/app/clients/MaternityContractDialog", () => ({
    MaternityContractDialog: () => null,
}));

const babies = [
    { babyId: SECOND, ordinal: 3 },
    { babyId: THIRD, ordinal: 4 },
    { babyId: FIRST, ordinal: 1 },
];
const client: Client = {
    id: CLIENT_ID, name: "QA-고객", fetalConfirmation: "CONFIRMED", babyCount: 3, babies,
    birthday: null, dueDate: null, birthDate: null, address: null, phone: null,
    primaryEmployee: null, type: null, duration: 4, fullPrice: null, grant: null, actualPrice: null,
    startDate: null, endDate: null, careCenter: null, voucherClient: false, breastPump: false,
    serviceStatus: "active", bookingConfirmedAt: null, eDocId: null, hasSigned: false, documentStatus: null,
    providers: [{ slot: 1, employeeId: 72 }],
    babyAssignments: [{ babyId: SECOND, ordinal: 3, providerSlot: 1 }],
    secondaryEmployee: { id: 72, name: "QA-담당 관리사" },
};
const cases: AdminServiceRecordCaseSummary[] = [
    {
        caseId: HISTORIC, babyId: null, rank: null, legacyName: "  옛 기록지  ", retired: false,
        babyCount: 3, status: "IN_PROGRESS", assignees: [], submittedSessions: 1, totalSessions: 4,
    },
    {
        caseId: SIBLING, babyId: THIRD, rank: 3, legacyName: null, retired: false,
        babyCount: 3, status: "IN_PROGRESS", assignees: [], submittedSessions: 0, totalSessions: 4,
    },
];

function overview(records = cases, record: ServiceRecordCase | null = null): ServiceRecordOverview {
    return { cases: records, record, assignments: [], legacyLinkAssignment: null };
}

function record(caseId: string): ServiceRecordCase {
    return {
        id: caseId, status: "IN_PROGRESS", startDate: null, endDate: null,
        totalSessions: 4, sessions: [], signatureDocs: [], header: null, lastError: null,
        completedAt: null, finalizedAt: null, finalizationDueAt: null, documentsCompletedAt: null,
    };
}

function deferred<T>() {
    let resolve!: (data: T) => void;
    const response = new Promise<{ data: T }>((done) => { resolve = (data) => done({ data }); });
    return { response, resolve };
}

function setBranch(branchId: string) {
    document.cookie = `selected_branch_id=${branchId}; path=/`;
    fireEvent(window, new Event("pageshow"));
}

function setup(node: ReactNode, seed?: (queryClient: QueryClient) => void) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    seed?.(queryClient);
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { ...render(node, { wrapper: Wrapper }), queryClient };
}

function Panel({ id = CLIENT_ID, caseId }: { id?: number; caseId?: string }) {
    return (
        <ClientDetailPanel client={{ ...client, id }} trailing={null}
            tabRequest={{ clientId: id, tab: "service-records", nonce: 1, caseId }} />
    );
}

const casePath = (caseId: string, base = RECORDS_PATH) => `${base}?caseId=${caseId}`;
const choice = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "연결할 아기" });
const connect = () => screen.getByRole("button", { name: "연결" });

function mockReads(read: (path: string) => object | Promise<{ data: unknown }> | undefined) {
    return jest.spyOn(api, "get").mockImplementation(async (path) => {
        const response = read(path);
        if (response instanceof Promise) return response as never;
        return {
            data: response ?? (path === CAPABILITY_PATH ? { enabled: true }
                : path.startsWith("/clients/") ? { ...client, id: Number(path.split("/").at(-1)) }
                : []),
        } as never;
    });
}

beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    setBranch(BRANCH_A);
    mockAuth = { data: { role: "user", branchRole: "manager" } };
    mockDirectory.mockReturnValue({ clients: [client], isBranchContextReady: true, data: {}, matchedTotal: 1 });
    mockMissingClients.mockReturnValue({});
});

afterEach(() => {
    document.cookie = "selected_branch_id=; max-age=0; path=/";
    jest.restoreAllMocks();
    mockRouter.replace.mockClear();
});

it("a failed case detail preserves the other case choice", async () => {
    const failure = deferred<ServiceRecordOverview>();
    const get = mockReads((path) => {
        if (path === RECORDS_PATH) return overview();
        if (path === casePath(HISTORIC)) return failure.response.then(() => Promise.reject({ response: { status: 404 } }));
        if (path === casePath(SIBLING)) return overview(cases, record(SIBLING));
    });
    setup(<Panel caseId={HISTORIC} />);
    const sibling = await screen.findByRole("button", { name: SIBLING_BUTTON });
    expect(sibling).toBeEnabled();
    await act(async () => failure.resolve(overview()));
    await screen.findByText("제공기록지 정보를 불러오지 못했습니다");
    expect(screen.queryByRole("combobox", { name: "연결할 아기" })).not.toBeInTheDocument();

    fireEvent.click(sibling);
    await waitFor(() => expect(get).toHaveBeenCalledWith(casePath(SIBLING)));
    expect(screen.getByRole("button", { name: SIBLING_BUTTON })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.queryByText("제공기록지 정보를 불러오지 못했습니다")).not.toBeInTheDocument());
});

it("an unresolved household never queries scalar revision history", async () => {
    const initial = deferred<ServiceRecordOverview>();
    const get = mockReads((path) => path === RECORDS_PATH ? initial.response : undefined);
    const view = setup(<Panel />);
    await waitFor(() => expect(get).toHaveBeenCalledWith(RECORDS_PATH));
    expect(get).not.toHaveBeenCalledWith(REVISIONS_PATH);
    await act(async () => initial.resolve(overview()));
    await screen.findByRole("button", { name: SIBLING_BUTTON });
    expect(get).not.toHaveBeenCalledWith(REVISIONS_PATH);

    const knownEmpty = `/admin/service-records/client/${OTHER_CLIENT_ID}`;
    view.unmount();
    get.mockImplementation(async (path) => ({ data: path === knownEmpty ? overview([]) : [] }) as never);
    setup(<Panel id={OTHER_CLIENT_ID} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/admin/service-records/clients/${OTHER_CLIENT_ID}/revisions`));
});

it("a cached singleton does not query scalar revisions while the household is being checked", async () => {
    const household = deferred<ServiceRecordOverview>();
    const get = mockReads((path) => path === RECORDS_PATH ? household.response : undefined);
    setup(<Panel />, (queryClient) => {
        queryClient.setQueryData(serviceRecordKeys.clientOverview(CLIENT_ID, undefined, BRANCH_A), overview([cases[0]!]));
    });
    await waitFor(() => expect(get).toHaveBeenCalledWith(RECORDS_PATH));
    expect(get).not.toHaveBeenCalledWith(REVISIONS_PATH);
    await act(async () => household.resolve(overview()));
    await screen.findByRole("button", { name: SIBLING_BUTTON });
    expect(get).not.toHaveBeenCalledWith(REVISIONS_PATH);
});

it("the household case picker cannot outlive the branch that supplied it", async () => {
    const oldRefresh = deferred<ServiceRecordOverview>();
    const current = deferred<ServiceRecordOverview>();
    let refresh = false;
    const get = mockReads((path) => {
        if (path !== RECORDS_PATH) return;
        if (document.cookie.includes(BRANCH_B)) return current.response;
        return refresh ? oldRefresh.response : overview();
    });
    const { queryClient } = setup(<Panel />);
    await screen.findByRole("button", { name: HISTORIC_BUTTON });
    refresh = true;
    void queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(CLIENT_ID) });
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === RECORDS_PATH)).toHaveLength(2));

    act(() => setBranch(BRANCH_B));
    expect(screen.queryByRole("button", { name: HISTORIC_BUTTON })).not.toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === RECORDS_PATH)).toHaveLength(3));
    await act(async () => oldRefresh.resolve(overview()));
    expect(screen.queryByRole("button", { name: HISTORIC_BUTTON })).not.toBeInTheDocument();
    await act(async () => current.resolve(overview([{ ...cases[0]!, legacyName: "새 지점 기록지" }])));
    expect(await screen.findByRole("button", { name: /^새 지점 기록지 ·/ })).toBeEnabled();
});

it("admin ordinal labels use the active rank and a trimmed historic fallback", async () => {
    const signed = deferred<ServiceRecordOverview>();
    const historic = { ...cases[0]!, legacyName: " \t " };
    const household = [historic, cases[1]!];
    mockReads((path) => path === RECORDS_PATH ? overview(household)
        : path === casePath(HISTORIC) ? signed.response : undefined);
    const post = jest.spyOn(api, "post").mockResolvedValue({ data: { caseId: HISTORIC, babyId: SECOND } });
    setup(<Panel caseId={HISTORIC} />);
    const legacyChoice = await screen.findByRole("button", { name: /^기존 제공기록지 ·/ });
    expect(legacyChoice).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("combobox", { name: "연결할 아기" });
    expect(within(choice()).getByRole("option", { name: "둘째 · QA-담당 관리사" })).toHaveValue(SECOND);
    expect(within(choice()).queryByRole("option", { name: /셋째/ })).not.toBeInTheDocument();
    expect(connect()).toBeDisabled();
    fireEvent.change(choice(), { target: { value: SECOND } });
    await act(async () => signed.resolve(overview(household, record(HISTORIC))));
    await screen.findByRole("link", { name: "제공기록지 보기" });
    expect(choice()).toHaveValue(SECOND);
    fireEvent.click(connect());
    await waitFor(() => expect(post.mock.calls).toEqual([[
        `${RECORDS_PATH}/cases/${HISTORIC}/adopt`, { babyId: SECOND },
    ]]));
});

it("an alert selection reaches the same case in the detail panel", async () => {
    const get = mockReads((path) => path === RECORDS_PATH ? overview()
        : path === casePath(SIBLING) ? overview(cases, record(SIBLING)) : undefined);
    mockMissingClients.mockReturnValue({
        data: { count: 1, items: [{
            clientId: CLIENT_ID, caseId: SIBLING, rank: 3, babyCount: 3,
            clientName: client.name, primaryEmployeeName: "QA-담당 관리사", unwrittenThroughSessionIndex: 2,
        }] },
    });
    setup(<ClientsPage />);
    fireEvent.click(screen.getByRole("button", { name: "제공기록지 미작성 고객 보기" }));
    const dialog = screen.getByRole("dialog", { name: "제공기록지 미작성" });
    fireEvent.click(within(dialog).getByRole("button", { name: `${client.name} · 셋째 제공기록지 보기` }));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/clients?id=${CLIENT_ID}`);
    expect(await screen.findByRole("button", { name: SIBLING_BUTTON })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(get).toHaveBeenCalledWith(casePath(SIBLING)));
    expect(screen.getByRole("button", { name: HISTORIC_BUTTON })).toHaveAttribute("aria-pressed", "false");
});

it("a singleton historic summary can be linked on the customer page while retaining the signed case", async () => {
    mockSearchParams.set("id", String(CLIENT_ID));
    const signed = {
        ...record(HISTORIC),
        signatureDocs: [{
            documentId: "QA-기존 서명 문서", statusType: "050", statusDetail: "", stepName: "",
            createdDate: "2026-11-01", updatedDate: "2026-11-01",
        }],
    };
    let adopted = false;
    const get = mockReads((path) => {
        const household = adopted
            ? [{ ...cases[0]!, babyId: SECOND, legacyName: null, rank: 2 }, cases[1]!]
            : [cases[0]!];
        if (path === RECORDS_PATH) return overview(household);
        if (path === casePath(HISTORIC)) return overview(household, signed);
    });
    const post = jest.spyOn(api, "post").mockImplementation(async () => {
        adopted = true;
        return { data: { caseId: HISTORIC, babyId: SECOND } };
    });
    setup(<ClientsPage />, (cache) => {
        const selectedKey = serviceRecordKeys.clientOverview(CLIENT_ID, HISTORIC, BRANCH_A);
        cache.setQueryDefaults(selectedKey, { gcTime: Infinity, staleTime: Infinity });
        cache.setQueryData(selectedKey, overview([cases[0]!], record(HISTORIC)));
    });
    fireEvent.click(screen.getByRole("tab", { name: "제공기록지" }));
    await screen.findByRole("combobox", { name: "연결할 아기" });
    await waitFor(() => expect(get).toHaveBeenCalledWith(REVISIONS_PATH));
    expect(screen.getByText("옛 기록지", { exact: true })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(casePath(HISTORIC));
    fireEvent.change(choice(), { target: { value: SECOND } });
    fireEvent.click(connect());

    expect(await screen.findByText("QA-기존 서명 문서")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(casePath(HISTORIC));
    expect(screen.getByRole("button", { name: /^둘째 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "제공기록지 보기" })).toHaveAttribute(
        "href", `/service-record-admin/${CLIENT_ID}?caseId=${HISTORIC}`,
    );
    expect(get.mock.calls.filter(([path]) => path === `/clients/${CLIENT_ID}`).length).toBeGreaterThan(1);
    expect(get.mock.calls.filter(([path]) => path === RECORDS_PATH)).toHaveLength(2);
    expect(screen.queryByRole("combobox", { name: "연결할 아기" })).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
});

it("refreshes a conflicting claim and never falls back to a different baby", async () => {
    let claimed = false;
    mockReads((path) => {
        const household = claimed ? [cases[0]!, { ...cases[1]!, babyId: SECOND, rank: 2 }] : cases;
        if (path === RECORDS_PATH) return overview(household);
        if (path === casePath(HISTORIC)) return overview(household, record(HISTORIC));
    });
    const post = jest.spyOn(api, "post").mockImplementation(async () => {
        claimed = true;
        throw { response: { status: 409 } };
    });
    setup(<Panel />);
    fireEvent.click(await screen.findByRole("button", { name: HISTORIC_BUTTON }));
    await screen.findByRole("combobox", { name: "연결할 아기" });
    fireEvent.change(choice(), { target: { value: SECOND } });
    fireEvent.click(connect());
    await screen.findByText(/연결 대상이 변경되었어요/);
    await waitFor(() => expect(within(choice()).queryByRole("option", { name: /둘째/ })).not.toBeInTheDocument());
    expect(choice()).toHaveValue("");
    expect(connect()).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
});

it("a pause during submission leaves the signed record readable and prevents resending", async () => {
    const pause = deferred<void>();
    let enabled = true;
    const signed = overview(cases, record(HISTORIC));
    mockReads((path) => path === RECORDS_PATH || path === casePath(HISTORIC) ? signed
        : path === CAPABILITY_PATH ? { enabled } : undefined);
    const post = jest.spyOn(api, "post").mockImplementation(async () => {
        await pause.response;
        enabled = false;
        throw { response: { status: 409 } };
    });
    const { queryClient } = setup(<Panel caseId={HISTORIC} />);
    await screen.findByRole("link", { name: "제공기록지 보기" });
    await screen.findByRole("combobox", { name: "연결할 아기" });
    fireEvent.change(choice(), { target: { value: SECOND } });
    const submit = connect();
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => pause.resolve(undefined));
    await screen.findByText(/연결 대상이 변경되었어요/);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole("button", { name: "연결" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "제공기록지 보기" })).toHaveAttribute("href", expect.stringContaining(HISTORIC));
    expect(post).toHaveBeenCalledTimes(1);
});

it.each(["paused", "unknown-role", "inactive-branch", "other-branch", "gone", "retired"])(
    "keeps the historic read without a %s adoption", async (condition) => {
        if (condition === "unknown-role") mockAuth = { isError: true };
        if (condition === "inactive-branch") mockAuth = { data: { role: "owner", branchRole: null, branchId: BRANCH_A } };
        if (condition === "other-branch") mockAuth = { data: { role: "user", branchRole: "manager", branchId: BRANCH_B } };
        const historic = { ...cases[0]!, retired: condition === "retired" };
        const signed = overview([historic], record(HISTORIC));
        mockReads((path) => path === RECORDS_PATH || path === casePath(HISTORIC) ? signed
            : path === CAPABILITY_PATH ? { enabled: condition !== "paused" }
            : path === `/clients/${CLIENT_ID}` ? (condition === "gone" ? { ...client, babies: [] } : client) : undefined);
        const post = jest.spyOn(api, "post");
        const get = jest.mocked(api.get);
        const { queryClient } = setup(<Panel caseId={HISTORIC} />);
        await waitFor(() => expect(get).toHaveBeenCalledWith(casePath(HISTORIC)));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        expect(screen.queryByRole("combobox", { name: "연결할 아기" })).not.toBeInTheDocument();
        expect(post).not.toHaveBeenCalled();
    },
);

it("rejects a deliberate choice when branch authority is invalidated before submit", async () => {
    const signed = overview(cases, record(HISTORIC));
    mockReads((path) => path === RECORDS_PATH || path === casePath(HISTORIC) ? signed : undefined);
    const post = jest.spyOn(api, "post");
    const { queryClient } = setup(<Panel caseId={HISTORIC} />, (cache) => {
        cache.setQueryDefaults(AUTH_USER_QUERY_KEY, { gcTime: Infinity });
        cache.setQueryData(AUTH_USER_QUERY_KEY, mockAuth.data);
    });
    await screen.findByRole("combobox", { name: "연결할 아기" });
    fireEvent.change(choice(), { target: { value: SECOND } });
    const submit = connect();
    expect(submit).toBeEnabled();
    await act(async () => {
        void queryClient.invalidateQueries({ queryKey: AUTH_USER_QUERY_KEY });
        expect(queryClient.getQueryState(AUTH_USER_QUERY_KEY)?.isInvalidated).toBe(true);
        fireEvent.click(submit);
    });
    expect(post).not.toHaveBeenCalled();
});

it("a delayed adoption cannot refresh or replace the next customer's deliberate choice", async () => {
    const adoption = deferred<{ caseId: string; babyId: string }>();
    const otherPath = `/admin/service-records/client/${OTHER_CLIENT_ID}`;
    const get = mockReads((path) => path === RECORDS_PATH || path === otherPath ? overview([cases[0]!])
        : path === casePath(HISTORIC) || path === casePath(HISTORIC, otherPath) ? overview([cases[0]!], record(HISTORIC))
        : undefined);
    const post = jest.spyOn(api, "post").mockImplementation(() => adoption.response as never);
    const view = setup(<Panel caseId={HISTORIC} />);
    await screen.findByRole("combobox", { name: "연결할 아기" });
    fireEvent.change(choice(), { target: { value: SECOND } });
    fireEvent.click(connect());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    view.rerender(<Panel id={OTHER_CLIENT_ID} caseId={HISTORIC} />);
    await screen.findByRole("combobox", { name: "연결할 아기" });
    expect(choice()).toHaveValue("");
    fireEvent.change(choice(), { target: { value: THIRD } });
    const requests = get.mock.calls.filter(([path]) => path.startsWith(otherPath)).length;
    await act(async () => adoption.resolve({ caseId: HISTORIC, babyId: SECOND }));
    expect(choice()).toHaveValue(THIRD);
    expect(get.mock.calls.filter(([path]) => path.startsWith(otherPath))).toHaveLength(requests);
    expect(post).toHaveBeenCalledTimes(1);
});
