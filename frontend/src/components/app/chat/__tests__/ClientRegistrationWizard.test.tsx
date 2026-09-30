import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientRegistrationWizard } from "../ClientRegistrationWizard";

const mockCreateClientMutateAsync = jest.fn();
const mockCreateEmployeeMutateAsync = jest.fn();
let mockEmployees: Array<{ id: number; name: string; phone?: string }> = [];
let mockEmployeesLoading = false;
let mockEmployeesFetching = false;
let mockEmployeesError = false;
let mockRefetchEmployees = jest.fn();

jest.mock("@/hooks/useVoucherData", () => ({
    useAvailableClientAreas: () => ({ data: [], isLoading: false }),
    useAreaTemplates: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useVoucherPriceInfos: (type: string) => {
        if (type === "A가1형") {
            return {
                data: [
                    {
                        id: 1,
                        type: "A가1형",
                        duration: "10",
                        fullPrice: "100000",
                        grant: "50000",
                        actualPrice: "50000",
                    },
                ],
                isLoading: false,
            };
        }
        return { data: [], isLoading: false };
    },
}));

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => ({
        mutateAsync: (...args: unknown[]) => mockCreateClientMutateAsync(...args),
        isPending: false,
    }),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useCreateEmployee: () => ({
        mutateAsync: (...args: unknown[]) => mockCreateEmployeeMutateAsync(...args),
        isPending: false,
    }),
    useEmployees: () => ({
        data: mockEmployees,
        isLoading: mockEmployeesLoading,
        isFetching: mockEmployeesFetching,
        isError: mockEmployeesError,
        refetch: () => mockRefetchEmployees(),
    }),
}));

