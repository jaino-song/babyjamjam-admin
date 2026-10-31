import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type UseMutationResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryRootsForKinds } from "@/lib/realtime/entity-query-keys";
import {
    useCancelMessageTriggerJob,
    useResendMessageTriggerJob,
    useRetryMessageHistory,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import NewMessagePage from "@/app/(shell)/messages/new/page";
import { api } from "@/lib/api/client";
import type { ReactNode } from "react";

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

/**
 * Local integrity harness for the mobile area (SI-SMS-08). Semantics mirror the
 * backend `helpers/known-defect.ts` without importing backend code:
 *
 * - `invariant` — `it`: the correct behaviour that must hold today.
 * - `knownDefect` — `it.failing` WITH an `expectedFailure` matcher: the body
 *   states the correct behaviour; while the defect exists it fails for the
 *   matching reason (suite stays green), and once fixed it starts passing and
 *   turns RED, forcing the fixing unit to flip the call to `invariant`.
 */
function invariant(id: string, title: string, body: jest.ProvidesCallback): void {
    it(`${id} ${title}`, body);
}

/** The client-history key family `useClientMessageHistory` subscribes to. */
const CLIENT_HISTORY_KEY = ["messages", "logs", "client", 7] as const;
const CLIENT_HISTORY_KEY_ALL = ["messages", "logs", "all"] as const;
const EXPECTED_ALL_LOGS_AFTER_CHANGE = "the all-logs view was not invalidated after the change";

const apiMock = api as unknown as {
    get: jest.Mock;
    post: jest.Mock;
    patch: jest.Mock;
    delete: jest.Mock;
};

function freshQueryClient(): QueryClient {
    const queryClient = new QueryClient({
        // Match mobile's default: the all-logs view stays fresh for 30 minutes.
        defaultOptions: { mutations: { retry: false }, queries: { retry: false, staleTime: 30 * 60 * 1000 } },
    });
    // Seed every view the invariant talks about so stale-marking is observable.
    queryClient.setQueryData(CLIENT_HISTORY_KEY, { logs: [], hasMore: false });
    queryClient.setQueryData(CLIENT_HISTORY_KEY_ALL, []);
    queryClient.setQueryData(messageTriggerKeys.history(), []);
    queryClient.setQueryData(messageTriggerKeys.upcoming(), []);
    return queryClient;
}

function isInvalidated(queryClient: QueryClient, key: readonly unknown[]): boolean {
    return queryClient.getQueryState(key)?.isInvalidated === true;
}

type MutationHook<TData, TArgs> = (clientId?: number) => UseMutationResult<TData, Error, TArgs, unknown>;

/**
 * Mounts a component that fires the given mutation hook exactly once and
 * reports its settled status as text. Returns the mounted query client.
 */
async function runMutation<TData, TArgs>(
    useMutationHook: MutationHook<TData, TArgs>,
    mutateArg: TArgs,
    clientId?: number,
): Promise<QueryClient> {
    const queryClient = freshQueryClient();
    let fired = false;
    const Component = (): ReactNode => {
        const mutation = useMutationHook(clientId);
        useEffect(() => {
            if (!fired) {
                fired = true;
                mutation.mutate(mutateArg);
            }
        }, [mutation]);
        return <div>mutation-status:{String(mutation.status)}</div>;
    };
    render(
        <QueryClientProvider client={queryClient}>
            <Component />
        </QueryClientProvider>,
    );
    await waitFor(
        () => {
            expect(screen.getByText(/mutation-status:(success|error)/)).toBeInTheDocument();
        },
        { timeout: 5_000 },
    );
    return queryClient;
}

invariant(
    "SI-SMS-08",
    "the realtime message root prefix-matches the mobile client-history key family",
    async () => {
        const roots = queryRootsForKinds(["message"]);
        const messagesRoot = roots.find((root) => root[0] === "messages");
        if (!messagesRoot) {
            throw new Error(`realtime message roots do not cover the messages namespace: ${JSON.stringify(roots)}`);
        }
        const queryClient = freshQueryClient();
        await queryClient.invalidateQueries({ queryKey: messagesRoot });
        expect(isInvalidated(queryClient, CLIENT_HISTORY_KEY)).toBe(true);
        expect(isInvalidated(queryClient, CLIENT_HISTORY_KEY_ALL)).toBe(true);
    },
);

invariant(
    "SI-SMS-08",
    "the mobile cancel mutation refreshes upcoming and history views",
    async () => {
        apiMock.post.mockResolvedValue({ data: {} });
        const queryClient = await runMutation(useCancelMessageTriggerJob, "job-1");
        expect(isInvalidated(queryClient, messageTriggerKeys.upcoming())).toBe(true);
        expect(isInvalidated(queryClient, messageTriggerKeys.history())).toBe(true);
    },
);

invariant(
    "SI-SMS-08",
    "the mobile retry mutation run inside the client detail screen does invalidate the client history view",
    async () => {
        apiMock.post.mockResolvedValue({ data: {} });
        const queryClient = await runMutation(useRetryMessageHistory, 1042, 7);
        expect(isInvalidated(queryClient, messageTriggerKeys.history())).toBe(true);
        expect(isInvalidated(queryClient, CLIENT_HISTORY_KEY)).toBe(true);
    },
);

// The optional clientId conditional is shared with desktop. Per-client history
// uses staleTime: 0 and refetches on remount; it is not a mobile parity defect.
// The separately keyed all-logs view has the 30-minute default and is missed
// even when a caller supplies clientId. Pin that actual stale-view defect.
invariant("SI-SMS-08", "retry refreshes the mobile all-logs view", async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    const queryClient = await runMutation(useRetryMessageHistory, 1042, 7);
    if (!isInvalidated(queryClient, CLIENT_HISTORY_KEY_ALL)) {
        throw new Error(EXPECTED_ALL_LOGS_AFTER_CHANGE + ": retry");
    }
});

