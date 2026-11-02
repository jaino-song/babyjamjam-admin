import { render, screen } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { LocaleProvider } from "@/providers/LocaleProvider";
import type { Locale } from "@/app/actions/locale";

import { ClientDetailModal } from "../ClientDetailModal";

function buildClient(overrides: Partial<Client>): Client {
    return {
        id: 1,
        name: "테스트 산모",
        phone: "01099900001",
        type: "일반",
        duration: 10,
        serviceStatus: "waiting",
        primaryEmployee: null,
        secondaryEmployee: null,
        voucherClient: false,
        breastPump: false,
        careCenter: false,
        hasSigned: false,
        documentStatus: "requested",
        ...overrides,
    } as Client;
}

function renderModal(client: Client, locale: Locale = "ko") {
    return render(
        <LocaleProvider locale={locale}>
            <ClientDetailModal
                data-component="mobile_clients_detail-modal"
                open
                onClose={jest.fn()}
                client={client}
                onEdit={jest.fn()}
                onDelete={jest.fn()}
            />
        </LocaleProvider>,
    );
}

describe("mobile ClientDetailModal service days", () => {
    it("shows nothing about service days when all are off or unsent", () => {
        renderModal(buildClient({}));
        renderModal(buildClient({ allowSaturdayService: false, allowSundayService: false, allowHolidayService: false }));

        expect(screen.queryByText("주말·공휴일 서비스")).not.toBeInTheDocument();
    });

    it("lists only the enabled days", () => {
        renderModal(buildClient({ allowSaturdayService: true, allowHolidayService: true }));

        expect(screen.getByText("주말·공휴일 서비스")).toBeInTheDocument();
        expect(screen.getByText("토요일")).toBeInTheDocument();
        expect(screen.getByText("공휴일")).toBeInTheDocument();
        expect(screen.queryByText("일요일")).not.toBeInTheDocument();
    });
});