describe("ClientRegistrationWizard", () => {
    beforeAll(() => {
        Object.defineProperty(Element.prototype, "scrollIntoView", {
            configurable: true,
            value: jest.fn(),
        });
    });

    beforeEach(() => {
        mockCreateClientMutateAsync.mockReset();
        mockCreateEmployeeMutateAsync.mockReset();
        mockEmployees = [];
        mockEmployeesLoading = false;
        mockEmployeesFetching = false;
        mockEmployeesError = false;
        mockRefetchEmployees = jest.fn().mockResolvedValue({ data: [] });
    });

    test("submits minimal required payload to /api/clients", async () => {
        mockCreateClientMutateAsync.mockResolvedValue({
            id: 123,
            name: "홍길동",
        });

        const onCreated = jest.fn();
        render(<ClientRegistrationWizard onCreated={onCreated} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        // Field problems never disable the button; pressing it shows them instead.
        expect(nextButton).toBeEnabled();
        fireEvent.click(nextButton);
        expect(screen.getByLabelText("이름")).toHaveFocus();
        expect(screen.queryByRole("checkbox", { name: "바우처 대상" })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
        expect(screen.getByLabelText("생년월일")).toHaveValue("1958-03-03");
        expect(screen.getByLabelText("생년월일")).toHaveAttribute("maxLength", "10");
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20260201" } });
        expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-02-01");
        expect(nextButton).toBeEnabled();
        fireEvent.click(nextButton);

        // Voucher step: minimal path without voucher info
        const voucherCheckbox = await screen.findByRole("checkbox", { name: "바우처 대상" });
        fireEvent.click(voucherCheckbox);

        const secondNextButton = screen.getByRole("button", { name: "다음" });
        await waitFor(() => {
            expect(secondNextButton).not.toBeDisabled();
        });
        fireEvent.click(secondNextButton);

        // Toggle careCenter on for test determinism
        const careCenterCheckbox = await screen.findByRole("checkbox", { name: "조리원 여부" });
        fireEvent.click(careCenterCheckbox);

        const submitButton = screen.getByRole("button", { name: "제출" });
        await waitFor(() => {
            expect(submitButton).not.toBeDisabled();
        });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mockCreateClientMutateAsync).toHaveBeenCalledWith({
            name: "홍길동",
            phone: "010-1234-5678",
            birthday: "1958-03-03",
            address: "인천 연수구",
            dueDate: "2026-02-01",
            careCenter: true,
            voucherClient: false,
            breastPump: false,
            primaryEmployeeId: null,
        });

        expect(onCreated).toHaveBeenCalledWith({ id: 123, name: "홍길동" });
    }, 15000);

    test("seeds fields extracted from the chat request", () => {
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                }}
                onCreated={jest.fn()}
            />,
        );

        expect(screen.getByLabelText("이름")).toHaveValue("홍길동");
        expect(screen.getByLabelText("연락처")).toHaveValue("010-1234-5678");
        expect(screen.getByLabelText("생년월일")).toHaveValue("1990-01-01");
        expect(screen.getByLabelText("주소")).toHaveValue("인천 연수구");
        expect(screen.getByText("대화에서 받은 정보를 채웠어요. 부족한 항목을 입력해 주세요."))
            .toBeInTheDocument();
    });

    test("opens inline employee registration when the mentioned employee is not registered", async () => {
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
                onCreated={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(await screen.findByLabelText("제공인력 이름")).toHaveValue("김제공");
    });

    test("enables and submits inline employee registration after required fields are complete", async () => {
        mockCreateEmployeeMutateAsync.mockResolvedValue({ id: 9, name: "김제공" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const registerButton = await screen.findByRole("button", { name: "제공인력 등록" });
        expect(registerButton).toBeEnabled();
        fireEvent.click(registerButton);
        expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
        expect(screen.getByLabelText("연락처")).toHaveFocus();
        expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        fireEvent.click(registerButton);

        await waitFor(() => {
            expect(mockCreateEmployeeMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
    });

    test("requires an explicit employee choice when names are ambiguous", async () => {
        mockEmployees = [
            { id: 10, name: "김제공", phone: "010-1111-1111" },
            { id: 11, name: "김제공", phone: "010-2222-2222" },
        ];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).toBeDisabled();
        fireEvent.click(screen.getByLabelText("제공인력 선택"));
        fireEvent.click(await screen.findByRole("option", { name: "김제공 (010-2222-2222)" }));
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 11 }),
            );
        });
    });

    test("auto-binds an extracted employee name only when the match is unique", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 10 }),
            );
        });
    });

    test("returns to provider resolution when a unique match disappears before submit", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        mockEmployees = [];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
        expect(await screen.findByText("제공인력 정보가 변경되었습니다. 제공인력을 다시 확인해 주세요."))
            .toBeInTheDocument();
        expect(screen.getByLabelText("이름")).toHaveValue("홍길동");
    });

    test("does not rebind an explicitly selected provider after a same-name refetch", async () => {
        mockEmployees = [
            { id: 10, name: "김제공", phone: "010-1111-1111" },
            { id: 11, name: "김제공", phone: "010-2222-2222" },
        ];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).toBeDisabled();
        fireEvent.click(screen.getByLabelText("제공인력 선택"));
        fireEvent.click(await screen.findByRole("option", { name: "김제공 (010-2222-2222)" }));
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);

        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(screen.getByRole("button", { name: "제출" })).toBeInTheDocument();

        // A refetch replaces the selected employee with a different same-name match.
        mockEmployeesFetching = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(screen.getByRole("button", { name: "제출" })).toBeDisabled();

        mockEmployees = [{ id: 12, name: "김제공", phone: "010-3333-3333" }];
        mockEmployeesFetching = false;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const submitButton = screen.getByRole("button", { name: "제출" });
        expect(submitButton).toBeDisabled();
        fireEvent.click(submitButton);
        expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();

        // Returning to the first step exposes the stale choice and keeps progression blocked
        // until the user explicitly selects the remaining provider.
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        expect(screen.getByLabelText("제공인력 선택")).toBeInTheDocument();
        const resolutionNextButton = screen.getByRole("button", { name: "다음" });
        expect(resolutionNextButton).toBeDisabled();

        fireEvent.click(screen.getByLabelText("제공인력 선택"));
        fireEvent.click(await screen.findByRole("option", { name: "김제공 (010-3333-3333)" }));
        expect(resolutionNextButton).not.toBeDisabled();
        fireEvent.click(resolutionNextButton);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 12 }),
            );
        });
    });

    test("allows employee registration when every same-name match disappears", async () => {
        mockEmployees = [
            { id: 10, name: "김제공", phone: "010-1111-1111" },
            { id: 11, name: "김제공", phone: "010-2222-2222" },
        ];
        mockCreateEmployeeMutateAsync.mockResolvedValue({ id: 12, name: "김제공" });
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(<ClientRegistrationWizard initialDraft={initialDraft} />);

        fireEvent.click(screen.getByLabelText("제공인력 선택"));
        fireEvent.click(await screen.findByRole("option", { name: "김제공 (010-2222-2222)" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // The explicitly selected employee disappears and no same-name provider remains.
        mockEmployees = [];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        await waitFor(() => {
            expect(screen.queryByLabelText("제공인력 선택")).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "다음" })).not.toBeDisabled();
        });

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(await screen.findByLabelText("제공인력 이름")).toHaveValue("김제공");

        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        const registerButton = screen.getByRole("button", { name: "제공인력 등록" });
        expect(registerButton).not.toBeDisabled();
        fireEvent.click(registerButton);

        await waitFor(() => {
            expect(mockCreateEmployeeMutateAsync).toHaveBeenCalledWith({
                name: "김제공",
                workArea: ["인천 연수구"],
                phone: "01012345678",
                grade: "스탠다드",
                openToNextWork: true,
            });
        });
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" })).toBeInTheDocument();
    });

    test("submits with a created provider id even when the follow-up employee lookup fails", async () => {
        mockCreateEmployeeMutateAsync.mockResolvedValue({ id: 9, name: "김제공" });
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(<ClientRegistrationWizard initialDraft={initialDraft} />);

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const registerButton = await screen.findByRole("button", { name: "제공인력 등록" });
        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        fireEvent.click(registerButton);

        await waitFor(() => {
            expect(mockCreateEmployeeMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();

        // The create mutation can trigger a query refetch that fails; the created id is still authoritative.
        mockEmployeesError = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();

        const nextButton = screen.getByRole("button", { name: "다음" });
        fireEvent.click(screen.getByLabelText("바우처 대상"));
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);

        const submitButton = screen.getByRole("button", { name: "제출" });
        expect(submitButton).not.toBeDisabled();
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 9 }),
            );
        });
    });

    test("waits for employee lookup before deciding whether registration is needed", async () => {
        mockEmployeesLoading = true;
        const { rerender } = render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

        mockEmployeesLoading = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("waits for a background employee refetch before offering registration", async () => {
        mockEmployeesFetching = true;
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();

        mockEmployeesFetching = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("disables inline employee registration while a background refetch is pending", async () => {
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const registerButton = await screen.findByRole("button", { name: "제공인력 등록" });
        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        expect(registerButton).not.toBeDisabled();

        // React Query can retain the empty cache while a focus/invalidation refetch runs.
        mockEmployeesFetching = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        expect(screen.getByRole("button", { name: "제공인력 등록" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "제공인력 등록" }));
        expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();

        mockEmployeesFetching = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("disables final submission until a background employee refetch completes", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // The list becomes stale and empty while React Query performs the refetch.
        mockEmployees = [];
        mockEmployeesFetching = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const submitButton = screen.getByRole("button", { name: "제출" });
        expect(submitButton).toBeDisabled();
        fireEvent.click(submitButton);
        expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();

        mockEmployees = [{ id: 10, name: "김제공" }];
        mockEmployeesFetching = false;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(submitButton).not.toBeDisabled();
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 10 }),
            );
        });
    });

    test("blocks progression and does not offer registration when employee lookup fails", async () => {
        mockEmployeesError = true;
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "1990-01-01",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        expect(screen.getByText("제공인력 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."))
            .toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: "바우처 대상" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
        expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
    });

    test("retries a failed employee lookup and recovers when the refreshed data resolves", async () => {
        mockEmployeesError = true;
        let resolveRefetch: ((value: unknown) => void) | undefined;
        mockRefetchEmployees.mockImplementation(
            () => new Promise((resolve) => {
                resolveRefetch = resolve;
            }),
        );
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "1990-01-01",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        const retryButton = screen.getByRole("button", { name: "다시 시도" });
        expect(nextButton).toBeDisabled();

        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(mockRefetchEmployees).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByRole("button", { name: "재시도 중..." })).toBeDisabled();
        expect(nextButton).toBeDisabled();

        // The refetch remains in progress even after the query's next state is available.
        mockEmployees = [{ id: 10, name: "김제공" }];
        mockEmployeesError = false;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(screen.getByRole("button", { name: "재시도 중..." })).toBeDisabled();
        expect(nextButton).toBeDisabled();

        resolveRefetch?.({ data: mockEmployees });

        await waitFor(() => {
            expect(screen.queryByRole("button", { name: "재시도 중..." })).not.toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
            expect(nextButton).not.toBeDisabled();
        });

        fireEvent.click(nextButton);
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" })).toBeInTheDocument();
    });

    test("shows inline error on API failure", async () => {
        mockCreateClientMutateAsync.mockRejectedValue(new Error("등록 실패"));

        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "1990-01-01" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20260201" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await expect(screen.findByText(/실패/)).resolves.toBeInTheDocument();
    });

    describe("inline field messages", () => {
        const fillBasics = (overrides: Partial<Record<"이름" | "연락처" | "생년월일" | "주소" | "출산 예정일", string>> = {}) => {
            const values = {
                이름: "홍길동",
                연락처: "01012345678",
                생년월일: "19580303",
                주소: "인천 연수구",
                "출산 예정일": "20261120",
                ...overrides,
            };
            Object.entries(values).forEach(([label, value]) => {
                fireEvent.change(screen.getByLabelText(label), { target: { value } });
            });
        };

        const slotOf = (container: HTMLElement, id: string) => container.querySelector(`#${id}-message`);

        test("shows no message and realistic example placeholders on first render", () => {
            const { container } = render(<ClientRegistrationWizard />);

            expect(container.querySelector('[data-slot="field-error-message"]')).toBeNull();
            expect(container.querySelector('[data-slot="field-message"]')).toBeNull();
            expect(screen.getByLabelText("출산 예정일")).toHaveAttribute("placeholder", "2026-11-20");
            expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
            expect(screen.getByLabelText("연락처")).toHaveAttribute("placeholder", "010-1234-5678");
            expect(screen.getByLabelText("연락처")).not.toHaveAttribute("aria-invalid", "true");
        });

        test("shows a phone hint while typing and the format error after leaving the field", () => {
            const { container } = render(<ClientRegistrationWizard />);
            const phoneInput = screen.getByLabelText("연락처");

            fireEvent.focus(phoneInput);
            fireEvent.change(phoneInput, { target: { value: "010123" } });
            expect(slotOf(container, "phone")).toHaveTextContent("010-1234-5678 형식");
            expect(slotOf(container, "phone")).not.toHaveTextContent("입력해 주세요");
            expect(phoneInput).not.toHaveAttribute("aria-invalid", "true");

            fireEvent.blur(phoneInput);
            const slot = slotOf(container, "phone");
            expect(slot).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
            expect(slot).toHaveAttribute("data-slot", "field-error-message");
            expect(slot).toHaveAttribute("aria-live", "polite");
            expect(phoneInput).toHaveAttribute("aria-invalid", "true");
            expect(phoneInput).toHaveAttribute("aria-describedby", "phone-message");
            // The message lives in the label row, not below the input.
            expect(slot?.closest('[data-component$="_phone-field"]')?.firstElementChild).toContainElement(slot as HTMLElement);
        });

        test("shows the date format error for a partial date after blur and a hint while focused", () => {
            const { container } = render(<ClientRegistrationWizard />);
            const birthdayInput = screen.getByLabelText("생년월일");

            fireEvent.focus(birthdayInput);
            fireEvent.change(birthdayInput, { target: { value: "195803" } });
            expect(birthdayInput).toHaveValue("1958-03");
            expect(slotOf(container, "birthday")).toHaveTextContent("YYYY-MM-DD 형식");

            fireEvent.blur(birthdayInput);
            expect(slotOf(container, "birthday")).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
            expect(birthdayInput).toHaveAttribute("aria-invalid", "true");
        });

        test("shows the due date format error for a partial due date after blur", () => {
            const { container } = render(<ClientRegistrationWizard />);
            const dueDateInput = screen.getByLabelText("출산 예정일");

            fireEvent.focus(dueDateInput);
            fireEvent.change(dueDateInput, { target: { value: "2026112" } });
            fireEvent.blur(dueDateInput);

            expect(slotOf(container, "dueDate")).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
            expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
        });

        test("reports a required field only after it held a value and was cleared", () => {
            const { container } = render(<ClientRegistrationWizard />);
            const nameInput = screen.getByLabelText("이름");

            expect(slotOf(container, "name")).toBeNull();
            fireEvent.change(nameInput, { target: { value: "홍" } });
            expect(slotOf(container, "name")).toBeNull();
            fireEvent.change(nameInput, { target: { value: "" } });
            expect(slotOf(container, "name")).toHaveTextContent("이름을 입력해 주세요");
            expect(nameInput).toHaveAttribute("aria-invalid", "true");
        });

        test("clearing a prefilled field reports required", () => {
            const { container } = render(
                <ClientRegistrationWizard
                    initialDraft={{ name: "홍길동", phone: "01012345678", address: "인천 연수구" }}
                />,
            );

            expect(slotOf(container, "address")).toBeNull();
            fireEvent.change(screen.getByLabelText("주소"), { target: { value: "" } });
            expect(slotOf(container, "address")).toHaveTextContent("주소를 입력해 주세요");
        });

        test("rejects a nonexistent date and a future birthday", () => {
            const { container } = render(<ClientRegistrationWizard />);

            fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261345" } });
            expect(slotOf(container, "dueDate")).toHaveTextContent("존재하지 않는 날짜예요");

            fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "29990101" } });
            expect(slotOf(container, "birthday")).toHaveTextContent("미래 날짜는 입력할 수 없어요");
            expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
        });

        test("pressing next with an incomplete phone shows every problem, focuses the first and does not advance", () => {
            const { container } = render(<ClientRegistrationWizard />);

            fillBasics({ 연락처: "010123", 주소: "" });
            const nextButton = screen.getByRole("button", { name: "다음" });
            expect(nextButton).toBeEnabled();

            fireEvent.click(nextButton);

            // The focused field keeps the grey format hint; it turns red once the user leaves it.
            expect(screen.getByLabelText("연락처")).toHaveFocus();
            expect(slotOf(container, "phone")).toHaveTextContent("010-1234-5678 형식");
            fireEvent.blur(screen.getByLabelText("연락처"));
            expect(slotOf(container, "phone")).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
            expect(slotOf(container, "address")).toHaveTextContent("주소를 입력해 주세요");
            expect(screen.queryByRole("checkbox", { name: "바우처 대상" })).not.toBeInTheDocument();

            fillBasics({ 연락처: "01012345678", 주소: "" });
            fireEvent.click(nextButton);
            expect(screen.getByLabelText("주소")).toHaveFocus();
        });

        test("typing the due date as digits reaches the submitted payload as ISO", async () => {
            mockCreateClientMutateAsync.mockResolvedValue({ id: 7, name: "홍길동" });
            render(<ClientRegistrationWizard />);

            fillBasics();
            expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");
            expect(screen.getByLabelText("생년월일")).toHaveValue("1958-03-03");
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(screen.getByRole("button", { name: "제출" }));

            await waitFor(() => {
                expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                    expect.objectContaining({
                        phone: "010-1234-5678",
                        birthday: "1958-03-03",
                        dueDate: "2026-11-20",
                    }),
                );
            });
        });

        test("a due date extracted from chat as YYMMDD is shown and submitted as YYYY-MM-DD", async () => {
            mockCreateClientMutateAsync.mockResolvedValue({ id: 8, name: "홍길동" });
            render(
                <ClientRegistrationWizard
                    initialDraft={{
                        name: "홍길동",
                        phone: "01012345678",
                        birthday: "1990-01-01",
                        address: "인천 연수구",
                        dueDate: "261120",
                    }}
                />,
            );

            expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(screen.getByRole("button", { name: "제출" }));

            await waitFor(() => {
                expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                    expect.objectContaining({ dueDate: "2026-11-20" }),
                );
            });
        });

        test("submits without a due date when the user declined to give one", async () => {
            mockCreateClientMutateAsync.mockResolvedValue({ id: 9, name: "홍길동" });
            render(
                <ClientRegistrationWizard
                    initialDraft={{
                        name: "홍길동",
                        phone: "01012345678",
                        birthday: "1990-01-01",
                        address: "인천 연수구",
                        skippedFields: ["dueDate"],
                    }}
                />,
            );

            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            fireEvent.click(screen.getByRole("button", { name: "제출" }));

            await waitFor(() => {
                expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
            });
            expect(mockCreateClientMutateAsync.mock.calls[0][0]).not.toHaveProperty("dueDate");
        });

        test("shows phone messages for the provider registration form", async () => {
            const { container } = render(
                <ClientRegistrationWizard
                    initialDraft={{
                        name: "홍길동",
                        phone: "01012345678",
                        birthday: "1990-01-01",
                        address: "인천 연수구",
                        dueDate: "260201",
                        employeeName: "김제공",
                    }}
                />,
            );

            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            const employeePhone = await screen.findByLabelText("연락처");
            expect(slotOf(container, "employee-phone")).toBeNull();

            fireEvent.focus(employeePhone);
            fireEvent.change(employeePhone, { target: { value: "0101234" } });
            fireEvent.blur(employeePhone);
            expect(slotOf(container, "employee-phone")).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
            const registerButton = screen.getByRole("button", { name: "제공인력 등록" });
            expect(registerButton).toBeEnabled();
            fireEvent.click(registerButton);
            expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
            expect(employeePhone).toHaveFocus();
        });
    });
});
