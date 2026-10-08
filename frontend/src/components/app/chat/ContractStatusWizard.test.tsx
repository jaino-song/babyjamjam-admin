import { fireEvent, render, screen } from "@testing-library/react";

import ContractStatusWizard from "./ContractStatusWizard";

let mockClient: Record<string, unknown> = {};

jest.mock("../clients/ClientAutocomplete", () => ({
    ClientAutocomplete: ({ onChange }: { onChange: (id: number | null, client: unknown) => void }) => (
        <button type="button" onClick={() => onChange(mockClient.id as number, mockClient)}>
            산모 고르기
        </button>
    ),
}));

function submitFor(client: Record<string, unknown>) {
    mockClient = client;
    const onCheck = jest.fn();
    render(<ContractStatusWizard onCheck={onCheck} />);
    fireEvent.click(screen.getByRole("button", { name: "산모 고르기" }));
    fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
    return onCheck;
}

describe("ContractStatusWizard", () => {
    it.each([true, false])("passes the selected client's hasSigned=%s through to the result", (hasSigned) => {
        const onCheck = submitFor({
            id: 7,
            name: "홍길동",
            documentStatus: "requested",
            serviceStatus: null,
            hasSigned,
        });
        expect(onCheck).toHaveBeenCalledWith({
            clientId: 7,
            clientName: "홍길동",
            documentStatus: "requested",
            serviceStatus: null,
            hasSigned,
        });
    });
});