invariant("SI-SMS-08", "resend refreshes the mobile all-logs view", async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    const queryClient = await runMutation(useResendMessageTriggerJob, "job-1", 7);
    if (!isInvalidated(queryClient, CLIENT_HISTORY_KEY_ALL)) {
        throw new Error(EXPECTED_ALL_LOGS_AFTER_CHANGE + ": resend");
    }
});

invariant(
    "SI-SMS-08",
    "cancel refreshes the mobile all-logs view",
    async () => {
        apiMock.post.mockResolvedValue({ data: {} });
        const queryClient = await runMutation(useCancelMessageTriggerJob, "job-1", 7);
        // /message-logs merges canceled terminal jobs into the all-logs view even
        // without a message_log row, so cancellation changes the rule counts too.
        if (!isInvalidated(queryClient, CLIENT_HISTORY_KEY_ALL)) {
            throw new Error(EXPECTED_ALL_LOGS_AFTER_CHANGE + ": cancel");
        }
    },
);

// ---------------------------------------------------------------------------
// The manual-send page (`mobile/src/app/(shell)/messages/new`).
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockUseAllClients = jest.fn();
const mockUseSystemTemplate = jest.fn();
const mockUseSystemTemplates = jest.fn();
const mockGetMessageSenderApproval = jest.fn();
const mockUseBankAccountInfos = jest.fn();
const mockUseVoucherPriceInfos = jest.fn();
const mockUseMessagesPermissionGuard = jest.fn();
const mockClipboardWriteText = jest.fn();
const mockSearchParams = new URLSearchParams();

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
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: mockClipboardWriteText },
    });
});

const mockClients = [
    {
        id: 7,
        name: "박서연",
        createdAt: null,
        updatedAt: null,
        birthday: null,
        dueDate: null,
        birthDate: null,
        address: "인천 연수구",
        phone: "01077778888",
        primaryEmployee: null,
        secondaryEmployee: null,
        type: "A통합-2형",
        duration: 10,
        fullPrice: "2196000",
        grant: "1734000",
        actualPrice: "462000",
        startDate: "2026-06-10T00:00:00.000Z",
        endDate: null,
        careCenter: false,
        voucherClient: false,
        breastPump: false,
        serviceStatus: null,
        bookingConfirmedAt: null,
        eDocId: null,
        areaId: "Seogu",
        hasSigned: false,
        documentStatus: null,
    },
];

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
    useSearchParams: () => mockSearchParams,
    usePathname: () => "/messages/new",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => ({
        data: { role: "user", branchRole: "manager" },
        isPending: false,
        isLoading: false,
        isFetching: false,
        isError: false,
    }),
}));

