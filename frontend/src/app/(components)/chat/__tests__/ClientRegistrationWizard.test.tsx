import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientRegistrationWizard } from "../ClientRegistrationWizard";

jest.mock("@/app/hooks/useVoucherData", () => ({
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

describe("ClientRegistrationWizard", () => {
    beforeEach(() => {
        (global as any).fetch = jest.fn();
    });

    test("submits minimal required payload to /api/clients", async () => {
        (global as any).fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ id: 123, name: "홍길동" }),
        });

        const onCreated = jest.fn();
        render(<ClientRegistrationWizard onCreated={onCreated} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "900101" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "2026-02-01" } });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);

        // Voucher info step: select type and duration (auto-fills prices)
        fireEvent.mouseDown(screen.getByLabelText("바우처 유형"));
        fireEvent.click(screen.getByRole("option", { name: "A가-1형" }));

        fireEvent.mouseDown(screen.getByLabelText("기간"));
        fireEvent.click(screen.getByRole("option", { name: "10일" }));

        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // Toggle careCenter on for test determinism
        fireEvent.click(screen.getByRole("checkbox", { name: "조리원 여부" }));

        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect((global as any).fetch).toHaveBeenCalledTimes(1);
        });

        const [url, options] = (global as any).fetch.mock.calls[0];
        expect(url).toBe("/api/clients");
        expect(options.method).toBe("POST");
        expect(JSON.parse(options.body)).toEqual({
            name: "홍길동",
            phone: "010-1234-5678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "2026-02-01",
            careCenter: true,
            voucherClient: true,
            breastPump: false,
            type: "A가1형",
            duration: 10,
            fullPrice: "100000",
            grant: "50000",
            actualPrice: "50000",
        });

        expect(onCreated).toHaveBeenCalledWith({ id: 123, name: "홍길동" });
    });

    test("shows inline error on API failure", async () => {
        (global as any).fetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: "Failed to create client" }),
        });

        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "900101" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "2026-02-01" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        fireEvent.mouseDown(screen.getByLabelText("바우처 유형"));
        fireEvent.click(screen.getByRole("option", { name: "A가-1형" }));

        fireEvent.mouseDown(screen.getByLabelText("기간"));
        fireEvent.click(screen.getByRole("option", { name: "10일" }));

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await expect(screen.findByText(/실패/)).resolves.toBeInTheDocument();
    });
});
