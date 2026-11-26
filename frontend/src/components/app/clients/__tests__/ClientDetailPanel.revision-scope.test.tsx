import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";

import { clientKeys } from "@/features/clients/hooks/keys";
import type { Client } from "@/features/clients/types";
import { api } from "@/lib/api/client";
import type { ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";

import { ClientDetailPanel } from "../ClientDetailPanel";

jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
    useBusinessDayCalendar: () => ({
        calendar: jest.requireActual("@/lib/date/business-days").KR_BUILTIN_CALENDAR,
    }),
}));
jest.mock("@/hooks/useVoucherData", () => ({
    useVoucherYears: () => ({}),
    useVoucherPriceInfos: () => ({}),
}));
jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn().mockResolvedValue([]),
        getLinkConfirmations: jest.fn().mockResolvedValue([]),
    },
}));

const CLIENT_ID = 42;
const BRANCH_ID = "qa-branch";
const CUSTOMER_PATH = `/clients/${CLIENT_ID}`;
const OVERVIEW_PATH = `/admin/service-records/client/${CLIENT_ID}`;
const SCALAR_REVISIONS_PATH = `/admin/service-records/clients/${CLIENT_ID}/revisions`;

const directoryClient: Client = {
    id: CLIENT_ID,
    name: "QA-고객",
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: null,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    bookingConfirmedAt: null,
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
};

const emptyOverview: ServiceRecordOverview = {
    cases: [],
    record: null,
    assignments: [],
    scheduleProjection: {
        entries: [],
        blockingReasons: [{
            code: "SERVICE_RECORD_SOURCE_UNAVAILABLE",
            message: "제공기록지 정보를 확인할 수 없습니다.",
        }],
    },
};

beforeEach(() => {
    document.cookie = `selected_branch_id=${BRANCH_ID}; path=/`;
    window.dispatchEvent(new Event("pageshow"));
});

afterEach(() => {
    document.cookie = "selected_branch_id=; max-age=0; path=/";
    jest.restoreAllMocks();
});

function renderCaseFreePanel(getCustomer: () => Promise<{ data: Client }>, cachedBabyCount?: number) {
    const get = jest.spyOn(api, "get").mockImplementation(async (path) => {
        if (path === CUSTOMER_PATH) return getCustomer();
        if (path === OVERVIEW_PATH) return { data: emptyOverview };
        if (path === SCALAR_REVISIONS_PATH) throw { response: { status: 409 } };
        return { data: [] };
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const customerKey = clientKeys.detail(CLIENT_ID, BRANCH_ID);
    if (cachedBabyCount !== undefined) {
        queryClient.setQueryData<Client>(customerKey, {
            ...directoryClient, fetalConfirmation: "CONFIRMED", babyCount: cachedBabyCount,
        });
    }

    render(
        <QueryClientProvider client={queryClient}>
            <ClientDetailPanel client={directoryClient} trailing={null}
                tabRequest={{ clientId: CLIENT_ID, tab: "service-records", nonce: 1 }} />
        </QueryClientProvider>,
    );

    return { get, queryClient, customerKey };
}

it.each([
    { detail: "an uncached customer detail", cachedBabyCount: undefined },
    { detail: "a cached singleton detail", cachedBabyCount: 1 },
])("holds scalar revisions for a case-free twin household while fetching $detail", async ({ cachedBabyCount }) => {
    const twins: Client = { ...directoryClient, fetalConfirmation: "CONFIRMED", babyCount: 2 };
    // The promise executor assigns this synchronously before the panel mounts.
    let resolveCustomer!: (response: { data: Client }) => void;
    const customerResponse = new Promise<{ data: Client }>((resolve) => { resolveCustomer = resolve; });
    const { get, queryClient, customerKey } = renderCaseFreePanel(() => customerResponse, cachedBabyCount);

    await screen.findByText("예정 회차를 확인할 수 없습니다.");
    expect(get).toHaveBeenCalledWith(OVERVIEW_PATH);
    expect(get).toHaveBeenCalledWith(CUSTOMER_PATH);
    expect(queryClient.getQueryState(customerKey)?.fetchStatus).toBe("fetching");
    expect(get).not.toHaveBeenCalledWith(SCALAR_REVISIONS_PATH);

    await act(async () => resolveCustomer({ data: twins }));
    await waitFor(() => expect(queryClient.getQueryData(customerKey)).toEqual(twins));
    expect(get).not.toHaveBeenCalledWith(SCALAR_REVISIONS_PATH);
});

it("keeps scalar revisions on hold when the customer count cannot be loaded for a case-free household", async () => {
    const { get, queryClient, customerKey } = renderCaseFreePanel(async () => {
        throw new Error("Customer detail unavailable");
    });

    await screen.findByText("예정 회차를 확인할 수 없습니다.");
    await waitFor(() => expect(queryClient.getQueryState(customerKey)?.status).toBe("error"));
    expect(get).not.toHaveBeenCalledWith(SCALAR_REVISIONS_PATH);
});
