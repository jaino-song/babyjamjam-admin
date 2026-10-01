import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientRegistrationWizard } from "../ClientRegistrationWizard";

const mockCreateClientMutateAsync = jest.fn();

jest.mock("@/hooks/useVoucherData", () => ({
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
        if (type === "B가1형") {
            return {
                data: [
                    {
                        id: 2,
                        type: "B가1형",
                        duration: "10",
                        fullPrice: "100000",
                        grant: "",
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

/** The single message slot in a field's label row. */
const slotOf = (field: HTMLElement) =>
    document.getElementById(field.getAttribute("aria-describedby") ?? "") as HTMLElement;

const BASICS_FIELDS = ["이름", "출산 예정일", "연락처", "생년월일", "주소"];

describe("ClientRegistrationWizard", () => {
    beforeEach(() => {
        mockCreateClientMutateAsync.mockReset();
    });

    test("submits minimal required payload to /api/clients", async () => {
        mockCreateClientMutateAsync.mockResolvedValue({
            id: 123,
            name: "홍길동",
        });

        const onCreated = jest.fn();
        render(<ClientRegistrationWizard onCreated={onCreated} />);

        const nextButton = screen.getByRole("button", { name: "다음" });

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
        expect(screen.getByLabelText("생년월일")).toHaveValue("1958-03-03");
        expect(screen.getByLabelText("생년월일")).toHaveAttribute("maxLength", "10");
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "2026-02-01" } });
        fireEvent.click(nextButton);

        // Voucher step: minimal path without voucher info
        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));

        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // Toggle careCenter on for test determinism
        fireEvent.click(screen.getByRole("checkbox", { name: "조리원 여부" }));

        fireEvent.click(screen.getByRole("button", { name: "제출" }));

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
    });

    test("shows inline error on API failure", async () => {
        mockCreateClientMutateAsync.mockRejectedValue(new Error("등록 실패"));

        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "1990-01-01" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "2026-02-01" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await expect(screen.findByText(/실패/)).resolves.toBeInTheDocument();
    });
});

describe("ClientRegistrationWizard field messages", () => {
    beforeEach(() => {
        mockCreateClientMutateAsync.mockReset();
        Element.prototype.scrollIntoView = jest.fn();
    });

    test("shows nothing on first render and uses example placeholders for the dates", () => {
        render(<ClientRegistrationWizard />);

        BASICS_FIELDS.forEach((label) => {
            const field = screen.getByLabelText(label);
            expect(slotOf(field)).toBeEmptyDOMElement();
            expect(slotOf(field)).toHaveAttribute("aria-live", "polite");
            expect(field).not.toHaveAttribute("aria-invalid", "true");
        });
        expect(screen.getByLabelText("출산 예정일")).toHaveAttribute("placeholder", "2026-11-20");
        expect(screen.getByLabelText("출산 예정일")).not.toHaveAttribute("type", "date");
        expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
        expect(screen.getByLabelText("연락처")).toHaveAttribute("placeholder", "010-1234-5678");
    });

    test("hints while a phone number is incomplete and errors once the field is left", () => {
        render(<ClientRegistrationWizard />);
        const phone = screen.getByLabelText("연락처");

        fireEvent.focus(phone);
        fireEvent.change(phone, { target: { value: "0101234" } });
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
        expect(slotOf(phone)).not.toHaveTextContent("입력해 주세요");

        fireEvent.blur(phone);
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(phone).toHaveAttribute("aria-invalid", "true");
    });

    test("reports a partial date in its own slot after leaving it", () => {
        render(<ClientRegistrationWizard />);
        const dueDate = screen.getByLabelText("출산 예정일");

        fireEvent.focus(dueDate);
        fireEvent.change(dueDate, { target: { value: "202611" } });
        expect(dueDate).toHaveValue("2026-11");
        expect(slotOf(dueDate)).toHaveTextContent("YYYY-MM-DD 형식");

        fireEvent.blur(dueDate);
        expect(slotOf(dueDate)).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    });

    test("does not call a cleared field required until it held a value", () => {
        render(<ClientRegistrationWizard />);
        const name = screen.getByLabelText("이름");

        fireEvent.focus(name);
        fireEvent.blur(name);
        expect(slotOf(name)).toBeEmptyDOMElement();

        fireEvent.change(name, { target: { value: "홍" } });
        fireEvent.change(name, { target: { value: "" } });
        expect(slotOf(name)).toHaveTextContent("이름을 입력해 주세요");
    });

    test("pressing 다음 with problems shows every message and focuses the first field", () => {
        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "0101234" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(slotOf(screen.getByLabelText("이름"))).toHaveTextContent("이름을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("출산 예정일"))).toHaveTextContent("출산 예정일을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("연락처"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(slotOf(screen.getByLabelText("생년월일"))).toHaveTextContent("생년월일을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("주소"))).toHaveTextContent("주소를 입력해 주세요");
        expect(screen.getByLabelText("이름")).toHaveFocus();
        // Field problems never go to the top alert, and the step does not advance.
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByLabelText("이름")).toBeInTheDocument();
    });

    test("a due date typed as digits reaches the submitted payload as YYYY-MM-DD", async () => {
        mockCreateClientMutateAsync.mockResolvedValue({ id: 5, name: "홍길동" });
        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261120" } });
        expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ dueDate: "2026-11-20", birthday: "1958-03-03", phone: "010-1234-5678" }),
            );
        });
    });

    test("a voucher client pressing 다음 without a type gets the message in the type slot, not a top alert", () => {
        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261120" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // Nothing is shown until the step is attempted.
        expect(document.getElementById("voucherType-message")).toBeEmptyDOMElement();

        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(document.getElementById("voucherType-message")).toHaveTextContent("유형을 선택해 주세요");
        expect(document.getElementById("voucherType")).toHaveAttribute("aria-invalid", "true");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText("바우처 정보를 입력해주세요.")).not.toBeInTheDocument();
    });

    const fillBasicsAndOpenVoucherStep = () => {
        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261120" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
    };

    const pickVoucherType = async (typeLabel: string) => {
        fireEvent.keyDown(document.getElementById("voucherType") as HTMLElement, { key: "ArrowDown" });
        fireEvent.click(await screen.findByRole("option", { name: typeLabel }));
    };

    const pickVoucherDuration = async () => {
        fireEvent.keyDown(document.getElementById("voucherDuration") as HTMLElement, { key: "ArrowDown" });
        fireEvent.click(await screen.findByRole("option", { name: "10일" }));
    };

    test("a period whose price has no amounts says so in the period slot instead of doing nothing", async () => {
        render(<ClientRegistrationWizard />);
        fillBasicsAndOpenVoucherStep();

        await pickVoucherType("B가-1형");
        await pickVoucherDuration();
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(document.getElementById("voucherDuration-message")).toHaveTextContent("요금 정보가 없어요");
        expect(document.getElementById("voucherDuration")).toHaveAttribute("aria-invalid", "true");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("forgets a blocked 다음 when the customer type is switched", () => {
        render(<ClientRegistrationWizard />);
        fillBasicsAndOpenVoucherStep();

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(document.getElementById("voucherType-message")).toHaveTextContent("유형을 선택해 주세요");

        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));

        expect(document.getElementById("voucherType-message")).toBeEmptyDOMElement();
    });

    test("gives the customer-type and option checkboxes a label row with a slot above them", () => {
        render(<ClientRegistrationWizard />);
        fillBasicsAndOpenVoucherStep();

        const customerType = screen.getByText("고객 유형");
        expect(customerType.closest("label")).toHaveAttribute("for", "customerType");
        expect(document.getElementById("customerType-message")).toBeEmptyDOMElement();
        expect(screen.getByRole("checkbox", { name: "바우처 대상" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(screen.getByText("추가 옵션").closest("label")).toHaveAttribute("for", "options");
        expect(document.getElementById("options-message")).toBeEmptyDOMElement();
    });
});
