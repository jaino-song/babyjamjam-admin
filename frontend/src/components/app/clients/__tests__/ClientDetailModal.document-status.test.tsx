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
            <ClientDetailModal open onClose={jest.fn()} client={client} onEdit={jest.fn()} onDelete={jest.fn()} />
        </LocaleProvider>,
    );
}

describe("ClientDetailModal document status badge", () => {
    it("reads a signed-but-not-finalized contract as 서명 완료, not 서명 요청됨", () => {
        renderModal(buildClient({ documentStatus: "requested", hasSigned: true }));

        expect(screen.getByText("서명 완료")).toBeInTheDocument();
        expect(screen.queryByText("서명 요청됨")).not.toBeInTheDocument();
    });

    it("keeps 서명 요청됨 while the customer has not signed", () => {
        renderModal(buildClient({ documentStatus: "requested", hasSigned: false }));

        expect(screen.getByText("서명 요청됨")).toBeInTheDocument();
        expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    });

    it("localizes the signed step for non-Korean locales", () => {
        renderModal(buildClient({ documentStatus: "requested", hasSigned: true }), "en");

        expect(screen.getByText("Signed")).toBeInTheDocument();
        expect(screen.queryByText("Requested")).not.toBeInTheDocument();
    });

    it("still shows 계약 완료 for a finalized contract", () => {
        renderModal(buildClient({ documentStatus: "completed", hasSigned: true }));

        expect(screen.getByText("계약 완료")).toBeInTheDocument();
    });
});
