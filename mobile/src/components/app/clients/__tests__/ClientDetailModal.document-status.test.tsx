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

describe("mobile ClientDetailModal document status badge", () => {
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

    it("shows a pending cancellation (040) as 철회 요청됨 in the warning tone, not 철회됨", () => {
        renderModal(buildClient({ documentStatus: "revoke_requested", hasSigned: false }));

        const badge = screen.getByText("철회 요청됨");
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveClass("text-[hsl(38,92%,35%)]");
        expect(screen.queryByText("철회됨")).not.toBeInTheDocument();
    });

    it("keeps 철회 요청됨 even when the customer already signed", () => {
        renderModal(buildClient({ documentStatus: "revoke_requested", hasSigned: true }));

        expect(screen.getByText("철회 요청됨")).toBeInTheDocument();
        expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    });

    it("localizes the pending cancellation for non-Korean locales", () => {
        renderModal(buildClient({ documentStatus: "revoke_requested" }), "en");

        expect(screen.getByText("Revocation requested")).toBeInTheDocument();
    });

    it("shows a voided contract (계약 파기) as 파기됨 in the neutral tone, never 미발급", () => {
        renderModal(buildClient({ documentStatus: "voided", hasSigned: true }));

        const badge = screen.getByText("파기됨");
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveClass("text-foreground");
        expect(screen.queryByText("미발급")).not.toBeInTheDocument();
        expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    });

    it("localizes the voided contract for non-Korean locales", () => {
        renderModal(buildClient({ documentStatus: "voided" }), "en");

        expect(screen.getByText("Voided")).toBeInTheDocument();
    });
});