jest.mock("@/hooks/use-message-templates", () => ({
    useMessageTemplates: () => ({ data: [] }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
    useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
    useSystemTemplates: () => mockUseSystemTemplates(),
}));

jest.mock("@/hooks/useClients", () => ({
    useAllClients: () => mockUseAllClients(),
}));

jest.mock("@/hooks", () => ({
    useBankAccountInfos: () => mockUseBankAccountInfos(),
    useVoucherPriceInfos: (type: string, year?: number) => mockUseVoucherPriceInfos(type, year),
}));

jest.mock("@/services/api", () => ({
    settingsApi: {
        getMessageSenderApproval: () => mockGetMessageSenderApproval(),
    },
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
    useMessagesPermissionGuard: () => mockUseMessagesPermissionGuard(),
}));

async function addManualRecipient(value: string): Promise<void> {
    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value } });
    fireEvent.keyDown(receiverInput, { key: "Enter" });
    await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /수신자 제거/ }).length).toBeGreaterThan(0);
    });
}

invariant(
    "SI-SMS-08",
    "after a successful manual SMS send the mobile message views are refreshed",
    async () => {
        mockGetMessageSenderApproval.mockResolvedValue({
            approvalStatus: "approved",
            isApproved: true,
            canRequest: true,
            requestedAt: "2026-06-04T00:00:00.000Z",
            approvedAt: "2026-06-04T00:00:00.000Z",
        });
        mockUseMessagesPermissionGuard.mockReturnValue({ isLoading: false, needsSenderApproval: false });
        mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });
        mockUseBankAccountInfos.mockReturnValue({ data: [], isLoading: false });
        mockUseVoucherPriceInfos.mockReturnValue({ data: [], isLoading: false });
        mockUseSystemTemplate.mockImplementation((key: string) => {
            if (key === "GREETING" || key === "greeting") {
                return {
                    data: {
                        id: "system-greeting",
                        templateKey: "GREETING",
                        name: "인사 메시지",
                        description: "고객 인사 메시지",
                        content: "안녕하세요, 인천 아이미래로 입니다 :)",
                        requiredVariables: [],
                        customVariables: [],
                        updatedAt: "2026-06-04T00:00:00.000Z",
                    },
                };
            }
            return { data: null };
        });
        mockUseSystemTemplates.mockReturnValue({
            data: [mockUseSystemTemplate("GREETING").data].filter(Boolean),
            isError: false,
            isFetching: false,
            isLoading: false,
            isSuccess: true,
        });
        apiMock.post.mockReset();
        apiMock.post.mockResolvedValue({
            data: {
                provider: "aligo_sms",
                triggerType: "immediate",
                request: { receiver: "010-1234-5678", msgType: "SMS", testMode: false },
                result: { resultCode: 1, message: "accepted", successCount: 1, errorCount: 0, msgType: "SMS" },
            },
        });

        const queryClient = freshQueryClient();
        render(
            <QueryClientProvider client={queryClient}>
                <NewMessagePage />
            </QueryClientProvider>,
        );
        await addManualRecipient("010-1234-5678");
        fireEvent.change(screen.getByLabelText("메시지 본문"), { target: { value: "테스트 발송 본문" } });
        fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));
        await waitFor(() => {
            expect(screen.getByText("메시지 발송 요청이 접수되었습니다.")).toBeInTheDocument();
        });

        const touchedAllLogs = isInvalidated(queryClient, CLIENT_HISTORY_KEY_ALL);
        const touchedHistory = isInvalidated(queryClient, messageTriggerKeys.history());
        // Immediate sends add history, not upcoming scheduled jobs. Assert the
        // actual cache state so correct prefix invalidation satisfies the test.
        if (!touchedAllLogs || !touchedHistory) {
            throw new Error(
                `the manual send did not invalidate the message views ` +
                    `(allLogs=${touchedAllLogs} history=${touchedHistory})`,
            );
        }
    },
);
